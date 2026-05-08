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

type AnalyzeBody = AnalyzeRequest & {
  materialFiles: File[];
  referenceFiles: File[];
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

function send(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: StreamEvent) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("用户已停止本次分析。");
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

function getTextInputError(agent: TestAgentAnalysisType) {
  if (agent === "change-impact") return "请输入或上传 git diff / PR 材料。";
  if (agent === "debug-assistant") return "请输入或上传日志、堆栈、请求或依据文档。";
  return "请输入或上传发布材料。";
}

function getTextInputStageMessage(agent: TestAgentAnalysisType) {
  if (agent === "change-impact") return "已读取 git diff / PR 材料";
  if (agent === "debug-assistant") return "已读取 Bug 现场材料";
  return "已读取发布材料";
}

function getThinkingDetail(agent: TestAgentAnalysisType) {
  if (agent === "requirement-review") return "正在提取需求模块、功能点、测试点和注意事项。";
  if (agent === "change-impact") return "正在识别改动影响、接口风险和重点回归范围。";
  if (agent === "debug-assistant") return "正在定位疑似根因、涉及模块和可疑变更。";
  return "正在判断回归范围、冒烟清单和上线风险。";
}

function getAiStageMessage(agent: TestAgentAnalysisType) {
  if (agent === "requirement-review") return "AI 正在分析需求测试点";
  if (agent === "change-impact") return "AI 正在分析变更影响";
  if (agent === "debug-assistant") return "AI 正在分析 Bug 根因";
  return "AI 正在分析发布风险";
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
          detail: getThinkingDetail(agent),
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
        message: "AI 正在持续分析",
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
          onEvent({ type: "stage", message: "已收到分析请求" });
          const { body, file } = await readAnalyzeRequest(request);
          assertNotAborted(request.signal);

          const agent = normalizeAnalysisAgent(body.agent ?? "");
          let input = String(body.input ?? "").trim();
          let materialWarnings: string[] = [];

          if (agent === "requirement-review") {
            if (!(file instanceof File)) throw new Error("需求分析智能体请上传 PRD PDF。");
            if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("需求分析智能体仅支持 PDF 文件。");
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
              detail: `提取 ${input.length.toLocaleString("zh-CN")} 个字符，准备进入需求分析。`,
            });
          } else {
            if (body.materialFiles.length || body.referenceFiles.length) {
              onEvent({
                type: "stage",
                message: "正在解析上传文件",
                detail: `主材料 ${body.materialFiles.length} 个，依据文档 ${body.referenceFiles.length} 个。`,
              });
            }
            const prepared = await prepareAgentMaterial({
              manualInput: input,
              materialFiles: body.materialFiles,
              referenceFiles: body.referenceFiles,
            });
            input = prepared.input;
            materialWarnings = prepared.warnings;
            assertNotAborted(request.signal);
            if (input.length < 20) throw new Error(getTextInputError(agent));
            onEvent({
              type: "stage",
              message: getTextInputStageMessage(agent),
              detail: `共 ${input.length.toLocaleString("zh-CN")} 个字符；${prepared.fileSummaries.length ? `已合并 ${prepared.fileSummaries.length} 个上传文件。` : "未上传文件。"}`,
            });
            if (materialWarnings.length) {
              onEvent({
                type: "stage",
                message: "材料已自动整理",
                detail: materialWarnings.join(" "),
              });
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
              message: "未检测到 API Key，改用本地规则分析",
              detail: "本次不会调用外部 AI 服务。",
            });
            result = appendWarnings(generateFallbackAgentAnalysis(agent, input), materialWarnings);
          } else {
            onEvent({
              type: "stage",
              message: getAiStageMessage(agent),
              detail: "模型会流式返回结构化 JSON，可在右侧查看实时输出。",
            });
            result = appendWarnings(await streamAnalyzeWithModel({
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
            }), materialWarnings);
          }

          let resultWithStats = withStats({ agent, input, model, provider, result, reasoningEffort, startedAt, thinkingMode });
          try {
            const savedRecord = saveRunHistoryRecord({
              agent,
              status: "success",
              fileName: getAnalysisRecordFileName(agent, file, body),
              createdAt: resultWithStats.stats?.startedAt,
              completedAt: resultWithStats.stats?.completedAt,
              provider,
              model,
              ...(provider === "aliyun" ? { thinkingMode } : {}),
              result: resultWithStats,
            });
            resultWithStats = {
              ...resultWithStats,
              historyId: savedRecord.id,
            };
            onEvent({
              type: "stage",
              message: "运行记录已保存",
              detail: `当前智能体记录：${savedRecord.id}`,
            });
          } catch (saveError) {
            resultWithStats = {
              ...resultWithStats,
              warnings: [...resultWithStats.warnings, `运行记录保存失败：${getErrorMessage(saveError)}`],
            };
          }

          onEvent({
            type: "stage",
            message: "分析结果已整理完成",
            detail: `${resultWithStats.sections.length} 个分组，${resultWithStats.sections.reduce((sum, section) => sum + section.items.length, 0)} 条分析项。`,
          });
          onEvent({ type: "result", data: resultWithStats });
          onEvent({ type: "done" });
        } catch (error) {
          if (!request.signal.aborted) {
            onEvent({
              type: "error",
              message: "智能体分析失败，请检查材料、模型配置或网络连接。",
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
