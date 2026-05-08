import OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import { jsonrepair } from "jsonrepair";
import { NextResponse } from "next/server";
import {
  normalizeProvider,
  normalizeReasoningEffort,
  normalizeThinkingMode,
  providerBaseURLs,
  providerLabels,
  providerModels,
  type Provider,
} from "@/lib/model-config";
import {
  buildAgentPrompt,
  generateFallbackAgentAnalysis,
  normalizeAgentAnalysisPayload,
  normalizeAnalysisAgent,
} from "@/lib/test-agent";
import { prepareAgentMaterial } from "@/lib/server/agent-material";
import { saveRunHistoryRecord } from "@/lib/server/run-history-db";
import type {
  AgentAnalysisResponse,
  ReasoningEffort,
  TestAgentAnalysisType,
  ThinkingMode,
} from "@/types/test-case";

export const runtime = "nodejs";
export const maxDuration = 120;

const providerDefaults: Record<Provider, { model: string; baseURL?: string; envKey: string }> = {
  openai: {
    model: process.env.OPENAI_MODEL || providerModels.openai,
    envKey: process.env.OPENAI_API_KEY || "",
  },
  deepseek: {
    model: process.env.DEEPSEEK_MODEL || providerModels.deepseek,
    baseURL: "https://api.deepseek.com",
    envKey: process.env.DEEPSEEK_API_KEY || "",
  },
  aliyun: {
    model: process.env.DASHSCOPE_MODEL || providerModels.aliyun,
    baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envKey: process.env.DASHSCOPE_API_KEY || "",
  },
  velotric: {
    model: process.env.VELOTRIC_MODEL || providerModels.velotric,
    baseURL: process.env.VELOTRIC_BASE_URL || providerBaseURLs.velotric,
    envKey: process.env.VELOTRIC_API_KEY || "",
  },
};

type AnalyzeRequest = {
  agent?: string;
  input?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  thinkingMode?: string;
  reasoningEffort?: string;
};

type AnalyzeBody = AnalyzeRequest & {
  materialFiles: File[];
  referenceFiles: File[];
};

async function extractPdfText(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const parser = new PDFParse({ data });

  try {
    const parsed = await parser.getText();
    return parsed.text.trim();
  } finally {
    await parser.destroy();
  }
}

async function readAnalyzeRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const fileValue = formData.get("file");
    const materialFiles = formData.getAll("files").filter((item): item is File => item instanceof File);
    const referenceFiles = formData.getAll("referenceFiles").filter((item): item is File => item instanceof File);
    return {
      body: {
        agent: String(formData.get("agent") ?? ""),
        input: String(formData.get("input") ?? ""),
        provider: String(formData.get("provider") ?? ""),
        model: String(formData.get("model") ?? ""),
        apiKey: String(formData.get("apiKey") ?? ""),
        baseURL: String(formData.get("baseURL") ?? ""),
        thinkingMode: String(formData.get("thinkingMode") ?? ""),
        reasoningEffort: String(formData.get("reasoningEffort") ?? ""),
        materialFiles,
        referenceFiles,
      } satisfies AnalyzeBody,
      file: fileValue instanceof File ? fileValue : null,
    };
  }

  const body = (await request.json()) as AnalyzeRequest;
  return {
    body: {
      ...body,
      materialFiles: [],
      referenceFiles: [],
    } satisfies AnalyzeBody,
    file: null,
  };
}

function parseJsonObject<T>(content: string): T {
  const trimmed = content.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  const json = start >= 0 && end >= start ? withoutFence.slice(start, end + 1) : withoutFence;

  try {
    return JSON.parse(json) as T;
  } catch {
    return JSON.parse(jsonrepair(json)) as T;
  }
}

function withStats({
  agent,
  input,
  model,
  provider,
  result,
  startedAt,
  thinkingMode,
  reasoningEffort,
}: {
  agent: TestAgentAnalysisType;
  input: string;
  model: string;
  provider: Provider;
  result: AgentAnalysisResponse;
  startedAt: number;
  thinkingMode: ThinkingMode;
  reasoningEffort: ReasoningEffort;
}) {
  const completedAt = Date.now();
  return {
    ...result,
    agent,
    stats: {
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - startedAt,
      provider,
      model,
      ...(provider === "aliyun" ? { thinkingMode } : {}),
      ...(provider === "openai" || provider === "velotric" ? { reasoningEffort } : {}),
      sourceTextLength: input.length,
    },
  } satisfies AgentAnalysisResponse;
}

function createClient(provider: Provider, apiKey: string, baseURL?: string) {
  const config = providerDefaults[provider];
  return new OpenAI({
    apiKey,
    ...(baseURL || config.baseURL ? { baseURL: baseURL || config.baseURL } : {}),
  });
}

function getTextInputError(agent: TestAgentAnalysisType) {
  if (agent === "change-impact") return "请输入或上传 git diff / PR 材料。";
  if (agent === "debug-assistant") return "请输入或上传日志、堆栈、请求或依据文档。";
  return "请输入或上传发布材料。";
}

function getAnalysisRecordFileName(agent: TestAgentAnalysisType, file: File | null, body: AnalyzeBody) {
  if (file) return file.name;
  const fileNames = [...body.materialFiles, ...body.referenceFiles].map((item) => item.name).filter(Boolean);
  if (fileNames.length === 1) return fileNames[0];
  if (fileNames.length > 1) return `${fileNames[0]} 等 ${fileNames.length} 个文件`;
  if (agent === "change-impact") return "变更影响分析";
  if (agent === "debug-assistant") return "Bug 根因分析";
  return "发布风险分析";
}

function appendWarnings(result: AgentAnalysisResponse, warnings: string[]) {
  if (!warnings.length) return result;
  return {
    ...result,
    warnings: [...result.warnings, ...warnings],
  } satisfies AgentAnalysisResponse;
}

function persistAnalysisResult({
  agent,
  body,
  file,
  model,
  provider,
  result,
  thinkingMode,
}: {
  agent: TestAgentAnalysisType;
  body: AnalyzeBody;
  file: File | null;
  model: string;
  provider: Provider;
  result: AgentAnalysisResponse;
  thinkingMode: ThinkingMode;
}) {
  try {
    const savedRecord = saveRunHistoryRecord({
      agent,
      status: "success",
      fileName: getAnalysisRecordFileName(agent, file, body),
      createdAt: result.stats?.startedAt,
      completedAt: result.stats?.completedAt,
      provider,
      model,
      ...(provider === "aliyun" ? { thinkingMode } : {}),
      result,
    });
    return {
      ...result,
      historyId: savedRecord.id,
    } satisfies AgentAnalysisResponse;
  } catch (error) {
    return {
      ...result,
      warnings: [...result.warnings, `运行记录保存失败：${error instanceof Error ? error.message : "未知错误"}`],
    } satisfies AgentAnalysisResponse;
  }
}

async function analyzeWithModel({
  agent,
  apiKey,
  baseURL,
  input,
  model,
  provider,
  reasoningEffort,
  thinkingMode,
}: {
  agent: TestAgentAnalysisType;
  apiKey: string;
  baseURL?: string;
  input: string;
  model: string;
  provider: Provider;
  reasoningEffort: ReasoningEffort;
  thinkingMode: ThinkingMode;
}) {
  const prompt = buildAgentPrompt(agent, input);
  const client = createClient(provider, apiKey, baseURL);
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    response_format: { type: "json_object" as const },
    max_tokens: prompt.maxTokens,
    stream: false,
    ...(provider === "aliyun" ? { enable_thinking: thinkingMode === "quality" } : {}),
    ...(provider === "openai" || provider === "velotric" ? { reasoning_effort: reasoningEffort } : {}),
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { enable_thinking?: boolean });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`${providerLabels[provider]} 返回了空内容。`);
  return normalizeAgentAnalysisPayload(parseJsonObject(content), agent, "ai");
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const { body, file } = await readAnalyzeRequest(request);
    const agent = normalizeAnalysisAgent(body.agent ?? "");
    let input = String(body.input ?? "").trim();
    let materialWarnings: string[] = [];

    if (agent === "requirement-review") {
      if (!(file instanceof File)) {
        return NextResponse.json({ message: "需求分析智能体请上传 PRD PDF。" }, { status: 400 });
      }

      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ message: "需求分析智能体仅支持 PDF 文件。" }, { status: 400 });
      }

      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ message: "PDF 文件不能超过 15MB。" }, { status: 400 });
      }

      input = await extractPdfText(file);
      if (!input || input.length < 30) {
        return NextResponse.json({ message: "未能从 PDF 中提取到足够文本，请确认文档可复制或包含文本层。" }, { status: 422 });
      }
    } else {
      const prepared = await prepareAgentMaterial({
        manualInput: input,
        materialFiles: body.materialFiles,
        referenceFiles: body.referenceFiles,
      });
      input = prepared.input;
      materialWarnings = prepared.warnings;
      if (input.length < 20) {
        return NextResponse.json({ message: getTextInputError(agent) }, { status: 400 });
      }
    }

    const provider = normalizeProvider(body.provider ?? "deepseek");
    const config = providerDefaults[provider];
    const requestApiKey = String(body.apiKey ?? "").trim();
    const apiKey = requestApiKey || config.envKey;
    const model = String(body.model ?? "").trim() || config.model;
    const thinkingMode = normalizeThinkingMode(body.thinkingMode ?? "fast");
    const reasoningEffort = normalizeReasoningEffort(body.reasoningEffort ?? "medium");
    const baseURL = provider === "velotric" && String(body.baseURL ?? "").trim() ? String(body.baseURL).trim() : config.baseURL;

    if (!apiKey) {
      const fallback = appendWarnings(generateFallbackAgentAnalysis(agent, input), materialWarnings);
      const resultWithStats = withStats({ agent, input, model, provider, result: fallback, startedAt, thinkingMode, reasoningEffort });
      return NextResponse.json(persistAnalysisResult({ agent, body, file, model, provider, result: resultWithStats, thinkingMode }));
    }

    const result = appendWarnings(await analyzeWithModel({
      agent,
      apiKey,
      baseURL,
      input,
      model,
      provider,
      reasoningEffort,
      thinkingMode,
    }), materialWarnings);

    const resultWithStats = withStats({ agent, input, model, provider, result, startedAt, thinkingMode, reasoningEffort });
    return NextResponse.json(persistAnalysisResult({ agent, body, file, model, provider, result: resultWithStats, thinkingMode }));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: error instanceof Error ? error.message : "智能体分析失败，请稍后重试。" }, { status: 500 });
  }
}
