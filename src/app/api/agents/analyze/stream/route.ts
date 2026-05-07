import OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import { jsonrepair } from "jsonrepair";
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
import type {
  AgentAnalysisResponse,
  ReasoningEffort,
  TestAgentAnalysisType,
  ThinkingMode,
} from "@/types/test-case";

export const runtime = "nodejs";
export const maxDuration = 120;

type StreamEvent =
  | { type: "stage"; message: string; detail?: string }
  | { type: "thinking"; message: string; detail?: string }
  | { type: "chunk"; content: string }
  | { type: "result"; data: AgentAnalysisResponse }
  | { type: "error"; message: string; detail?: string }
  | { type: "done" };

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
      } satisfies AnalyzeRequest,
      file: fileValue instanceof File ? fileValue : null,
    };
  }

  return {
    body: (await request.json()) as AnalyzeRequest,
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

function send(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: StreamEvent) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("用户已停止本次评审。");
    error.name = "AbortError";
    throw error;
  }
}

function createClient(provider: Provider, apiKey: string, baseURL?: string) {
  const config = providerDefaults[provider];
  return new OpenAI({
    apiKey,
    ...(baseURL || config.baseURL ? { baseURL: baseURL || config.baseURL } : {}),
  });
}

function withStats({
  agent,
  input,
  model,
  provider,
  result,
  reasoningEffort,
  startedAt,
  thinkingMode,
}: {
  agent: TestAgentAnalysisType;
  input: string;
  model: string;
  provider: Provider;
  result: AgentAnalysisResponse;
  reasoningEffort: ReasoningEffort;
  startedAt: number;
  thinkingMode: ThinkingMode;
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

async function streamAnalyzeWithModel({
  agent,
  apiKey,
  baseURL,
  input,
  model,
  onEvent,
  provider,
  reasoningEffort,
  signal,
  thinkingMode,
}: {
  agent: TestAgentAnalysisType;
  apiKey: string;
  baseURL?: string;
  input: string;
  model: string;
  onEvent: (event: StreamEvent) => void;
  provider: Provider;
  reasoningEffort: ReasoningEffort;
  signal?: AbortSignal;
  thinkingMode: ThinkingMode;
}) {
  const prompt = buildAgentPrompt(agent, input);
  const client = createClient(provider, apiKey, baseURL);
  const stream = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      response_format: { type: "json_object" as const },
      max_tokens: prompt.maxTokens,
      stream: true,
      ...(provider === "aliyun" ? { enable_thinking: thinkingMode === "quality" } : {}),
      ...(provider === "openai" || provider === "velotric" ? { reasoning_effort: reasoningEffort } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & { enable_thinking?: boolean },
    { signal },
  );

  let content = "";
  let chunkCount = 0;
  let thinkingChunkCount = 0;

  for await (const chunk of stream) {
    assertNotAborted(signal);
    const deltaPayload = chunk.choices[0]?.delta as { content?: string | null; reasoning_content?: string | null };
    const reasoningContent = deltaPayload?.reasoning_content ?? "";
    if (reasoningContent) {
      thinkingChunkCount += 1;
      if (thinkingChunkCount === 1 || thinkingChunkCount % 20 === 0) {
        onEvent({
          type: "thinking",
          message: "模型正在思考",
          detail: agent === "requirement-review" ? "正在识别需求疑点、边界、异常和权限风险。" : "正在判断回归范围、冒烟清单和上线风险。",
        });
      }
    }

    const delta = deltaPayload?.content ?? "";
    if (!delta) continue;

    content += delta;
    chunkCount += 1;
    onEvent({ type: "chunk", content: delta });

    if (chunkCount % 25 === 0) {
      onEvent({
        type: "stage",
        message: "AI 正在持续评审",
        detail: `已接收 ${content.length.toLocaleString("zh-CN")} 个字符`,
      });
    }
  }

  if (!content.trim()) throw new Error(`${providerLabels[provider]} 返回了空内容。`);
  return normalizeAgentAnalysisPayload(parseJsonObject(content), agent, "ai");
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const onEvent = (event: StreamEvent) => send(controller, encoder, event);

        try {
          onEvent({ type: "stage", message: "已收到评审请求" });
          const { body, file } = await readAnalyzeRequest(request);
          assertNotAborted(request.signal);

          const agent = normalizeAnalysisAgent(body.agent ?? "");
          let input = String(body.input ?? "").trim();

          if (agent === "requirement-review") {
            if (!(file instanceof File)) throw new Error("需求评审智能体请上传 PRD PDF。");
            if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("需求评审智能体仅支持 PDF 文件。");
            if (file.size > 15 * 1024 * 1024) throw new Error("PDF 文件不能超过 15MB。");

            onEvent({
              type: "stage",
              message: "正在解析 PRD PDF",
              detail: `${file.name} / ${(file.size / 1024 / 1024).toFixed(2)} MB`,
            });
            input = await extractPdfText(file);
            assertNotAborted(request.signal);
            if (!input || input.length < 30) throw new Error("未能从 PDF 中提取到足够文本，请确认文档可复制或包含文本层。");
            onEvent({
              type: "stage",
              message: "PDF 解析完成",
              detail: `提取 ${input.length.toLocaleString("zh-CN")} 个字符，准备进入需求评审。`,
            });
          } else {
            if (input.length < 20) throw new Error("请输入至少 20 个字符的发布材料。");
            onEvent({
              type: "stage",
              message: "已读取发布材料",
              detail: `共 ${input.length.toLocaleString("zh-CN")} 个字符。`,
            });
          }

          if (input.length > 80_000) throw new Error("单次分析材料不能超过 80000 个字符。");

          const provider = normalizeProvider(body.provider ?? "deepseek");
          const config = providerDefaults[provider];
          const requestApiKey = String(body.apiKey ?? "").trim();
          const apiKey = requestApiKey || config.envKey;
          const model = String(body.model ?? "").trim() || config.model;
          const thinkingMode = normalizeThinkingMode(body.thinkingMode ?? "fast");
          const reasoningEffort = normalizeReasoningEffort(body.reasoningEffort ?? "medium");
          const baseURL = provider === "velotric" && String(body.baseURL ?? "").trim() ? String(body.baseURL).trim() : config.baseURL;

          onEvent({
            type: "stage",
            message: "已读取模型配置",
            detail: `${providerLabels[provider]} / ${model} / ${
              provider === "aliyun" ? (thinkingMode === "quality" ? "高质量模式" : "快速模式") : `推理 ${reasoningEffort}`
            } / ${apiKey ? "已提供 API Key" : "未提供 API Key"}`,
          });

          let result: AgentAnalysisResponse;
          if (!apiKey) {
            onEvent({
              type: "stage",
              message: "未检测到 API Key，改用本地规则评审",
              detail: "本次不会调用外部 AI 服务。",
            });
            result = generateFallbackAgentAnalysis(agent, input);
          } else {
            onEvent({
              type: "stage",
              message: agent === "requirement-review" ? "AI 正在评审需求" : "AI 正在分析发布风险",
              detail: "模型会流式返回结构化 JSON，可在右侧查看实时输出。",
            });
            result = await streamAnalyzeWithModel({
              agent,
              apiKey,
              baseURL,
              input,
              model,
              onEvent,
              provider,
              reasoningEffort,
              signal: request.signal,
              thinkingMode,
            });
          }

          const resultWithStats = withStats({ agent, input, model, provider, result, reasoningEffort, startedAt, thinkingMode });
          onEvent({
            type: "stage",
            message: "评审结果已整理完成",
            detail: `${resultWithStats.sections.length} 个分组，${resultWithStats.sections.reduce((sum, section) => sum + section.items.length, 0)} 条分析项。`,
          });
          onEvent({ type: "result", data: resultWithStats });
          onEvent({ type: "done" });
        } catch (error) {
          if (!request.signal.aborted) {
            onEvent({
              type: "error",
              message: "智能体评审失败，请检查材料、模型配置或网络连接。",
              detail: getErrorMessage(error),
            });
          }
        } finally {
          try {
            controller.close();
          } catch {
            // The client may abort before the server closes the stream.
          }
        }
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "application/x-ndjson; charset=utf-8",
      },
    },
  );
}
