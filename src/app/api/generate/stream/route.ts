import OpenAI from "openai";
import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { jsonrepair } from "jsonrepair";
import { generateFallbackCases } from "@/lib/test-case-generator";
import { formatGenerationEvaluationBasis } from "@/lib/generation-evaluation";
import { generationProfileConfigs, normalizeGenerationProfile } from "@/lib/generation-profile";
import { estimateAliyunCostCny, estimateDeepSeekCostCny, normalizeReasoningEffort, normalizeThinkingMode, providerBaseURLs, providerLabels, providerModels } from "@/lib/model-config";
import { getRunHistoryRecord, saveRunHistoryRecord } from "@/lib/server/run-history-db";
import {
  caseTypeOptions,
  defaultExecutionType,
  defaultMaintainer,
  normalizeCaseType,
  normalizeExecutionType,
  normalizeNullableNumber,
  normalizeTemplateText,
} from "@/lib/testcase-template";
import type {
  CategoryTargetMap,
  Complexity,
  CoverageBlueprint,
  CoverageModule,
  CoverageTestPoint,
  GenerateResponse,
  GenerationEvaluationMetric,
  GenerationCheckpointStage,
  GenerationModuleStats,
  GenerationQualityReport,
  GenerationUsage,
  QualityFinding,
  ReasoningEffort,
  RequirementUncertainty,
  RiskLevel,
  RunStatus,
  TestCase,
  TestCategory,
  TestDataRequirement,
  TestDesignTechnique,
  TestEnvironmentRequirement,
  TestGenerationProfile,
  TestPriority,
  ThinkingMode,
} from "@/types/test-case";

export const runtime = "nodejs";
export const maxDuration = 300;

type LlmProvider = "openai" | "deepseek" | "aliyun" | "velotric";

type GenerationMode = "strategy" | "cases";

type StreamEvent =
  | { type: "stage"; message: string; detail?: string }
  | { type: "thinking"; message: string; detail?: string }
  | { type: "chunk"; content: string }
  | { type: "result"; data: GenerateResponse }
  | { type: "error"; message: string; detail?: string }
  | { type: "done" };

type ModulePlan = CoverageModule;

type ModulePlanResponse = {
  documentComplexity?: Complexity;
  coverageRationale?: string;
  uncertainties?: RequirementUncertainty[];
  modules: Array<
    Partial<Omit<CoverageModule, "testPoints">> & {
      testPoints?: Array<string | Partial<CoverageTestPoint>>;
    }
  >;
};

type CaseBatchResponse = {
  cases: TestCase[];
};

type QualityReviewResponse = {
  score?: number;
  summary?: string;
  revisedCaseCount?: number;
  findingCount?: number;
  findings?: QualityFinding[];
  cases: TestCase[];
};

type ResumableGenerateResponse = GenerateResponse & { coverageBlueprint: CoverageBlueprint };

type ResumeState = {
  historyId: string;
  result: ResumableGenerateResponse;
  nextModuleIndex: number;
  moduleStage: GenerationCheckpointStage;
};

const categories: TestCategory[] = ["功能", "边界", "异常", "权限", "性能"];
const designTechniques: TestDesignTechnique[] = ["等价类", "边界值", "判定表", "状态迁移", "流程分支", "权限矩阵", "组合覆盖", "接口契约", "幂等", "并发", "回滚"];
const priorities: TestPriority[] = ["P0", "P1", "P2"];
const complexityBounds: Record<Complexity, { min: number; max: number; base: number; perPoint: number; perRisk: number }> = {
  minimal: { min: 4, max: 14, base: 4, perPoint: 2, perRisk: 1 },
  simple: { min: 8, max: 24, base: 6, perPoint: 2, perRisk: 1 },
  medium: { min: 14, max: 40, base: 10, perPoint: 3, perRisk: 1.5 },
  complex: { min: 24, max: 56, base: 16, perPoint: 4, perRisk: 2 },
  large: { min: 32, max: 64, base: 22, perPoint: 4, perRisk: 2 },
};
const complexityLabels: Record<Complexity, string> = {
  minimal: "极简",
  simple: "简单",
  medium: "中等",
  complex: "复杂",
  large: "大型",
};
const categorySignalWords: Record<Exclude<TestCategory, "功能">, string[]> = {
  边界: ["边界", "范围", "最大", "最小", "上限", "下限", "长度", "格式", "金额", "数量", "分页", "排序", "字段", "参数", "阈值", "有效期", "枚举", "必填"],
  异常: ["异常", "失败", "错误", "超时", "网络", "接口", "服务", "依赖", "中断", "回滚", "重试", "降级", "同步", "库存"],
  权限: ["权限", "角色", "登录", "未登录", "授权", "会员", "管理员", "访问", "越权", "账号", "隐私", "数据隔离", "会话"],
  性能: ["性能", "并发", "高频", "大量", "响应", "P95", "加载", "分页", "压力", "吞吐", "耗时", "资源", "批量"],
};
const negativeSignals = [
  "失败",
  "错误",
  "无效",
  "非法",
  "为空",
  "空值",
  "缺失",
  "未",
  "不可",
  "不能",
  "禁止",
  "拒绝",
  "取消",
  "返回",
  "中断",
  "超时",
  "过期",
  "异常",
  "冲突",
  "重复",
  "越权",
  "无权限",
  "不满足",
  "不可用",
  "不支持",
  "未授权",
  "未登录",
  "超限",
  "低于",
  "高于",
  "断开",
  "丢失",
  "降级",
  "回滚",
  "重试",
  "fail",
  "error",
  "invalid",
  "empty",
  "missing",
  "denied",
  "timeout",
  "expired",
  "unauthorized",
  "forbidden",
  "cancel",
  "conflict",
];

const providerDefaults: Record<LlmProvider, { label: string; model: string; baseURL?: string; envKey: string }> = {
  openai: {
    label: "OpenAI",
    model: process.env.OPENAI_MODEL || providerModels.openai,
    envKey: process.env.OPENAI_API_KEY || "",
  },
  deepseek: {
    label: "DeepSeek",
    model: process.env.DEEPSEEK_MODEL || providerModels.deepseek,
    baseURL: "https://api.deepseek.com",
    envKey: process.env.DEEPSEEK_API_KEY || "",
  },
  aliyun: {
    label: "阿里云百炼",
    model: process.env.DASHSCOPE_MODEL || providerModels.aliyun,
    baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envKey: process.env.DASHSCOPE_API_KEY || "",
  },
  velotric: {
    label: "Velotric 号池",
    model: process.env.VELOTRIC_MODEL || providerModels.velotric,
    baseURL: process.env.VELOTRIC_BASE_URL || providerBaseURLs.velotric,
    envKey: process.env.VELOTRIC_API_KEY || "",
  },
};

function getProvider(value: FormDataEntryValue | null): LlmProvider {
  if (value === "openai" || value === "aliyun" || value === "velotric") return value;
  return "deepseek";
}

function getGenerationMode(value: FormDataEntryValue | null): GenerationMode {
  return value === "strategy" ? "strategy" : "cases";
}

function getProfileLabel(profile: TestGenerationProfile) {
  return generationProfileConfigs[profile].label;
}

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

class GenerationCancelledError extends Error {
  constructor() {
    super("用户已停止本次生成。");
    this.name = "GenerationCancelledError";
  }
}

class EmptyModelContentError extends Error {
  usage?: GenerationUsage;

  constructor(message: string, usage?: GenerationUsage) {
    super(message);
    this.name = "EmptyModelContentError";
    this.usage = usage;
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new GenerationCancelledError();
}

function isCancelledError(error: unknown) {
  return error instanceof GenerationCancelledError || (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted")));
}

function getErrorUsage(error: unknown) {
  return error instanceof EmptyModelContentError ? error.usage : undefined;
}

function isTransientStreamError(error: unknown) {
  if (isCancelledError(error)) return false;
  if (!(error instanceof Error)) return false;

  const maybeError = error as Error & {
    code?: string;
    type?: string;
    status?: number;
    error?: { code?: string; type?: string; message?: string };
  };
  const text = [error.message, maybeError.code, maybeError.type, maybeError.error?.code, maybeError.error?.type, maybeError.error?.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    text.includes("stream error") ||
    text.includes("internal_error") ||
    text.includes("internal_server_error") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("socket hang up") ||
    maybeError.status === 500 ||
    maybeError.status === 502 ||
    maybeError.status === 503 ||
    maybeError.status === 504
  );
}

function getMaxAttempts(provider: LlmProvider) {
  if (provider === "deepseek") return 3;
  if (provider === "velotric") return 2;
  return 1;
}

function getProviderMaxTokens(provider: LlmProvider, desired: number, cap: number) {
  const providerCap = provider === "velotric" ? Math.min(cap, 8_000) : cap;
  return Math.min(providerCap, desired);
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    const extra = Object.fromEntries(
      Object.entries(error as unknown as Record<string, unknown>).filter(([key]) => !["name", "message", "stack"].includes(key)),
    );
    return JSON.stringify(
      {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...extra,
      },
      null,
      2,
    ).slice(0, 8_000);
  }

  try {
    return JSON.stringify(error, null, 2).slice(0, 8_000);
  } catch {
    return String(error).slice(0, 8_000);
  }
}

function createClient(provider: LlmProvider, apiKey: string, baseURL?: string) {
  const config = providerDefaults[provider];
  return new OpenAI({
    apiKey,
    ...(baseURL || config.baseURL ? { baseURL: baseURL || config.baseURL } : {}),
  });
}

function emptyUsage(): GenerationUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function addUsage(current: GenerationUsage | undefined, next: GenerationUsage | undefined) {
  if (!current && !next) return undefined;
  const base = current ?? emptyUsage();
  const addition = next ?? emptyUsage();
  return {
    promptTokens: base.promptTokens + addition.promptTokens,
    completionTokens: base.completionTokens + addition.completionTokens,
    totalTokens: base.totalTokens + addition.totalTokens,
    ...((base.reasoningTokens ?? addition.reasoningTokens) !== undefined
      ? { reasoningTokens: (base.reasoningTokens ?? 0) + (addition.reasoningTokens ?? 0) }
      : {}),
  };
}

function normalizeUsage(value: OpenAI.Completions.CompletionUsage | null | undefined): GenerationUsage | undefined {
  if (!value) return undefined;
  const completionDetails = value.completion_tokens_details as { reasoning_tokens?: number } | null | undefined;
  return {
    promptTokens: value.prompt_tokens ?? 0,
    completionTokens: value.completion_tokens ?? 0,
    totalTokens: value.total_tokens ?? 0,
    ...(completionDetails?.reasoning_tokens ? { reasoningTokens: completionDetails.reasoning_tokens } : {}),
  };
}

async function streamJsonRequestOnce<T>({
  apiKey,
  baseURL,
  model,
  provider,
  messages,
  maxTokens,
  onEvent,
  reasoningEffort,
  stageLabel,
  thinkingMode,
  signal,
  useJsonMode,
}: {
  apiKey: string;
  baseURL?: string;
  model: string;
  provider: LlmProvider;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  maxTokens: number;
  onEvent: (event: StreamEvent) => void;
  reasoningEffort: ReasoningEffort;
  stageLabel: string;
  thinkingMode: ThinkingMode;
  signal?: AbortSignal;
  useJsonMode: boolean;
}) {
  assertNotAborted(signal);
  const client = createClient(provider, apiKey, baseURL);
  const requestBody = {
    model,
    messages,
    ...(useJsonMode ? { response_format: { type: "json_object" as const } } : {}),
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    ...(provider === "aliyun" ? { enable_thinking: thinkingMode === "quality" } : {}),
    ...(provider === "openai" || provider === "velotric" ? { reasoning_effort: reasoningEffort } : {}),
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & { enable_thinking?: boolean };
  const stream = await client.chat.completions.create(requestBody, { signal });

  let content = "";
  let chunkCount = 0;
  let thinkingChunkCount = 0;
  let finishReason: string | null = null;
  let usage: GenerationUsage | undefined;

  for await (const chunk of stream) {
    assertNotAborted(signal);
    finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
    usage = normalizeUsage(chunk.usage) ?? usage;
    const deltaPayload = chunk.choices[0]?.delta as { content?: string | null; reasoning_content?: string | null };
    const reasoningContent = deltaPayload?.reasoning_content ?? "";
    if (reasoningContent) {
      thinkingChunkCount += 1;
      if (thinkingChunkCount === 1 || thinkingChunkCount % 20 === 0) {
        onEvent({
          type: "thinking",
          message: "模型正在思考",
          detail: `${stageLabel}：推理模型正在组织结构化输出，暂时可能没有可展示的 JSON 内容。`,
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
        message: "AI 正在持续生成",
        detail: `${stageLabel}：已接收 ${content.length.toLocaleString("zh-CN")} 个字符`,
      });
    }
  }

  if (!content.trim()) throw new EmptyModelContentError(`${providerDefaults[provider].label} 返回了空内容。`, usage);

  return {
    payload: parseJsonObject<T>(content),
    rawLength: content.length,
    finishReason,
    usage,
  };
}

async function streamJsonRequest<T>({
  apiKey,
  baseURL,
  model,
  provider,
  messages,
  maxTokens,
  onEvent,
  reasoningEffort,
  stageLabel,
  thinkingMode,
  signal,
}: {
  apiKey: string;
  baseURL?: string;
  model: string;
  provider: LlmProvider;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  maxTokens: number;
  onEvent: (event: StreamEvent) => void;
  reasoningEffort: ReasoningEffort;
  stageLabel: string;
  thinkingMode: ThinkingMode;
  signal?: AbortSignal;
}) {
  const maxAttempts = getMaxAttempts(provider);
  let accumulatedUsage: GenerationUsage | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const useJsonMode = !(provider === "deepseek" && attempt === maxAttempts && maxAttempts > 1);

    if (attempt > 1) {
      onEvent({
        type: "stage",
        message: provider === "deepseek" ? "DeepSeek 输出为空，正在自动重试" : "模型流式连接中断，正在自动重试",
        detail: `${stageLabel}：第 ${attempt}/${maxAttempts} 次调用${useJsonMode ? "，继续使用 JSON 模式" : "，改用普通流式输出并从内容中提取 JSON"}`,
      });
    }

    try {
      const result = await streamJsonRequestOnce<T>({
        apiKey,
        baseURL,
        model,
        provider,
        messages,
        maxTokens,
        onEvent,
        reasoningEffort,
        stageLabel,
        thinkingMode,
        signal,
        useJsonMode,
      });

      return {
        ...result,
        usage: addUsage(accumulatedUsage, result.usage),
      };
    } catch (error) {
      accumulatedUsage = addUsage(accumulatedUsage, getErrorUsage(error));
      if (isCancelledError(error)) throw error;

      lastError = error;
      const canRetryEmptyContent = provider === "deepseek" && error instanceof EmptyModelContentError && attempt < maxAttempts;
      const canRetryTransientStream = provider === "velotric" && isTransientStreamError(error) && attempt < maxAttempts;
      if (canRetryEmptyContent || canRetryTransientStream) continue;
      break;
    }
  }

  if (provider === "deepseek" && lastError instanceof EmptyModelContentError) {
    throw new EmptyModelContentError(
      "DeepSeek JSON 输出为空，已自动重试仍失败。建议稍后重试、切换 DeepSeek 模型，或改用阿里云/OpenAI 生成。",
      accumulatedUsage,
    );
  }

  throw lastError instanceof Error ? lastError : new Error("模型调用失败。");
}

function formatModuleName(module: ModulePlan) {
  const name = module.name?.trim() || "未命名模块";
  const parent = module.parent?.trim();
  if (!parent || name.includes(parent)) return name;
  return `${parent} / ${name}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeComplexity(value: unknown, fallback: Complexity = "medium"): Complexity {
  if (value === "minimal" || value === "simple" || value === "medium" || value === "complex" || value === "large") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.toLowerCase();
  if (normalized.includes("极简") || normalized.includes("very simple") || normalized.includes("tiny")) return "minimal";
  if (normalized.includes("简单") || normalized.includes("simple")) return "simple";
  if (normalized.includes("中等") || normalized.includes("medium") || normalized.includes("normal")) return "medium";
  if (normalized.includes("复杂") || normalized.includes("complex")) return "complex";
  if (normalized.includes("大型") || normalized.includes("large") || normalized.includes("enterprise")) return "large";
  return fallback;
}

function normalizeRiskLevel(value: unknown, fallback: RiskLevel = "medium"): RiskLevel {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.toLowerCase();
  if (normalized.includes("低") || normalized.includes("low")) return "low";
  if (normalized.includes("中") || normalized.includes("medium")) return "medium";
  if (normalized.includes("高") || normalized.includes("high")) return "high";
  if (normalized.includes("严重") || normalized.includes("critical")) return "critical";
  return fallback;
}

function normalizeStringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, limit);
}

function normalizeDesignTechniques(value: unknown, fallback: TestDesignTechnique[] = []) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[、,，/｜|\s]+/)
      : [];
  const matched = rawItems
    .map((item) => String(item).trim())
    .flatMap((item) => designTechniques.filter((technique) => item === technique || item.includes(technique) || technique.includes(item)))
    .filter((item, index, source) => source.indexOf(item) === index)
    .slice(0, 8);
  return matched.length ? matched : fallback.slice(0, 8);
}

function normalizeTestDataRequirements(value: unknown, limit = 12): TestDataRequirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): TestDataRequirement | null => {
      const source = item as Partial<TestDataRequirement>;
      const name = source.name?.trim();
      if (!name) return null;
      return {
        id: source.id?.trim() || `TD-${String(index + 1).padStart(2, "0")}`,
        name,
        scope: source.scope?.trim() || "模块级测试数据",
        values: normalizeStringList(source.values, 16),
        setup: source.setup?.trim() || "按测试前置条件准备数据。",
        cleanup: source.cleanup?.trim() || "测试后清理或回滚产生的数据。",
        owner: source.owner?.trim(),
      };
    })
    .filter((item): item is TestDataRequirement => item !== null)
    .slice(0, limit);
}

function normalizeEnvironmentRequirements(value: unknown, limit = 12): TestEnvironmentRequirement[] {
  const environmentTypes: TestEnvironmentRequirement["type"][] = ["账号", "角色", "配置", "状态", "依赖服务", "第三方", "数据", "其他"];
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): TestEnvironmentRequirement | null => {
      const source = item as Partial<TestEnvironmentRequirement>;
      const name = source.name?.trim();
      if (!name) return null;
      return {
        id: source.id?.trim() || `ENV-${String(index + 1).padStart(2, "0")}`,
        name,
        type: environmentTypes.includes(source.type as TestEnvironmentRequirement["type"]) ? (source.type as TestEnvironmentRequirement["type"]) : "其他",
        description: source.description?.trim() || "模块执行所需环境依赖。",
        dependencies: normalizeStringList(source.dependencies, 16),
        setup: source.setup?.trim() || "测试前确认环境、账号、配置和依赖服务可用。",
        cleanup: source.cleanup?.trim() || "测试后恢复配置、账号状态或依赖数据。",
      };
    })
    .filter((item): item is TestEnvironmentRequirement => item !== null)
    .slice(0, limit);
}

function normalizeUncertainties(value: unknown, limit = 12): RequirementUncertainty[] {
  const uncertaintyTypes: RequirementUncertainty["type"][] = ["无法确定的规则", "需要产品确认的问题", "基于假设生成"];
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): RequirementUncertainty | null => {
      const source = item as Partial<RequirementUncertainty>;
      const title = source.title?.trim();
      const detail = source.detail?.trim();
      if (!title && !detail) return null;
      return {
        id: source.id?.trim() || `UNC-${String(index + 1).padStart(2, "0")}`,
        type: uncertaintyTypes.includes(source.type as RequirementUncertainty["type"]) ? (source.type as RequirementUncertainty["type"]) : "需要产品确认的问题",
        title: title || "需求规则待确认",
        detail: detail || "PRD 未明确该规则，需要人工确认。",
        impact: source.impact?.trim() || "可能影响用例预期、边界范围或验收口径。",
        question: source.question?.trim(),
        relatedRequirementId: source.relatedRequirementId?.trim(),
      };
    })
    .filter((item): item is RequirementUncertainty => item !== null)
    .slice(0, limit);
}

function sanitizeCategoryTargets(value: unknown, max = 999): CategoryTargetMap {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(categories.map((category) => [category, clamp(Math.round(Number(source[category] ?? 0) || 0), 0, max)])) as Record<TestCategory, number>;
}

function coverageTotal(coverage: CategoryTargetMap) {
  return categories.reduce((sum, category) => sum + Math.max(0, Math.round(coverage[category] ?? 0)), 0);
}

function normalizeTestPoint(value: string | Partial<CoverageTestPoint>, index: number, moduleName: string): CoverageTestPoint {
  if (typeof value === "string") {
    const name = value.trim() || `${moduleName}测试点 ${index + 1}`;
    const coverage = { 功能: 2 } satisfies CategoryTargetMap;
    return {
      id: `TP-${String(index + 1).padStart(2, "0")}`,
      name,
      evidence: "PRD 显式描述",
      requirementSection: "PRD 显式描述",
      sourceQuote: name,
      fields: [],
      states: [],
      roles: [],
      flows: [],
      rules: [],
      designTechniques: ["等价类"],
      riskLevel: "medium",
      riskFactors: [],
      coverage,
      expectedCaseCount: coverageTotal(coverage),
    };
  }

  const name = value.name?.trim() || `${moduleName}测试点 ${index + 1}`;
  const coverage = sanitizeCategoryTargets(value.coverage);
  const expectedCaseCount = Math.max(1, Math.round((value.expectedCaseCount ?? coverageTotal(coverage)) || 1));

  return {
    id: value.id?.trim() || `TP-${String(index + 1).padStart(2, "0")}`,
    name,
    evidence: value.evidence?.trim() || "PRD 显式描述",
    requirementId: value.requirementId?.trim(),
    requirementSection: value.requirementSection?.trim(),
    sourceQuote: value.sourceQuote?.trim() || value.evidence?.trim(),
    fields: normalizeStringList(value.fields, 12),
    states: normalizeStringList(value.states, 12),
    roles: normalizeStringList(value.roles, 12),
    flows: normalizeStringList(value.flows, 12),
    rules: normalizeStringList(value.rules, 12),
    designTechniques: normalizeDesignTechniques(value.designTechniques, ["等价类"]),
    riskLevel: normalizeRiskLevel(value.riskLevel),
    riskFactors: normalizeStringList(value.riskFactors, 12),
    coverage: coverageTotal(coverage) > 0 ? coverage : { 功能: expectedCaseCount },
    expectedCaseCount,
    locked: Boolean(value.locked),
  };
}

function refineComplexity(module: ModulePlan, documentComplexity: Complexity): Complexity {
  const pointCount = module.testPoints?.length ?? 0;
  const riskCount = module.riskPoints?.length ?? 0;
  let complexity = normalizeComplexity(module.complexity, documentComplexity);

  if (pointCount <= 1 && riskCount <= 1 && !module.isCore) complexity = "minimal";
  else if (pointCount <= 3 && riskCount <= 2 && complexity !== "minimal" && complexity !== "simple" && !module.isCore) complexity = "simple";
  else if (module.isCore && pointCount >= 8 && riskCount >= 4 && complexity !== "large") complexity = "complex";

  return complexity;
}

function estimateTargetCaseCount(module: ModulePlan) {
  const complexity = module.complexity ?? "medium";
  const bounds = complexityBounds[complexity];
  const pointCount = module.testPoints?.length ?? 0;
  const riskCount = module.riskPoints?.length ?? 0;
  const riskLevel = module.riskLevel ?? "medium";
  const riskLevelBump = riskLevel === "critical" ? 8 : riskLevel === "high" ? 5 : riskLevel === "medium" ? 2 : 0;
  const coreBump = module.isCore ? 4 : 0;
  const pointCoverageTotal = module.testPoints.reduce((sum, point) => sum + (point.expectedCaseCount || coverageTotal(point.coverage)), 0);
  const estimated = bounds.base + pointCount * bounds.perPoint + riskCount * bounds.perRisk + riskLevelBump + coreBump;
  const requested = typeof module.targetCaseCount === "number" && Number.isFinite(module.targetCaseCount) && module.targetCaseCount > 0 ? module.targetCaseCount : Math.max(estimated, pointCoverageTotal);
  return clamp(Math.round(requested), bounds.min, Math.max(bounds.max, pointCoverageTotal));
}

function hasCategorySignal(module: ModulePlan, category: Exclude<TestCategory, "功能">) {
  const pointText = module.testPoints.flatMap((point) => [
    point.name,
    point.evidence,
    point.requirementId,
    point.requirementSection,
    point.sourceQuote,
    ...point.fields,
    ...point.states,
    ...point.roles,
    ...point.flows,
    ...point.rules,
    ...(point.designTechniques ?? []),
    ...point.riskFactors,
  ]);
  const text = [module.name, module.parent, module.description, ...(module.designTechniques ?? []), ...pointText, ...(module.riskPoints ?? [])].filter(Boolean).join(" ");
  return categorySignalWords[category].some((word) => text.includes(word));
}

function normalizeCategoryTargets(module: ModulePlan, total: number): CategoryTargetMap {
  const pointTargets = Object.fromEntries(categories.map((category) => [category, module.testPoints.reduce((sum, point) => sum + Math.max(0, Math.round(point.coverage[category] ?? 0)), 0)])) as Record<
    TestCategory,
    number
  >;
  const providedTargets = sanitizeCategoryTargets(module.categoryTargets, total);
  const sanitized = Object.fromEntries(
    categories.map((category) => [category, clamp(Math.round(providedTargets[category] || pointTargets[category] || 0), 0, total)]),
  ) as Record<TestCategory, number>;
  const rawTotal = categories.reduce((sum, category) => sum + sanitized[category], 0);

  if (rawTotal > 0) {
    const scaled = { ...sanitized };
    if (rawTotal !== total) {
      const ratio = total / rawTotal;
      for (const category of categories) scaled[category] = Math.max(scaled[category] > 0 ? 1 : 0, Math.round(scaled[category] * ratio));
      let diff = total - categories.reduce((sum, category) => sum + scaled[category], 0);
      while (diff !== 0) {
        const category = diff > 0 ? "功能" : categories.find((item) => item !== "功能" && scaled[item] > 0) ?? "功能";
        if (diff < 0 && scaled[category] <= 0) break;
        scaled[category] += diff > 0 ? 1 : -1;
        diff += diff > 0 ? -1 : 1;
      }
    }
    return scaled;
  }

  const targets = Object.fromEntries(categories.map((category) => [category, 0])) as Record<TestCategory, number>;
  targets["功能"] = Math.max(2, Math.ceil(total * (total <= 10 ? 0.68 : 0.58)));

  for (const category of ["边界", "异常", "权限", "性能"] as const) {
    if (!hasCategorySignal(module, category)) continue;
    const ratio = category === "性能" ? 0.08 : category === "权限" ? 0.1 : 0.12;
    targets[category] = Math.max(1, Math.round(total * ratio));
  }

  let currentTotal = categories.reduce((sum, category) => sum + targets[category], 0);
  while (currentTotal > total) {
    const reducible = (["性能", "权限", "异常", "边界", "功能"] as TestCategory[]).find((category) => targets[category] > (category === "功能" ? 2 : 0));
    if (!reducible) break;
    targets[reducible] -= 1;
    currentTotal -= 1;
  }
  targets["功能"] += Math.max(0, total - currentTotal);

  return targets;
}

function scaleCoverageForProfile(coverage: CategoryTargetMap, profile: TestGenerationProfile) {
  const config = generationProfileConfigs[profile];
  const scaled = Object.fromEntries(
    categories.map((category) => {
      const count = Math.max(0, Math.round(coverage[category] ?? 0));
      if (!count) return [category, 0];
      const weighted = count * config.caseMultiplier * (config.categoryWeights[category] ?? 1);
      return [category, Math.max(1, Math.round(weighted))];
    }),
  ) as Record<TestCategory, number>;

  if (profile === "smoke") {
    scaled["边界"] = Math.min(scaled["边界"], 1);
    scaled["性能"] = Math.min(scaled["性能"], 1);
  }

  return scaled;
}

function capModuleCoverage(module: ModulePlan, maxTotal: number) {
  const currentTotal = coverageTotal(module.categoryTargets);
  if (currentTotal <= maxTotal || currentTotal <= 0) return module;

  const ratio = maxTotal / currentTotal;
  const categoryTargets = Object.fromEntries(
    categories.map((category) => {
      const count = Math.round((module.categoryTargets[category] ?? 0) * ratio);
      return [category, module.categoryTargets[category] ? Math.max(1, count) : 0];
    }),
  ) as Record<TestCategory, number>;

  let diff = maxTotal - coverageTotal(categoryTargets);
  while (diff !== 0) {
    const category = diff > 0 ? "功能" : categories.find((item) => categoryTargets[item] > (item === "功能" ? 1 : 0)) ?? "功能";
    categoryTargets[category] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }

  return {
    ...module,
    categoryTargets,
    targetCaseCount: coverageTotal(categoryTargets),
  };
}

function applyGenerationProfileToModule(module: ModulePlan, profile: TestGenerationProfile) {
  const config = generationProfileConfigs[profile];
  const categoryTargets = scaleCoverageForProfile(module.categoryTargets, profile);

  if (profile === "permission-first" && hasCategorySignal(module, "权限") && !categoryTargets["权限"]) categoryTargets["权限"] = 1;
  if (profile === "api-first" && hasCategorySignal(module, "异常") && !categoryTargets["异常"]) categoryTargets["异常"] = 1;
  if (profile === "release-risk" && (module.riskLevel === "high" || module.riskLevel === "critical") && !categoryTargets["异常"]) categoryTargets["异常"] = 1;

  const testPoints = module.testPoints.map((point) => {
    const coverage = scaleCoverageForProfile(point.coverage, profile);
    if (profile === "permission-first" && point.roles.length && !coverage["权限"]) coverage["权限"] = 1;
    return {
      ...point,
      coverage,
      expectedCaseCount: Math.max(1, coverageTotal(coverage)),
    };
  });

  const targetCaseCount = Math.max(module.isCore ? config.minCoreCases : 1, coverageTotal(categoryTargets));
  const maxModuleTotal = profile === "high-coverage" ? 72 : profile === "smoke" ? 10 : 48;
  return capModuleCoverage(
    {
      ...module,
      testPoints,
      categoryTargets,
      targetCaseCount,
    },
    maxModuleTotal,
  );
}

function capBlueprintModules(modules: ModulePlan[], profile: TestGenerationProfile) {
  const maxPlannedCases = generationProfileConfigs[profile].maxPlannedCases;
  const total = modules.reduce((sum, module) => sum + module.targetCaseCount, 0);
  if (total <= maxPlannedCases || total <= 0) return modules;

  const ratio = maxPlannedCases / total;
  return modules.map((module) => capModuleCoverage(module, Math.max(module.isCore ? generationProfileConfigs[profile].minCoreCases : 1, Math.round(module.targetCaseCount * ratio))));
}

function normalizeModulePlan(payload: ModulePlanResponse, options: { generationProfile?: TestGenerationProfile; preserveSubmittedTargets?: boolean } = {}) {
  const seen = new Set<string>();
  const documentComplexity = normalizeComplexity(payload.documentComplexity, "medium");
  const generationProfile = options.generationProfile ?? "standard";
  const modules = (payload.modules ?? [])
    .map((item): ModulePlan | null => {
      const name = item.name?.trim();
      if (!name) return null;
      const moduleName = name;
      const testPoints = (item.testPoints ?? []).map((point, pointIndex) => normalizeTestPoint(point, pointIndex, moduleName)).filter((point) => Boolean(point.name)).slice(0, 60);
      return {
        name,
        parent: item.parent?.trim(),
        description: item.description?.trim(),
        complexity: normalizeComplexity(item.complexity, documentComplexity),
        riskLevel: normalizeRiskLevel(item.riskLevel),
        isCore: Boolean(item.isCore),
        testPoints,
        riskPoints: normalizeStringList(item.riskPoints, 16),
        testData: normalizeTestDataRequirements(item.testData),
        environment: normalizeEnvironmentRequirements(item.environment),
        uncertainties: normalizeUncertainties(item.uncertainties),
        designTechniques: normalizeDesignTechniques(item.designTechniques, testPoints.flatMap((point) => point.designTechniques ?? [])),
        categoryTargets: sanitizeCategoryTargets(item.categoryTargets),
        skippedCategories: normalizeStringList(item.skippedCategories, 8),
        coverageNotes: normalizeStringList(item.coverageNotes, 8),
        targetCaseCount: typeof item.targetCaseCount === "number" && Number.isFinite(item.targetCaseCount) ? item.targetCaseCount : 0,
        locked: Boolean(item.locked),
      };
    })
    .filter((item): item is ModulePlan => item !== null)
    .filter((item) => {
      const key = formatModuleName(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);

  const normalizedModules = modules.map((item) => {
    const complexity = refineComplexity(item, documentComplexity);
    const normalized = { ...item, complexity, name: item.name || "未命名模块" } as ModulePlan;
    const submittedCategoryTotal = coverageTotal(normalized.categoryTargets);
    const targetCaseCount = options.preserveSubmittedTargets
      ? clamp(Math.round(normalized.targetCaseCount || submittedCategoryTotal || estimateTargetCaseCount(normalized)), 1, 160)
      : estimateTargetCaseCount(normalized);
    return {
      ...normalized,
      targetCaseCount,
      categoryTargets: normalizeCategoryTargets(normalized, targetCaseCount),
    };
  });

  if (options.preserveSubmittedTargets) return normalizedModules;
  return capBlueprintModules(normalizedModules.map((module) => applyGenerationProfileToModule(module, generationProfile)), generationProfile);
}

function normalizeCoverageBlueprintInput(value: unknown, generationProfile: TestGenerationProfile): CoverageBlueprint {
  const payload = value as Partial<CoverageBlueprint> | null;
  if (!payload || !Array.isArray(payload.modules)) throw new Error("测试策略格式不正确，请重新生成覆盖蓝图。");
  const documentComplexity = normalizeComplexity(payload.documentComplexity, "medium");
  const modules = normalizeModulePlan(
    {
      documentComplexity,
      coverageRationale: payload.coverageRationale,
      modules: payload.modules,
    },
    { generationProfile, preserveSubmittedTargets: true },
  );
  if (!modules.length) throw new Error("测试策略中没有可生成的模块。");
  return buildCoverageBlueprint(documentComplexity, payload.coverageRationale?.trim() || "按已确认测试策略生成测试用例。", modules, payload.generationProfile ?? generationProfile, normalizeUncertainties(payload.uncertainties));
}

function parseCoverageBlueprintInput(value: FormDataEntryValue | null, generationProfile: TestGenerationProfile) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return normalizeCoverageBlueprintInput(parseJsonObject<CoverageBlueprint>(value), generationProfile);
}

function getRelevantPrdText(text: string, module: ModulePlan) {
  const chunks = text
    .split(/(?<=[。！？.!?；;])\s+|[\n\r]+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 8);
  const testPointKeywords = module.testPoints.flatMap((point) => [
    point.name,
    point.evidence,
    point.requirementId,
    point.requirementSection,
    point.sourceQuote,
    ...point.fields,
    ...point.states,
    ...point.roles,
    ...point.flows,
    ...point.rules,
    ...(point.designTechniques ?? []),
    ...point.riskFactors,
  ]);
  const keywords = [module.name, module.parent, ...testPointKeywords, ...(module.riskPoints ?? [])]
    .filter(Boolean)
    .flatMap((item) => String(item).split(/[、,，/｜|()（）\s]+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 30);

  const matched = chunks.filter((chunk) => keywords.some((keyword) => chunk.includes(keyword)));
  const source = matched.length >= 6 ? matched : chunks;
  return source.join("\n").slice(0, matched.length >= 6 ? 22_000 : 32_000);
}

function getCaseTargets(module: ModulePlan) {
  const total = module.targetCaseCount ?? estimateTargetCaseCount(module);
  const categoryTargets = normalizeCategoryTargets(module, total);
  const functional = categoryTargets["功能"] ?? 0;
  const negativeFunctional = Math.max(functional >= 6 ? 2 : 1, Math.ceil(functional * 0.35));
  return {
    total,
    functional,
    negativeFunctional: Math.min(functional, negativeFunctional),
    boundary: categoryTargets["边界"] ?? 0,
    exception: categoryTargets["异常"] ?? 0,
    permission: categoryTargets["权限"] ?? 0,
    performance: categoryTargets["性能"] ?? 0,
    categoryTargets,
    testPoints: module.testPoints,
  };
}

function isNegativeCase(item: TestCase) {
  const text = [item.title, item.preconditions, item.expectedResult, ...item.steps].join(" ").toLowerCase();
  return negativeSignals.some((signal) => text.includes(signal.toLowerCase()));
}

function getNegativeCoverageGap(cases: TestCase[], targets: ReturnType<typeof getCaseTargets>) {
  const functionalCases = cases.filter((item) => item.category === "功能");
  const negativeFunctionalCount = functionalCases.filter(isNegativeCase).length;
  return Math.max(0, targets.negativeFunctional - negativeFunctionalCount);
}

function getCategoryCounts(cases: TestCase[]) {
  return Object.fromEntries(categories.map((category) => [category, cases.filter((item) => item.category === category).length])) as Record<TestCategory, number>;
}

function caseMatchesTestPoint(item: TestCase, point: CoverageTestPoint) {
  const haystack = [item.testPointId, item.testPoint, item.evidence, item.title, item.preconditions, item.expectedResult, ...item.steps].filter(Boolean).join(" ");
  return haystack.includes(point.id) || haystack.includes(point.name);
}

function formatTargets(targets: ReturnType<typeof getCaseTargets>) {
  const parts = [
    `功能 ${targets.functional}`,
    targets.boundary ? `边界 ${targets.boundary}` : "",
    targets.exception ? `异常 ${targets.exception}` : "",
    targets.permission ? `权限 ${targets.permission}` : "",
    targets.performance ? `性能 ${targets.performance}` : "",
  ].filter(Boolean);
  return parts.join("、");
}

function formatTestPointForPrompt(point: CoverageTestPoint, index: number) {
  const coverage = categories.map((category) => `${category}:${point.coverage[category] ?? 0}`).join("、");
  const details = [
    `需求编号:${point.requirementId || "无"}`,
    `章节:${point.requirementSection || "无"}`,
    `原文:${point.sourceQuote || point.evidence || "无"}`,
    `字段:${point.fields.join("、") || "无"}`,
    `状态:${point.states.join("、") || "无"}`,
    `角色:${point.roles.join("、") || "无"}`,
    `流程:${point.flows.join("、") || "无"}`,
    `规则:${point.rules.join("、") || "无"}`,
    `设计方法:${point.designTechniques?.join("、") || "等价类"}`,
    `风险:${point.riskFactors.join("、") || "无"}`,
  ].join("；");
  return `${index + 1}. ${point.id}｜${point.name}｜依据：${point.evidence}｜风险：${point.riskLevel}｜覆盖：${coverage}｜${details}`;
}

function formatTestDataForPrompt(items: TestDataRequirement[] | undefined) {
  if (!items?.length) return "无";
  return items
    .map((item, index) => `${index + 1}. ${item.id}｜${item.name}｜范围：${item.scope}｜数据：${item.values.join("、") || "待准备"}｜准备：${item.setup}｜清理：${item.cleanup}`)
    .join("\n");
}

function formatEnvironmentForPrompt(items: TestEnvironmentRequirement[] | undefined) {
  if (!items?.length) return "无";
  return items
    .map((item, index) => `${index + 1}. ${item.id}｜${item.name}｜类型：${item.type}｜说明：${item.description}｜依赖：${item.dependencies.join("、") || "无"}｜准备：${item.setup}｜清理：${item.cleanup}`)
    .join("\n");
}

function formatUncertaintiesForPrompt(items: RequirementUncertainty[] | undefined) {
  if (!items?.length) return "无";
  return items
    .map((item, index) => `${index + 1}. ${item.id}｜${item.type}｜${item.title}｜${item.detail}｜影响：${item.impact}${item.question ? `｜确认问题：${item.question}` : ""}`)
    .join("\n");
}

function getCoverageGaps(cases: TestCase[], targets: ReturnType<typeof getCaseTargets>) {
  const counts = getCategoryCounts(cases);
  const categoryGaps = Object.fromEntries(
    categories.map((category) => [category, Math.max(0, (targets.categoryTargets[category] ?? 0) - counts[category])]),
  ) as Record<TestCategory, number>;
  const negativeFunctionalGap = getNegativeCoverageGap(cases, targets);
  categoryGaps["功能"] = Math.max(categoryGaps["功能"], negativeFunctionalGap);
  const pointGaps = targets.testPoints
    .map((point) => {
      const matched = cases.filter((item) => caseMatchesTestPoint(item, point));
      const categoryGapsForPoint = Object.fromEntries(
        categories.map((category) => [category, Math.max(0, Math.round(point.coverage[category] ?? 0) - matched.filter((item) => item.category === category).length)]),
      ) as Record<TestCategory, number>;
      const totalGapForPoint = categories.reduce((sum, category) => sum + categoryGapsForPoint[category], 0);
      return { point, categoryGaps: categoryGapsForPoint, totalGap: totalGapForPoint };
    })
    .filter((item) => item.totalGap > 0);

  for (const category of categories) {
    const pointCategoryGap = pointGaps.reduce((sum, item) => sum + item.categoryGaps[category], 0);
    categoryGaps[category] = Math.max(categoryGaps[category], pointCategoryGap);
  }

  const totalGap = categories.reduce((sum, category) => sum + categoryGaps[category], 0);

  return {
    categoryGaps,
    negativeFunctionalGap,
    pointGaps,
    totalGap,
  };
}

function normalizeQualityFindings(value: unknown, limit = 8): QualityFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): QualityFinding | null => {
      const source = item as Partial<QualityFinding>;
      const severity: QualityFinding["severity"] = source.severity === "high" || source.severity === "medium" || source.severity === "info" ? source.severity : "info";
      const detail = source.detail?.trim();
      const suggestion = source.suggestion?.trim();
      if (!detail && !suggestion) return null;
      return {
        severity,
        issueType: source.issueType?.trim() || "质量审查",
        caseId: source.caseId?.trim(),
        title: source.title?.trim(),
        detail: detail || "需要人工确认该用例质量。",
        suggestion: suggestion || "请补充可执行步骤、可验证预期和 PRD 依据。",
      };
    })
    .filter((item): item is QualityFinding => item !== null)
    .slice(0, limit);
}

function normalizeCases(cases: TestCase[], module: ModulePlan): TestCase[] {
  return cases
    .map((item) => {
      const category = categories.includes(item.category) ? item.category : "功能";
      const priority = priorities.includes(item.priority) ? item.priority : category === "功能" ? "P1" : "P2";
      const expectedResults = normalizeStringList(item.expectedResults, 20);
      const maintainer = normalizeTemplateText(item.maintainer, defaultMaintainer);
      return {
        id: item.id || "",
        category,
        title: item.title?.trim() || `${formatModuleName(module)}测试用例`,
        priority,
        module: formatModuleName(module),
        status: normalizeTemplateText(item.status),
        maintainer,
        caseType: normalizeCaseType(item.caseType, category),
        executionType: normalizeExecutionType(item.executionType),
        estimatedHours: normalizeNullableNumber(item.estimatedHours),
        remainingHours: normalizeNullableNumber(item.remainingHours),
        relatedWorkItems: normalizeTemplateText(item.relatedWorkItems),
        requirementId: item.requirementId?.trim(),
        requirementSection: item.requirementSection?.trim(),
        sourceQuote: item.sourceQuote?.trim(),
        testPointId: item.testPointId?.trim(),
        testPoint: item.testPoint?.trim(),
        evidence: item.evidence?.trim(),
        fieldsCovered: normalizeStringList(item.fieldsCovered, 12),
        statesCovered: normalizeStringList(item.statesCovered, 12),
        rulesCovered: normalizeStringList(item.rulesCovered, 12),
        riskTags: normalizeStringList(item.riskTags, 12),
        designTechniques: normalizeDesignTechniques(item.designTechniques),
        testDataRefs: normalizeStringList(item.testDataRefs, 12),
        environmentRefs: normalizeStringList(item.environmentRefs, 12),
        assumptions: normalizeStringList(item.assumptions, 8),
        uncertaintyRefs: normalizeStringList(item.uncertaintyRefs, 8),
        requiresConfirmation: Boolean(item.requiresConfirmation),
        preconditions: item.preconditions?.trim() || `${formatModuleName(module)}模块可访问，测试数据和依赖服务可用。`,
        steps: (item.steps ?? []).map((step) => step.trim()).filter(Boolean),
        expectedResults: expectedResults.length ? expectedResults : undefined,
        expectedResult: item.expectedResult?.trim() || "结果符合 PRD 预期。",
        followers: normalizeTemplateText(item.followers, maintainer),
        remarks: normalizeTemplateText(item.remarks),
        qualityFindings: normalizeQualityFindings(item.qualityFindings),
      };
    })
    .filter((item) => item.title && item.steps.length >= 1);
}

function dedupeAndRenumber(cases: TestCase[]) {
  const seen = new Set<string>();
  const deduped: TestCase[] = [];

  for (const item of cases) {
    const key = `${item.module}|${item.category}|${item.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped.map((item, index) => ({
    ...item,
    id: `TC-${String(index + 1).padStart(3, "0")}`,
  }));
}

function normalizeSimilarityText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/(验证|测试|检查|确认|成功|失败|功能|流程|场景|是否|正常)/g, "");
}

function charBigrams(value: string) {
  const text = normalizeSimilarityText(value);
  if (text.length <= 1) return new Set(text ? [text] : []);
  const grams = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) grams.add(text.slice(index, index + 2));
  return grams;
}

function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function caseSemanticText(item: TestCase) {
  return [item.testPointId, item.testPoint, item.title, item.preconditions, ...item.steps, item.expectedResult].filter(Boolean).join(" ");
}

function caseSimilarity(left: TestCase, right: TestCase) {
  if (left.module !== right.module || left.category !== right.category) return 0;
  const samePoint = Boolean(left.testPointId && right.testPointId && left.testPointId === right.testPointId) || Boolean(left.testPoint && right.testPoint && left.testPoint === right.testPoint);
  const titleSimilarity = jaccardSimilarity(charBigrams(left.title), charBigrams(right.title));
  const semanticSimilarity = jaccardSimilarity(charBigrams(caseSemanticText(left)), charBigrams(caseSemanticText(right)));
  const threshold = samePoint ? 0.64 : 0.78;
  return Math.max(titleSimilarity, semanticSimilarity) >= threshold ? Math.max(titleSimilarity, semanticSimilarity) : 0;
}

function scoreCaseCompleteness(item: TestCase) {
  return [
    item.title.length > 10,
    item.steps.length >= 2,
    Boolean(item.expectedResult && item.expectedResult.length >= 8),
    Boolean(item.evidence || item.sourceQuote),
    Boolean(item.requirementSection || item.requirementId),
    Boolean(item.designTechniques?.length),
    Boolean(item.testDataRefs?.length),
    Boolean(item.environmentRefs?.length),
  ].filter(Boolean).length;
}

function chooseBetterCase(left: TestCase, right: TestCase) {
  if (scoreCaseCompleteness(right) > scoreCaseCompleteness(left)) return right;
  if (right.priority === "P0" && left.priority !== "P0") return right;
  return left;
}

function semanticDedupeAndRenumber(cases: TestCase[]) {
  const exactDeduped = dedupeAndRenumber(cases);
  const deduped: TestCase[] = [];
  const findings: QualityFinding[] = [];
  let semanticDuplicateCount = 0;

  for (const item of exactDeduped) {
    const duplicateIndex = deduped.findIndex((candidate) => caseSimilarity(candidate, item) > 0);
    if (duplicateIndex < 0) {
      deduped.push(item);
      continue;
    }

    semanticDuplicateCount += 1;
    const existing = deduped[duplicateIndex];
    const selected = chooseBetterCase(existing, item);
    const removed = selected === existing ? item : existing;
    deduped[duplicateIndex] = {
      ...selected,
      remarks: [selected.remarks, removed.remarks, `语义去重：已合并 ${removed.title}`].filter(Boolean).join("\n"),
    };
    findings.push({
      severity: "info",
      issueType: "语义重复合并",
      caseId: removed.id,
      title: removed.title,
      detail: `与“${selected.title}”测试目的和步骤高度相似，已保留信息更完整的一条。`,
      suggestion: "同一测试点下只保留粒度最清晰、证据链最完整的用例。",
    });
  }

  return {
    cases: deduped.map((item, index) => ({ ...item, id: `TC-${String(index + 1).padStart(3, "0")}` })),
    findings,
    semanticDuplicateCount,
  };
}

function metric(id: string, label: string, score: number, detail: string): GenerationEvaluationMetric {
  return { id, label, score: clamp(Math.round(score), 0, 100), detail };
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return 100;
  return (numerator / denominator) * 100;
}

function buildGenerationEvaluation({
  blueprint,
  cases,
  semanticDuplicateCount,
}: {
  blueprint: CoverageBlueprint;
  cases: TestCase[];
  semanticDuplicateCount: number;
}) {
  const modules = blueprint.modules;
  const testPoints = modules.flatMap((module) => module.testPoints.map((point) => ({ module, point })));
  const coveredPoints = testPoints.filter(({ point }) => cases.some((item) => caseMatchesTestPoint(item, point))).length;
  const evidenceCases = cases.filter((item) => item.evidence || item.sourceQuote || item.requirementSection).length;
  const executableCases = cases.filter((item) => item.steps.length >= 2 && item.steps.every((step) => !/^(验证|检查|测试|确认)$/.test(step.trim()))).length;
  const verifiableCases = cases.filter((item) => item.expectedResult.length >= 8 && ((item.expectedResults?.length ?? 0) === 0 || item.expectedResults?.length === item.steps.length)).length;
  const coreModules = modules.filter((module) => module.isCore || module.riskLevel === "high" || module.riskLevel === "critical");
  const p0CoveredCore = coreModules.filter((module) => cases.some((item) => item.module === formatModuleName(module) && item.priority === "P0")).length;
  const hallucinationRiskCases = cases.filter((item) => !item.evidence && !item.sourceQuote && !item.requirementSection && !item.requiresConfirmation).length;
  const duplicateScore = percent(Math.max(0, cases.length - semanticDuplicateCount), cases.length);

  const metrics = [
    metric("coverage", "覆盖率", percent(coveredPoints, testPoints.length), `蓝图 ${testPoints.length} 个测试点，已匹配 ${coveredPoints} 个。`),
    metric("evidence", "证据命中率", percent(evidenceCases, cases.length), `${evidenceCases}/${cases.length} 条用例带 PRD 证据、章节或原文。`),
    metric("dedupe", "重复率控制", duplicateScore, `语义去重合并 ${semanticDuplicateCount} 条。`),
    metric("executability", "可执行性", percent(executableCases, cases.length), `${executableCases}/${cases.length} 条用例步骤可执行。`),
    metric("verifiability", "预期可验证性", percent(verifiableCases, cases.length), `${verifiableCases}/${cases.length} 条用例预期结果清晰且步骤预期对齐。`),
    metric("p0-core", "P0 主链路覆盖", percent(p0CoveredCore, coreModules.length), `${p0CoveredCore}/${coreModules.length} 个核心/高风险模块有 P0 用例。`),
    metric("hallucination", "幻觉风险控制", percent(Math.max(0, cases.length - hallucinationRiskCases), cases.length), `${hallucinationRiskCases} 条用例缺少证据且未标记待确认。`),
  ];
  const score = metrics.reduce((sum, item) => sum + item.score, 0) / metrics.length;
  return {
    score: Math.round(score),
    metrics,
  };
}

function mergeQualityReport({
  evaluation,
  reviewReport,
  semanticDuplicateCount,
  semanticFindings,
  uncertaintyCount,
}: {
  evaluation: ReturnType<typeof buildGenerationEvaluation>;
  reviewReport?: GenerationQualityReport;
  semanticDuplicateCount: number;
  semanticFindings: QualityFinding[];
  uncertaintyCount: number;
}): GenerationQualityReport {
  const findings = [...(reviewReport?.findings ?? []), ...semanticFindings].slice(0, 100);
  const reviewScore = reviewReport?.score ?? evaluation.score;
  const score = Math.round(reviewScore * 0.35 + evaluation.score * 0.65);
  return {
    score,
    summary: `${reviewReport?.summary ?? "已完成自动质量评测。"} 评测基准参考 ${formatGenerationEvaluationBasis()}，按覆盖、证据、重复、可执行、可验证、P0 主链路和幻觉风险指标打分，综合 ${score} 分。`,
    revisedCaseCount: reviewReport?.revisedCaseCount ?? 0,
    findingCount: findings.length,
    findings,
    metrics: evaluation.metrics,
    semanticDuplicateCount,
    uncertaintyCount,
  };
}

function buildCoverageBlueprint(documentComplexity: Complexity, coverageRationale: string, modules: ModulePlan[], generationProfile: TestGenerationProfile, uncertainties: RequirementUncertainty[] = []): CoverageBlueprint {
  const plannedCaseCount = modules.reduce((sum, module) => sum + getCaseTargets(module).total, 0);
  return {
    generationProfile,
    documentComplexity,
    coverageRationale,
    modules,
    plannedCaseCount,
    uncertainties,
  };
}

function buildSummary(fileName: string, modules: ModulePlan[], cases: TestCase[], generationProfile: TestGenerationProfile) {
  const counts = categories.map((category) => `${category} ${cases.filter((item) => item.category === category).length} 条`).join("、");
  const coreModules = modules.filter((module) => module.isCore).map(formatModuleName).slice(0, 8);
  const plannedTotal = modules.reduce((sum, module) => sum + getCaseTargets(module).total, 0);
  const complexityCounts = modules.reduce(
    (acc, module) => {
      const complexity = module.complexity ?? "medium";
      acc[complexity] += 1;
      return acc;
    },
    { minimal: 0, simple: 0, medium: 0, complex: 0, large: 0 } as Record<Complexity, number>,
  );
  const complexityText = (Object.entries(complexityCounts) as Array<[Complexity, number]>)
    .filter(([, count]) => count > 0)
    .map(([complexity, count]) => `${complexityLabels[complexity]} ${count} 个`)
    .join("、");
  return `基于 ${fileName} 按“${getProfileLabel(generationProfile)}”模式先生成测试策略再分模块生成：识别 ${modules.length} 个功能模块（${complexityText}），蓝图计划约 ${plannedTotal} 条，实际合并 ${cases.length} 条可执行测试用例，其中 ${counts}。数量按 PRD 可测试点、风险等级、适用测试类型和生成模式自适应分配；${coreModules.length ? `核心模块包括 ${coreModules.join("、")}。` : "未单独标记核心模块。"}`;
}

function groupCasesByModule(cases: TestCase[]) {
  const grouped = new Map<string, TestCase[]>();
  for (const item of cases) grouped.set(item.module, [...(grouped.get(item.module) ?? []), item]);
  return grouped;
}

function hashSourceText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function buildFallbackResumeState(historyId: string, result: ResumableGenerateResponse): ResumeState {
  const modules = result.coverageBlueprint?.modules ?? [];
  const moduleCaseMap = groupCasesByModule(result.cases);
  const nextModuleIndex = modules.findIndex((module) => !moduleCaseMap.get(formatModuleName(module))?.length);
  return {
    historyId,
    result,
    nextModuleIndex: nextModuleIndex >= 0 ? nextModuleIndex : modules.length,
    moduleStage: nextModuleIndex >= 0 ? "module-start" : "finalize",
  };
}

function loadResumeState(historyId: string, fileName: string, sourceTextHash: string): ResumeState {
  const record = getRunHistoryRecord(historyId);
  if (!record || record.agent !== "case-generator") throw new Error("未找到可继续的用例生成记录。");
  if (record.status === "success") throw new Error("这条用例生成记录已经完成，不需要继续生成。");
  if (record.fileName !== fileName) throw new Error("续跑记录与当前上传 PDF 不一致，请重新选择同一份 PRD。");
  if (!record.result.coverageBlueprint) throw new Error("续跑记录缺少覆盖蓝图，无法继续生成。");

  const result = record.result as ResumableGenerateResponse;
  const checkpoint = record.result.checkpoint;
  if (checkpoint?.sourceTextHash && checkpoint.sourceTextHash !== sourceTextHash) {
    throw new Error("续跑记录与当前 PDF 内容不一致，请上传上次中断时使用的同一份 PRD。");
  }
  if (!checkpoint) return buildFallbackResumeState(record.id, result);

  return {
    historyId: record.id,
    result,
    nextModuleIndex: checkpoint.nextModuleIndex,
    moduleStage: checkpoint.moduleStage,
  };
}

async function generateModulePlan({
  apiKey,
  baseURL,
  fileName,
  generationProfile,
  model,
  onEvent,
  provider,
  reasoningEffort,
  signal,
  text,
  thinkingMode,
}: {
  apiKey: string;
  baseURL?: string;
  fileName: string;
  generationProfile: TestGenerationProfile;
  model: string;
  onEvent: (event: StreamEvent) => void;
  provider: LlmProvider;
  reasoningEffort: ReasoningEffort;
  signal?: AbortSignal;
  text: string;
  thinkingMode: ThinkingMode;
}) {
  const startedAt = Date.now();
  const profileConfig = generationProfileConfigs[generationProfile];
  onEvent({
    type: "stage",
    message: "阶段 1：生成覆盖蓝图",
    detail: `${providerDefaults[provider].label} / ${model} / ${profileConfig.label}`,
  });

  const truncatedText = text.slice(0, 45_000);
  const { payload, rawLength, usage } = await streamJsonRequest<ModulePlanResponse>({
    apiKey,
    baseURL,
    model,
    provider,
    maxTokens: 8_000,
    stageLabel: "模块识别",
    onEvent,
    reasoningEffort,
    thinkingMode,
    signal,
    messages: [
      {
        role: "system",
        content:
          "你是资深测试架构师。你的任务是从任意行业、任意产品形态的 PRD 中生成测试覆盖蓝图，不生成测试用例。覆盖蓝图必须决定应该测什么、测多少、哪些类型适用，避免简单 PRD 被硬凑，也避免复杂 PRD 漏测。只输出严格 JSON object。",
      },
      {
        role: "user",
        content: `文件名：${fileName}

请从下面 PRD 中生成测试覆盖蓝图。要求：
1. 不要假设产品类型。先从 PRD 自身识别业务域、用户角色、使用场景、端类型和核心对象。
2. 当前生成模式：${profileConfig.label}。${profileConfig.promptGuidance} 计划总数通常不超过 ${profileConfig.maxPlannedCases} 条，核心模块至少 ${profileConfig.minCoreCases} 条；不要为了模式硬编 PRD 没有依据的功能。
3. documentComplexity 只能是 minimal/simple/medium/complex/large，用于描述整份 PRD 复杂度。
4. modules 必须覆盖所有可测试范围：一级模块、子模块、页面/接口/流程/任务、配置项、数据对象、状态机、字段规则、业务规则、通知、报表、导入导出、第三方集成、权限、审计、异常和性能相关能力。
5. testPoints 必须是原子测试点对象数组，不要把多个测试点合成一句；只列 PRD 有依据的测试点。
6. riskPoints 列出该模块需要重点覆盖的边界、异常、权限、安全、兼容、性能、数据一致性和幂等风险。
7. 每个模块必须给出 testData、environment 和 uncertainties。testData 写测试账号、角色、状态、配置、业务数据、第三方返回等数据要求；environment 写依赖服务、开关、网关、队列、缓存、权限、数据清理要求；uncertainties 写 PRD 不明确、需产品确认或必须基于假设生成的点。
8. 不确定规则不要硬编成确定结论；必须放入 uncertainties，并说明影响、确认问题或假设。
9. complexity 只能是 minimal/simple/medium/complex/large；riskLevel 只能是 low/medium/high/critical。
10. 每个模块和 testPoint 都要给出 designTechniques，只能从这些测试设计方法中选择：${designTechniques.join("、")}。
11. 每个 testPoint 必须包含 evidence、requirementId、requirementSection、sourceQuote、fields、states、roles、flows、rules、designTechniques、riskLevel、riskFactors、coverage、expectedCaseCount。
12. requirementId 写 PRD 中的需求编号/条款编号/故事编号；没有明确编号填空字符串。requirementSection 写章节或页面/接口/流程标题。sourceQuote 写不超过 80 字的原文证据。
13. evidence 写 PRD 中可定位的依据，例如章节标题、条款、原文短句，不要写“自行推断”。
14. coverage 是该原子测试点各类型建议生成条数，必须由字段、状态、角色、流程、规则、设计方法、生成模式和风险决定。没有依据的类型填 0。
15. categoryTargets 是该模块各类型建议生成条数，必须等于所有 testPoint.coverage 的汇总。若某类型无 PRD 依据或不适用，数量填 0，并在 skippedCategories 说明。
16. targetCaseCount 必须等于 categoryTargets 五类之和。数量建议：
   - minimal 模块通常 4-12 条。
   - simple 模块通常 8-20 条。
   - medium 模块通常 16-36 条。
   - complex/large 核心模块通常 32-64 条。
   这不是硬性最低要求；要服从当前生成模式。
17. 功能类通常最多，但边界/异常/权限/性能只在适用时生成。不要把“全面”等同于“每模块五类都要有”。
18. 不要生成测试用例。
19. 只输出 JSON：
{
  "generationProfile": "${generationProfile}",
  "documentComplexity": "simple",
  "coverageRationale": "为什么这样估算覆盖范围和数量",
  "uncertainties": [
    {
      "id": "UNC-01",
      "type": "需要产品确认的问题",
      "title": "锁定次数阈值未说明",
      "detail": "PRD 只说明密码错误会锁定，但没有说明连续错误次数。",
      "impact": "影响边界用例和预期提示。",
      "question": "连续几次密码错误后锁定账号？",
      "relatedRequirementId": "REQ-5.1"
    }
  ],
  "modules": [
    {
      "name": "子模块名称",
      "parent": "一级模块名称",
      "description": "模块职责",
      "complexity": "simple",
      "riskLevel": "medium",
      "isCore": true,
      "testData": [
        {
          "id": "TD-01",
          "name": "正常已注册用户",
          "scope": "账号登录",
          "values": ["手机号已注册", "账号状态正常", "密码正确"],
          "setup": "预置正常会员账号和可登录密码",
          "cleanup": "测试后清理登录态和失败计数"
        }
      ],
      "environment": [
        {
          "id": "ENV-01",
          "name": "登录服务与账号状态",
          "type": "依赖服务",
          "description": "账号服务、验证码服务和登录态存储可用",
          "dependencies": ["账号服务", "登录态存储"],
          "setup": "确认登录相关服务可访问",
          "cleanup": "恢复账号状态和配置开关"
        }
      ],
      "uncertainties": [],
      "designTechniques": ["等价类", "边界值", "状态迁移", "权限矩阵"],
      "testPoints": [
        {
          "id": "TP-01",
          "name": "手机号密码登录",
          "evidence": "PRD 第 5.1 节：已注册用户输入正确手机号和密码后可登录成功",
          "requirementId": "REQ-5.1",
          "requirementSection": "5.1 登录",
          "sourceQuote": "已注册用户输入正确手机号和密码后可登录成功",
          "fields": ["手机号", "密码"],
          "states": ["账号正常", "账号锁定"],
          "roles": ["普通用户"],
          "flows": ["登录提交", "登录结果跳转"],
          "rules": ["手机号必填且格式合法", "密码必填"],
          "designTechniques": ["等价类", "边界值", "状态迁移", "权限矩阵"],
          "riskLevel": "high",
          "riskFactors": ["核心链路", "登录态", "账号状态", "重复提交"],
          "coverage": {
            "功能": 4,
            "边界": 2,
            "异常": 1,
            "权限": 1,
            "性能": 0
          },
          "expectedCaseCount": 8
        }
      ],
      "riskPoints": ["边界/异常/权限/性能风险点"],
      "categoryTargets": {
        "功能": 4,
        "边界": 2,
        "异常": 1,
        "权限": 1,
        "性能": 0
      },
      "skippedCategories": ["性能：PRD 未提出高频、大数据量、并发或响应时间要求"],
      "coverageNotes": ["功能类覆盖正向和主要失败路径"],
      "targetCaseCount": 8
    }
  ]
}

PRD 文本：
${truncatedText}`,
      },
    ],
  });

  const documentComplexity = normalizeComplexity(payload.documentComplexity, "medium");
  const modules = normalizeModulePlan(payload, { generationProfile });
  const blueprint = buildCoverageBlueprint(
    documentComplexity,
    payload.coverageRationale?.trim() || `按 ${profileConfig.label} 模式、PRD 可测试点、风险等级和适用测试类型估算覆盖范围。`,
    modules,
    generationProfile,
    normalizeUncertainties(payload.uncertainties),
  );
  onEvent({
    type: "stage",
    message: "覆盖蓝图生成完成",
    detail: `收到 ${rawLength.toLocaleString("zh-CN")} 字符，识别 ${modules.length} 个模块，计划约 ${blueprint.plannedCaseCount.toLocaleString("zh-CN")} 条`,
  });
  return { blueprint, durationMs: Date.now() - startedAt, usage };
}

async function generateCasesForModule({
  apiKey,
  baseURL,
  generationProfile,
  index,
  model,
  module,
  moduleCount,
  onEvent,
  provider,
  reasoningEffort,
  signal,
  text,
  thinkingMode,
}: {
  apiKey: string;
  baseURL?: string;
  generationProfile: TestGenerationProfile;
  index: number;
  model: string;
  module: ModulePlan;
  moduleCount: number;
  onEvent: (event: StreamEvent) => void;
  provider: LlmProvider;
  reasoningEffort: ReasoningEffort;
  signal?: AbortSignal;
  text: string;
  thinkingMode: ThinkingMode;
}) {
  const startedAt = Date.now();
  const moduleName = formatModuleName(module);
  const profileConfig = generationProfileConfigs[generationProfile];
  const targets = getCaseTargets(module);
  const target = targets.total;
  const context = getRelevantPrdText(text, module);
  const tolerance = target <= 12 ? 2 : 3;

  onEvent({
    type: "stage",
    message: `阶段 2：生成模块用例 ${index + 1}/${moduleCount}`,
    detail: `${moduleName}，${complexityLabels[module.complexity ?? "medium"]} / ${module.riskLevel ?? "medium"}，目标 ${target} 条（${formatTargets(targets)}）`,
  });

  const { payload, rawLength, finishReason, usage } = await streamJsonRequest<CaseBatchResponse>({
    apiKey,
    baseURL,
    model,
    provider,
    maxTokens: getProviderMaxTokens(provider, Math.max(3_500, target * 420), 14_000),
    stageLabel: moduleName,
    onEvent,
    reasoningEffort,
    thinkingMode,
    signal,
    messages: [
      {
        role: "system",
        content:
          "你是资深测试架构师。你正在为任意行业 PRD 按模块生成测试用例。必须严格依据当前模块和 PRD 文本，不引入无依据的行业假设。只输出严格 JSON object，不要 Markdown，不要总结说明。",
      },
      {
        role: "user",
        content: `当前模块：${moduleName}
模块说明：${module.description ?? "无"}
模块复杂度：${module.complexity ?? "medium"}
风险等级：${module.riskLevel ?? "medium"}
建议测试设计方法：${module.designTechniques?.join("、") || "按测试点指定方法"}
显式测试点：
${module.testPoints.map(formatTestPointForPrompt).join("\n") || "无"}
风险点：
${(module.riskPoints ?? []).map((point, pointIndex) => `${pointIndex + 1}. ${point}`).join("\n") || "无"}
测试数据清单：
${formatTestDataForPrompt(module.testData)}
环境依赖清单：
${formatEnvironmentForPrompt(module.environment)}
不确定性与待确认问题：
${formatUncertaintiesForPrompt(module.uncertainties)}
覆盖蓝图：
- 生成模式：${profileConfig.label}。${profileConfig.promptGuidance}
- 总数目标：${target} 条，允许上下浮动 ${tolerance} 条。
- 类型目标：${formatTargets(targets)}。
- 功能类逆向/失败路径至少 ${targets.negativeFunctional} 条。
- 不适用类型：${module.skippedCategories?.join("；") || "无"}。
- 覆盖说明：${module.coverageNotes?.join("；") || "按 PRD 测试点和风险点生成。"}

Excel 导入模板字段要求：
- module 对应模板“模块”，必须填写完整模块路径：${moduleName}
- id 对应模板“编号”，先填临时编号即可，系统会最终重排为 TC-001。
- title 对应模板“标题”，必填。
- maintainer 对应模板“维护人”，默认填写 ${defaultMaintainer}。
- caseType 对应模板“用例类型”，只能从这些值中选择：${caseTypeOptions.join("、")}。性能类优先“性能测试”，权限/安全/越权/敏感数据优先“安全相关”，其余通常为“功能测试”。
- priority 对应模板“重要程度”，只能是 P0/P1/P2。
- executionType 对应模板“测试类型”，固定为 ${defaultExecutionType}。
- estimatedHours 和 remainingHours 对应模板“预估工时/剩余工时”，只能填数字或 null；没有明确估算时填 null。
- relatedWorkItems 对应模板“关联工作项”，仅当 PRD 出现需求编号/工作项编号时填写，多个用 | 分隔，否则留空字符串。
- steps 对应模板“步骤描述”，每个步骤必须可执行。
- expectedResults 对应模板“预期结果”，数组顺序必须与 steps 对齐；同时 expectedResult 保留一句总预期。
- followers 对应模板“关注人”，默认填写 ${defaultMaintainer}。
- remarks 对应模板“备注”，用于写测试分类、测试点、PRD 依据或风险说明。

请只为当前模块生成测试用例，禁止生成其他模块。

数量和覆盖规则：
1. 严格按覆盖蓝图生成，不要为了凑数量扩展 PRD 没有依据的功能。
2. categoryTargets 为 0 的类型不要生成；非 0 类型尽量达到对应目标。
3. 功能用例必须覆盖正向主路径和主要逆向/失败路径，不能只有 happy path。
4. 对涉及操作、提交、状态变更、字段校验、权限校验、奖励/资金/隐私/数据影响的测试点，至少覆盖 1 条正向功能和 1 条主要逆向功能。
5. 对纯展示或低风险测试点，生成必要功能用例即可，不要硬拆多条。
6. 边界只覆盖字段、范围、数量、时间、分页、枚举、阈值等有依据的场景。
7. 异常只覆盖接口失败、网络失败、依赖失败、超时、中断、同步失败等有依据的场景。
8. 权限只覆盖登录态、角色、会员等级、越权、数据隔离、敏感数据等有依据的场景。
9. 性能只覆盖高频、大数据量、分页、并发、响应时限等有依据的场景。
10. 每条用例必须显式标注使用的测试设计方法 designTechniques，只能从 ${designTechniques.join("、")} 中选择；边界字段用边界值，状态流转用状态迁移，角色差异用权限矩阵，规则组合用判定表或组合覆盖，重复提交/补偿用幂等或回滚。
11. 不要把多个功能点合并成一个“核心流程”用例。不要只写“成功进入/成功保存”。
12. title 必须具体到功能点、条件或状态，不要泛化。
13. steps 写成可执行动作，expectedResult 写可验证结果。
14. module 字段统一填写：${moduleName}
15. 每条用例必须填写 testPointId、testPoint、evidence、requirementId、requirementSection、sourceQuote，对应上方某个原子测试点。
16. 每条用例必须填写 fieldsCovered、statesCovered、rulesCovered、riskTags，分别来自测试点字段、状态、规则和风险。
17. 每条用例必须引用 testDataRefs 和 environmentRefs；如果无需特殊数据或环境，填空数组。
18. 如果用例基于不确定规则或假设生成，必须填写 uncertaintyRefs、assumptions，并将 requiresConfirmation 设为 true；不能把待确认规则写成确定结论。
19. 每条用例必须满足 Excel 模板字段，尤其是 caseType、priority、executionType、maintainer、followers、steps、expectedResults。

逆向功能用例示例方向：
- 身份/访问类：未登录、无权限、角色不匹配、账号状态异常、授权取消、会话过期、多端冲突。
- 表单/字段类：必填为空、格式错误、长度超限、非法字符、重复数据、枚举值不合法、跨字段规则冲突。
- 流程/状态类：前置状态不满足、重复提交、取消/返回、中途失败、超时、状态回滚、幂等校验、并发操作。
- 配置/规则类：开关关闭、规则不满足、参数越界、依赖配置缺失、保存失败、恢复默认、灰度/区域/版本差异。
- 数据/展示类：无数据、部分数据缺失、接口空响应、接口错误、分页/排序/筛选异常、单位/格式/时区/币种差异。
- 集成/依赖类：网络失败、第三方超时、回调失败、消息重复、数据同步延迟、缓存不一致。
- 安全/合规类：越权访问、敏感数据脱敏、审计记录、注入/脚本输入、下载/导出权限。

只输出 JSON：
{
  "cases": [
    {
      "id": "临时ID",
      "category": "功能",
      "title": "具体测试点",
      "priority": "P0",
      "module": "${moduleName}",
      "status": "",
      "maintainer": "${defaultMaintainer}",
      "caseType": "功能测试",
      "executionType": "${defaultExecutionType}",
      "estimatedHours": null,
      "remainingHours": null,
      "relatedWorkItems": "",
      "requirementId": "REQ-5.1",
      "requirementSection": "5.1 登录",
      "sourceQuote": "PRD 原文短句",
      "testPointId": "TP-01",
      "testPoint": "对应原子测试点名称",
      "evidence": "PRD 依据",
      "fieldsCovered": ["手机号", "密码"],
      "statesCovered": ["账号正常"],
      "rulesCovered": ["手机号必填且格式合法"],
      "riskTags": ["核心链路", "登录态"],
      "designTechniques": ["等价类", "边界值"],
      "testDataRefs": ["TD-01"],
      "environmentRefs": ["ENV-01"],
      "assumptions": [],
      "uncertaintyRefs": [],
      "requiresConfirmation": false,
      "preconditions": "前置条件",
      "steps": ["步骤1", "步骤2"],
      "expectedResults": ["步骤1对应预期", "步骤2对应预期"],
      "expectedResult": "总预期结果",
      "followers": "${defaultMaintainer}",
      "remarks": "测试分类/测试点/PRD依据"
    }
  ]
}

PRD 相关文本：
${context}`,
      },
    ],
  });

  const cases = normalizeCases(payload.cases ?? [], module);
  onEvent({
    type: "stage",
    message: "模块用例生成完成",
    detail: `${moduleName}：收到 ${rawLength.toLocaleString("zh-CN")} 字符，解析 ${cases.length} 条${finishReason === "length" ? "，模型触达 token 上限" : ""}`,
  });
  return {
    cases,
    hitTokenLimit: finishReason === "length",
    durationMs: Date.now() - startedAt,
    usage,
  };
}

async function generateCoverageRepairCasesForModule({
  apiKey,
  baseURL,
  coverageGaps,
  existingCases,
  generationProfile,
  model,
  module,
  onEvent,
  provider,
  reasoningEffort,
  signal,
  text,
  thinkingMode,
}: {
  apiKey: string;
  baseURL?: string;
  coverageGaps: ReturnType<typeof getCoverageGaps>;
  existingCases: TestCase[];
  generationProfile: TestGenerationProfile;
  model: string;
  module: ModulePlan;
  onEvent: (event: StreamEvent) => void;
  provider: LlmProvider;
  reasoningEffort: ReasoningEffort;
  signal?: AbortSignal;
  text: string;
  thinkingMode: ThinkingMode;
}) {
  const startedAt = Date.now();
  const moduleName = formatModuleName(module);
  const profileConfig = generationProfileConfigs[generationProfile];
  const context = getRelevantPrdText(text, module);
  const gapText = categories
    .filter((category) => coverageGaps.categoryGaps[category] > 0)
    .map((category) => `${category} ${coverageGaps.categoryGaps[category]} 条`)
    .join("、");

  onEvent({
    type: "stage",
    message: "质量检查：按覆盖蓝图补缺口",
    detail: `${moduleName} 缺口 ${gapText}${coverageGaps.negativeFunctionalGap ? `，其中逆向功能至少 ${coverageGaps.negativeFunctionalGap} 条` : ""}`,
  });

  const { payload, rawLength, finishReason, usage } = await streamJsonRequest<CaseBatchResponse>({
    apiKey,
    baseURL,
    model,
    provider,
    maxTokens: getProviderMaxTokens(provider, Math.max(2_500, coverageGaps.totalGap * 520), 8_000),
    stageLabel: `${moduleName} 覆盖补充`,
    onEvent,
    reasoningEffort,
    thinkingMode,
    signal,
    messages: [
      {
        role: "system",
        content:
          "你是资深测试架构师。你正在按覆盖蓝图修复某个模块的测试覆盖缺口。只输出严格 JSON object，不要 Markdown，不要总结说明。",
      },
      {
        role: "user",
        content: `当前模块：${moduleName}
模块说明：${module.description ?? "无"}
模块复杂度：${module.complexity ?? "medium"}
风险等级：${module.riskLevel ?? "medium"}
建议测试设计方法：${module.designTechniques?.join("、") || "按测试点指定方法"}
显式测试点：
${module.testPoints.map(formatTestPointForPrompt).join("\n") || "无"}
风险点：
${(module.riskPoints ?? []).map((point, pointIndex) => `${pointIndex + 1}. ${point}`).join("\n") || "无"}
测试数据清单：
${formatTestDataForPrompt(module.testData)}
环境依赖清单：
${formatEnvironmentForPrompt(module.environment)}
不确定性与待确认问题：
${formatUncertaintiesForPrompt(module.uncertainties)}

该模块已生成的用例标题：
${existingCases.map((item, caseIndex) => `${caseIndex + 1}. [${item.category}] ${item.title}`).join("\n")}

请补充 ${coverageGaps.totalGap} 条新用例，缺口分布：
${categories.filter((category) => coverageGaps.categoryGaps[category] > 0).map((category) => `- ${category}：${coverageGaps.categoryGaps[category]} 条`).join("\n")}
原子测试点缺口：
${coverageGaps.pointGaps
  .slice(0, 24)
  .map((item) => {
    const gaps = categories.filter((category) => item.categoryGaps[category] > 0).map((category) => `${category}${item.categoryGaps[category]}`).join("、");
    return `- ${item.point.id}｜${item.point.name}：${gaps}`;
  })
  .join("\n") || "无"}

要求：
1. 只补当前模块，module 字段统一填写：${moduleName}
2. 生成模式：${profileConfig.label}。${profileConfig.promptGuidance}
3. category 必须严格落在上述缺口分布内；不要生成缺口为 0 的类型。
4. ${coverageGaps.negativeFunctionalGap ? `补充的功能用例中至少 ${coverageGaps.negativeFunctionalGap} 条必须是逆向/失败/不可用/状态不满足/前置条件不满足/取消/重复提交/依赖失败/服务错误等场景。` : "功能用例优先补齐未覆盖的显式测试点。"}
5. 不要重复已生成标题，不要写泛化标题。
6. 每条 steps 必须可执行，expectedResult 必须可验证。
7. 严格依据 PRD 文本和覆盖蓝图，不要引入无依据的行业假设，不要为了凑数量扩展不存在的功能。
8. 每条用例必须填写 testPointId、testPoint、evidence、requirementId、requirementSection、sourceQuote，对应上方某个原子测试点。
9. 每条用例必须填写 fieldsCovered、statesCovered、rulesCovered、riskTags 和 designTechniques；designTechniques 只能从 ${designTechniques.join("、")} 中选择。
10. 每条用例必须引用 testDataRefs 和 environmentRefs；如果无需特殊数据或环境，填空数组。
11. 如果用例基于不确定规则或假设生成，必须填写 uncertaintyRefs、assumptions，并将 requiresConfirmation 设为 true。
12. 每条用例必须满足 Excel 模板字段：maintainer 默认 ${defaultMaintainer}，caseType 只能是 ${caseTypeOptions.join("、")}，priority 只能是 P0/P1/P2，executionType 固定为 ${defaultExecutionType}，estimatedHours/remainingHours 只能是数字或 null，steps 与 expectedResults 数组顺序对齐。

只输出 JSON：
{
  "cases": [
    {
      "id": "补充ID",
      "category": "功能",
      "title": "具体补充测试点",
      "priority": "P1",
      "module": "${moduleName}",
      "status": "",
      "maintainer": "${defaultMaintainer}",
      "caseType": "功能测试",
      "executionType": "${defaultExecutionType}",
      "estimatedHours": null,
      "remainingHours": null,
      "relatedWorkItems": "",
      "requirementId": "REQ-5.1",
      "requirementSection": "5.1 登录",
      "sourceQuote": "PRD 原文短句",
      "testPointId": "TP-01",
      "testPoint": "对应原子测试点名称",
      "evidence": "PRD 依据",
      "fieldsCovered": ["字段"],
      "statesCovered": ["状态"],
      "rulesCovered": ["规则"],
      "riskTags": ["风险"],
      "designTechniques": ["等价类"],
      "testDataRefs": ["TD-01"],
      "environmentRefs": ["ENV-01"],
      "assumptions": [],
      "uncertaintyRefs": [],
      "requiresConfirmation": false,
      "preconditions": "前置条件",
      "steps": ["步骤1", "步骤2"],
      "expectedResults": ["步骤1对应预期", "步骤2对应预期"],
      "expectedResult": "总预期结果",
      "followers": "${defaultMaintainer}",
      "remarks": "测试分类/测试点/PRD依据"
    }
  ]
}

PRD 相关文本：
${context}`,
      },
    ],
  });

  const allowedCategories = new Set(categories.filter((category) => coverageGaps.categoryGaps[category] > 0));
  const cases = normalizeCases(payload.cases ?? [], module).filter((item) => allowedCategories.has(item.category));
  onEvent({
    type: "stage",
    message: "覆盖缺口补充完成",
    detail: `${moduleName}：收到 ${rawLength.toLocaleString("zh-CN")} 字符，补充 ${cases.length} 条${finishReason === "length" ? "，模型触达 token 上限" : ""}`,
  });

  return {
    cases,
    hitTokenLimit: finishReason === "length",
    durationMs: Date.now() - startedAt,
    usage,
  };
}

function mergeCaseQualityFindings(cases: TestCase[], findings: QualityFinding[]) {
  return cases.map((item) => {
    const matchedFindings = findings.filter((finding) => {
      if (finding.caseId && finding.caseId === item.id) return true;
      if (finding.title && (finding.title === item.title || item.title.includes(finding.title))) return true;
      return false;
    });
    if (!matchedFindings.length) return item;
    return {
      ...item,
      qualityFindings: [...(item.qualityFindings ?? []), ...matchedFindings].slice(0, 8),
    };
  });
}

function summarizeQualityReports(reports: GenerationQualityReport[]): GenerationQualityReport | undefined {
  if (!reports.length) return undefined;
  const findings = reports.flatMap((item) => item.findings).slice(0, 80);
  const averageScore = Math.round(reports.reduce((sum, item) => sum + item.score, 0) / reports.length);
  const revisedCaseCount = reports.reduce((sum, item) => sum + item.revisedCaseCount, 0);
  return {
    score: averageScore,
    summary: `已完成 ${reports.length} 个模块的独立质量审查，修订 ${revisedCaseCount} 条用例，发现 ${findings.length} 个需关注问题。`,
    revisedCaseCount,
    findingCount: findings.length,
    findings,
  };
}

async function reviewAndReviseCasesForModule({
  apiKey,
  baseURL,
  existingCases,
  model,
  module,
  onEvent,
  provider,
  reasoningEffort,
  signal,
  text,
  thinkingMode,
}: {
  apiKey: string;
  baseURL?: string;
  existingCases: TestCase[];
  model: string;
  module: ModulePlan;
  onEvent: (event: StreamEvent) => void;
  provider: LlmProvider;
  reasoningEffort: ReasoningEffort;
  signal?: AbortSignal;
  text: string;
  thinkingMode: ThinkingMode;
}) {
  const startedAt = Date.now();
  const moduleName = formatModuleName(module);
  const context = getRelevantPrdText(text, module);
  const compactCases = existingCases.map((item) => ({
    id: item.id,
    category: item.category,
    title: item.title,
    priority: item.priority,
    testPointId: item.testPointId,
    testPoint: item.testPoint,
    evidence: item.evidence,
    requirementId: item.requirementId,
    requirementSection: item.requirementSection,
    sourceQuote: item.sourceQuote,
    fieldsCovered: item.fieldsCovered,
    statesCovered: item.statesCovered,
    rulesCovered: item.rulesCovered,
    riskTags: item.riskTags,
    designTechniques: item.designTechniques,
    testDataRefs: item.testDataRefs,
    environmentRefs: item.environmentRefs,
    assumptions: item.assumptions,
    uncertaintyRefs: item.uncertaintyRefs,
    requiresConfirmation: item.requiresConfirmation,
    preconditions: item.preconditions,
    steps: item.steps,
    expectedResults: item.expectedResults,
    expectedResult: item.expectedResult,
    remarks: item.remarks,
  }));

  onEvent({
    type: "stage",
    message: "质量检查：审查并修订用例",
    detail: `${moduleName}：独立检查重复、泛化、可执行性、证据链和步骤预期对齐`,
  });

  const { payload, rawLength, finishReason, usage } = await streamJsonRequest<QualityReviewResponse>({
    apiKey,
    baseURL,
    model,
    provider,
    maxTokens: getProviderMaxTokens(provider, Math.max(3_500, existingCases.length * 650), 14_000),
    stageLabel: `${moduleName} 质量审查`,
    onEvent,
    reasoningEffort,
    thinkingMode,
    signal,
    messages: [
      {
        role: "system",
        content:
          "你是资深测试负责人和测试用例评审专家。你要审查并修订已生成的测试用例，保持数量基本稳定，但必须消除泛化、重复、不可执行、不可验证和缺少 PRD 依据的问题。只输出严格 JSON object，不要 Markdown。",
      },
      {
        role: "user",
        content: `当前模块：${moduleName}
模块说明：${module.description ?? "无"}
风险等级：${module.riskLevel ?? "medium"}
覆盖蓝图测试点：
${module.testPoints.map(formatTestPointForPrompt).join("\n") || "无"}

需要审查的用例 JSON：
${JSON.stringify(compactCases, null, 2)}

审查规则：
1. 删除或合并明显重复、标题不同但目的相同的用例；必要时把更高价值内容合并到保留用例。
   - 语义重复包括：测试目的相同、步骤主体相同、同一测试点下只是标题换词、预期一致但输入条件没有实质差异。
2. 重写泛化标题，例如“核心流程”“成功保存”“异常处理”等，必须具体到条件、状态、字段或规则。
3. steps 必须是测试人员可执行动作，不能只写“验证”“检查”“测试功能”。
4. expectedResults 必须与 steps 数量和顺序对齐；expectedResult 必须是一句总预期。
5. 每条用例必须有 PRD 依据：testPointId、testPoint、evidence、requirementSection、sourceQuote 至少要能对应上方测试点。
6. 每条用例必须保留或补齐 requirementId、requirementSection、sourceQuote、fieldsCovered、statesCovered、rulesCovered、riskTags、designTechniques、testDataRefs、environmentRefs。
7. designTechniques 只能从 ${designTechniques.join("、")} 中选择，并要与场景匹配。
8. 权限、异常、边界、性能类不能写成普通功能 happy path。
9. 不要引入 PRD 和蓝图没有依据的新功能；发现无法确定的规则，写入 findings，并在相关用例中标记 requiresConfirmation、uncertaintyRefs、assumptions。
10. 返回 cases 必须是修订后的完整用例对象数组，不要只返回差异。

只输出 JSON：
{
  "score": 88,
  "summary": "质量审查摘要",
  "revisedCaseCount": 3,
  "findingCount": 2,
  "findings": [
    {
      "severity": "medium",
      "issueType": "预期不可验证",
      "caseId": "临时ID",
      "title": "用例标题",
      "detail": "问题说明",
      "suggestion": "修订建议"
    }
  ],
  "cases": [
    {
      "id": "原临时ID",
      "category": "功能",
      "title": "修订后的具体标题",
      "priority": "P0",
      "module": "${moduleName}",
      "status": "",
      "maintainer": "${defaultMaintainer}",
      "caseType": "功能测试",
      "executionType": "${defaultExecutionType}",
      "estimatedHours": null,
      "remainingHours": null,
      "relatedWorkItems": "",
      "requirementId": "REQ-5.1",
      "requirementSection": "5.1 登录",
      "sourceQuote": "PRD 原文短句",
      "testPointId": "TP-01",
      "testPoint": "对应原子测试点名称",
      "evidence": "PRD 依据",
      "fieldsCovered": ["字段"],
      "statesCovered": ["状态"],
      "rulesCovered": ["规则"],
      "riskTags": ["风险"],
      "designTechniques": ["等价类"],
      "testDataRefs": ["TD-01"],
      "environmentRefs": ["ENV-01"],
      "assumptions": [],
      "uncertaintyRefs": [],
      "requiresConfirmation": false,
      "preconditions": "前置条件",
      "steps": ["步骤1", "步骤2"],
      "expectedResults": ["步骤1对应预期", "步骤2对应预期"],
      "expectedResult": "总预期结果",
      "followers": "${defaultMaintainer}",
      "remarks": "质量审查后保留"
    }
  ]
}

PRD 相关文本：
${context}`,
      },
    ],
  });

  const findings = normalizeQualityFindings(payload.findings, 32);
  const cases = mergeCaseQualityFindings(normalizeCases(payload.cases ?? existingCases, module), findings);
  const revisedCaseCount = Math.max(0, Math.round(payload.revisedCaseCount ?? 0));
  const qualityReport: GenerationQualityReport = {
    score: clamp(Math.round(payload.score ?? 80), 0, 100),
    summary: payload.summary?.trim() || `${moduleName} 已完成质量审查。`,
    revisedCaseCount,
    findingCount: Math.max(findings.length, Math.round(payload.findingCount ?? findings.length)),
    findings,
  };

  onEvent({
    type: "stage",
    message: "质量审查完成",
    detail: `${moduleName}：评分 ${qualityReport.score}，修订 ${qualityReport.revisedCaseCount} 条，问题 ${qualityReport.findingCount} 个，收到 ${rawLength.toLocaleString("zh-CN")} 字符${finishReason === "length" ? "，模型触达 token 上限" : ""}`,
  });

  return {
    cases,
    qualityReport,
    hitTokenLimit: finishReason === "length",
    durationMs: Date.now() - startedAt,
    usage,
  };
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  const generationStartedAt = Date.now();
  const generationStartedIso = new Date(generationStartedAt).toISOString();
  let provider: LlmProvider = "deepseek";
  let model = providerDefaults.deepseek.model;
  let baseURL: string | undefined;
  let mode: GenerationMode = "cases";
  let generationProfile: TestGenerationProfile = "standard";
  let thinkingMode: ThinkingMode = "fast";
  let reasoningEffort: ReasoningEffort = "medium";
  let fileName = "未命名 PRD";
  let sourceTextLength: number | undefined;
  let sourceTextHash: string | undefined;
  let totalUsage: GenerationUsage | undefined;
  let plannedCaseCount: number | undefined;
  let coverageBlueprint: CoverageBlueprint | undefined;
  let currentStage = "初始化";
  let lastProgressEvent: StreamEvent | undefined;
  let resultSource: "ai" | "fallback" = "ai";
  let checkpointRecordId: string | undefined;
  let latestCheckpoint: GenerateResponse["checkpoint"];
  const moduleStats: GenerationModuleStats[] = [];
  const moduleCaseMap = new Map<string, TestCase[]>();
  const qualityReports: GenerationQualityReport[] = [];
  const warnings: string[] = [];

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const onEvent = (event: StreamEvent) => {
          if (event.type === "stage" && event.message !== "AI 正在持续生成") currentStage = event.message;
          if (event.type !== "error" && event.type !== "done") lastProgressEvent = event;
          send(controller, encoder, event);
        };

        const buildResultWithStats = (status: RunStatus, result: GenerateResponse) => {
          const generationCompletedAt = Date.now();
          const completedIso = new Date(generationCompletedAt).toISOString();
          const moduleNames = new Set(
            result.cases.length
              ? result.cases.map((item) => item.module)
              : (result.coverageBlueprint?.modules ?? []).map(formatModuleName),
          );
          const estimatedCostCny =
            provider === "aliyun"
              ? estimateAliyunCostCny(model, thinkingMode, totalUsage)
              : provider === "deepseek"
                ? estimateDeepSeekCostCny(model, totalUsage)
                : null;

          return {
            ...result,
            warnings:
              status === "success"
                ? result.warnings
                : [
                    ...result.warnings,
                    status === "running"
                      ? "本次运行正在进行，已保存阶段性结果。"
                      : status === "cancelled"
                        ? "本次运行已由用户停止。"
                        : "本次运行失败，已保存可排查的运行日志。",
                  ],
            stats: {
              startedAt: generationStartedIso,
              completedAt: completedIso,
              durationMs: generationCompletedAt - generationStartedAt,
              provider,
              model,
              ...(provider === "aliyun" ? { thinkingMode } : {}),
              ...(provider === "openai" || provider === "velotric" ? { reasoningEffort } : {}),
              ...(totalUsage ? { usage: totalUsage } : {}),
              estimatedCostCny,
              sourceTextLength,
              plannedCaseCount,
              moduleCount: moduleNames.size,
              caseCount: result.cases.length,
              modules: moduleStats.length
                ? moduleStats
                : [...moduleNames].map((name) => ({
                    name,
                    caseCount: result.cases.filter((item) => item.module === name).length,
                    durationMs: 0,
                  })),
            },
          } satisfies GenerateResponse;
        };

        const buildPartialResult = (
          status: Exclude<RunStatus, "success">,
          message: string,
          checkpoint?: GenerateResponse["checkpoint"],
        ) => {
          const partialCases = dedupeAndRenumber([...moduleCaseMap.values()].flat());
          return buildResultWithStats(status, {
            source: resultSource,
            fileName,
            summary:
              status === "running"
                ? `本次生成正在进行，已保存 ${partialCases.length} 条阶段性测试用例。`
                : status === "cancelled"
                  ? `本次生成已停止，停止前已解析 ${partialCases.length} 条测试用例。`
                  : `本次生成失败，失败前已解析 ${partialCases.length} 条测试用例。`,
            cases: partialCases,
            warnings: [...warnings, message],
            ...(coverageBlueprint ? { coverageBlueprint } : {}),
            ...(checkpoint ? { checkpoint } : {}),
          });
        };

        const upsertModuleStat = (stat: GenerationModuleStats) => {
          const existingIndex = moduleStats.findIndex((item) => item.name === stat.name);
          if (existingIndex >= 0) moduleStats[existingIndex] = stat;
          else moduleStats.push(stat);
        };

        const buildCheckpoint = ({
          currentModuleName,
          detail,
          moduleStage,
          nextModuleIndex,
        }: {
          currentModuleName?: string;
          detail: string;
          moduleStage: GenerationCheckpointStage;
          nextModuleIndex: number;
        }): GenerateResponse["checkpoint"] => ({
          updatedAt: new Date().toISOString(),
          detail,
          nextModuleIndex,
          moduleStage,
          ...(currentModuleName ? { currentModuleName } : {}),
          ...(sourceTextHash ? { sourceTextHash } : {}),
          completedModuleNames: (coverageBlueprint?.modules ?? []).slice(0, nextModuleIndex).map(formatModuleName),
        });

        const saveCheckpoint = (
          detail: string,
          checkpointOptions: {
            currentModuleName?: string;
            moduleStage: GenerationCheckpointStage;
            nextModuleIndex: number;
          },
        ) => {
          if (mode === "strategy") return;
          const checkpoint = buildCheckpoint({ ...checkpointOptions, detail });
          latestCheckpoint = checkpoint;
          const checkpointResult = buildPartialResult("running", detail, checkpoint);
          const savedRecord = saveRunHistoryRecord({
            id: checkpointRecordId,
            status: "running",
            createdAt: generationStartedIso,
            completedAt: checkpointResult.stats?.completedAt,
            provider,
            model,
            ...(provider === "aliyun" ? { thinkingMode } : {}),
            failedStage: currentStage,
            errorMessage: "运行中检查点",
            errorDetail: detail,
            lastEvent: lastProgressEvent,
            result: checkpointResult,
          });
          checkpointRecordId = savedRecord.id;
        };

        try {
          onEvent({ type: "stage", message: "已收到生成请求" });

          const formData = await request.formData();
          assertNotAborted(request.signal);
          const file = formData.get("file");
          const apiKeyValue = formData.get("apiKey");
          const modelValue = formData.get("model");
          const baseURLValue = formData.get("baseURL");
          const thinkingModeValue = formData.get("thinkingMode");
          const reasoningEffortValue = formData.get("reasoningEffort");
          const strategyValue = formData.get("coverageBlueprint");
          const resumeHistoryValue = formData.get("resumeHistoryId");
          generationProfile = normalizeGenerationProfile(formData.get("generationProfile"));
          mode = getGenerationMode(formData.get("mode"));
          provider = getProvider(formData.get("provider"));
          const config = providerDefaults[provider];
          const requestApiKey = typeof apiKeyValue === "string" ? apiKeyValue.trim() : "";
          const apiKey = requestApiKey || config.envKey;
          model = typeof modelValue === "string" && modelValue.trim() ? modelValue.trim() : config.model;
          baseURL = provider === "velotric" && typeof baseURLValue === "string" && baseURLValue.trim() ? baseURLValue.trim() : config.baseURL;
          thinkingMode = normalizeThinkingMode(typeof thinkingModeValue === "string" ? thinkingModeValue : "fast");
          reasoningEffort = normalizeReasoningEffort(typeof reasoningEffortValue === "string" ? reasoningEffortValue : "medium");

          onEvent({
            type: "stage",
            message: "已读取模型配置",
            detail: `${providerLabels[provider]} / ${model} / ${
              provider === "aliyun" ? (thinkingMode === "quality" ? "高质量模式" : "快速模式") : `推理 ${reasoningEffort}`
            } / ${getProfileLabel(generationProfile)} / ${apiKey ? "已提供 API Key" : "未提供 API Key"} / ${mode === "strategy" ? "生成测试策略" : "生成测试用例"}${provider === "velotric" && baseURL ? ` / 网关 ${baseURL}` : ""}`,
          });

          if (!(file instanceof File)) {
            throw new Error("请上传 PDF 格式的 PRD 文档。");
          }

          fileName = file.name;

          if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
            throw new Error("仅支持 PDF 文件。");
          }

          if (file.size > 15 * 1024 * 1024) {
            throw new Error("PDF 文件不能超过 15MB。");
          }

          onEvent({
            type: "stage",
            message: "正在解析 PDF 文本",
            detail: `${file.name} / ${(file.size / 1024 / 1024).toFixed(2)} MB`,
          });

          const text = await extractPdfText(file);
          assertNotAborted(request.signal);
          sourceTextLength = text.length;
          sourceTextHash = hashSourceText(text);
          if (!text || text.length < 30) {
            throw new Error("未能从 PDF 中提取到足够文本，请确认文档可复制或包含文本层。");
          }

          onEvent({
            type: "stage",
            message: "PDF 解析完成",
            detail: `提取 ${text.length.toLocaleString("zh-CN")} 个字符`,
          });

          const resumeHistoryId = typeof resumeHistoryValue === "string" ? resumeHistoryValue.trim() : "";
          let resumeState: ResumeState | undefined;
          let result: GenerateResponse;
          if (!apiKey && resumeHistoryId) {
            throw new Error("续跑需要可用的模型 API Key；当前未检测到 Key，无法调用模型继续生成。");
          }

          if (apiKey) {
            if (mode === "cases" && resumeHistoryId) {
              resumeState = loadResumeState(resumeHistoryId, file.name, sourceTextHash);
              checkpointRecordId = resumeState.historyId;
              coverageBlueprint = resumeState.result.coverageBlueprint;
              generationProfile = coverageBlueprint.generationProfile ?? generationProfile;
              resultSource = resumeState.result.source === "fallback" ? "fallback" : "ai";
              latestCheckpoint = resumeState.result.checkpoint;
              for (const [moduleName, cases] of groupCasesByModule(resumeState.result.cases)) moduleCaseMap.set(moduleName, cases);
              moduleStats.splice(0, moduleStats.length, ...(resumeState.result.stats?.modules ?? []));
              totalUsage = addUsage(totalUsage, resumeState.result.stats?.usage);
              warnings.push(`已从历史记录 ${resumeState.historyId} 继续生成，保留 ${resumeState.result.cases.length} 条阶段性用例。`);
              onEvent({
                type: "stage",
                message: "从历史检查点继续生成",
                detail:
                  resumeState.moduleStage === "finalize"
                    ? `已恢复 ${resumeState.result.cases.length} 条阶段性用例，将进入最终合并统计。`
                    : `已恢复 ${resumeState.result.cases.length} 条阶段性用例，从第 ${resumeState.nextModuleIndex + 1} 个模块继续。`,
              });
            } else if (mode === "cases") {
              coverageBlueprint = parseCoverageBlueprintInput(strategyValue, generationProfile);
              if (coverageBlueprint) {
                generationProfile = coverageBlueprint.generationProfile ?? generationProfile;
                onEvent({
                  type: "stage",
                  message: "使用已确认测试策略",
                  detail: `收到 ${coverageBlueprint.modules.length} 个模块，${getProfileLabel(generationProfile)}模式，计划约 ${coverageBlueprint.plannedCaseCount.toLocaleString("zh-CN")} 条`,
                });
              }
            }

            if (!coverageBlueprint) {
              const planResult = await generateModulePlan({
                apiKey,
                baseURL,
                fileName: file.name,
                generationProfile,
                model,
                onEvent,
                provider,
                reasoningEffort,
                signal: request.signal,
                text,
                thinkingMode,
              });
              totalUsage = addUsage(totalUsage, planResult.usage);
              coverageBlueprint = planResult.blueprint;
            }

            plannedCaseCount = coverageBlueprint.plannedCaseCount;
            const modules = coverageBlueprint.modules;

            if (!modules.length) throw new Error("模型未能识别出可测试功能模块。");
            if (!resumeState) {
              saveCheckpoint(`覆盖蓝图已保存：识别 ${modules.length} 个模块，计划约 ${coverageBlueprint.plannedCaseCount} 条。`, {
                moduleStage: "module-start",
                nextModuleIndex: 0,
              });
            }

            if (mode === "strategy") {
              result = {
                source: "ai",
                fileName: file.name,
                summary: `已生成“${getProfileLabel(generationProfile)}”可编辑测试策略：识别 ${modules.length} 个模块，计划约 ${coverageBlueprint.plannedCaseCount} 条用例。请确认模块、测试点、风险等级、设计方法、测试数据、环境依赖和不确定项后继续生成。`,
                cases: [],
                warnings: ["当前仅生成测试策略，确认后再开始生成测试用例。"],
                coverageBlueprint,
              };
            } else {
              const resumeStage = resumeState?.moduleStage ?? "module-start";
              const resumeStartIndex = resumeState ? clamp(resumeStage === "finalize" ? modules.length : resumeState.nextModuleIndex, 0, modules.length) : 0;
              for (let index = resumeStartIndex; index < modules.length; index += 1) {
                assertNotAborted(request.signal);
                const currentModule = modules[index];
                const moduleName = formatModuleName(currentModule);
                const stageForModule = index === resumeStartIndex ? resumeStage : "module-start";
                let moduleCases = moduleCaseMap.get(moduleName) ?? [];
                let moduleUsage: GenerationUsage | undefined;
                let moduleDurationMs = 0;

                if (stageForModule === "module-start" || !moduleCases.length) {
                  const batch = await generateCasesForModule({
                    apiKey,
                    baseURL,
                    generationProfile,
                    index,
                    model,
                    module: currentModule,
                    moduleCount: modules.length,
                    onEvent,
                    provider,
                    reasoningEffort,
                    signal: request.signal,
                    text,
                    thinkingMode,
                  });
                  moduleCases = batch.cases;
                  moduleUsage = batch.usage;
                  moduleDurationMs = batch.durationMs;
                  totalUsage = addUsage(totalUsage, batch.usage);
                  moduleCaseMap.set(moduleName, moduleCases);
                  if (batch.hitTokenLimit) warnings.push(`${formatModuleName(currentModule)} 输出达到 token 上限，已尽力解析。`);
                  saveCheckpoint(`${moduleName} 初始生成完成，已保存 ${moduleCases.length} 条阶段性用例。`, {
                    currentModuleName: moduleName,
                    moduleStage: "coverage-repair",
                    nextModuleIndex: index,
                  });
                }

                if (stageForModule !== "quality-review") {
                  const coverageGaps = getCoverageGaps(moduleCases, getCaseTargets(currentModule));
                  if (coverageGaps.totalGap > 0) {
                    assertNotAborted(request.signal);
                    const repair = await generateCoverageRepairCasesForModule({
                      apiKey,
                      baseURL,
                      coverageGaps,
                      existingCases: moduleCases,
                      generationProfile,
                      model,
                      module: currentModule,
                      onEvent,
                      provider,
                      reasoningEffort,
                      signal: request.signal,
                      text,
                      thinkingMode,
                    });
                    moduleCases = [...moduleCases, ...repair.cases];
                    moduleCaseMap.set(moduleName, moduleCases);
                    moduleUsage = addUsage(moduleUsage, repair.usage);
                    moduleDurationMs += repair.durationMs;
                    totalUsage = addUsage(totalUsage, repair.usage);
                    if (repair.hitTokenLimit) warnings.push(`${formatModuleName(currentModule)} 覆盖补充达到 token 上限，已尽力解析。`);
                  }
                  saveCheckpoint(`${moduleName} 覆盖缺口补充完成，已保存 ${moduleCases.length} 条阶段性用例。`, {
                    currentModuleName: moduleName,
                    moduleStage: "quality-review",
                    nextModuleIndex: index,
                  });
                }

                try {
                  assertNotAborted(request.signal);
                  const qualityReview = await reviewAndReviseCasesForModule({
                    apiKey,
                    baseURL,
                    existingCases: moduleCases,
                    model,
                    module: currentModule,
                    onEvent,
                    provider,
                    reasoningEffort,
                    signal: request.signal,
                    text,
                    thinkingMode,
                  });
                  moduleCases = qualityReview.cases;
                  moduleCaseMap.set(moduleName, moduleCases);
                  moduleUsage = addUsage(moduleUsage, qualityReview.usage);
                  moduleDurationMs += qualityReview.durationMs;
                  totalUsage = addUsage(totalUsage, qualityReview.usage);
                  qualityReports.push(qualityReview.qualityReport);
                  if (qualityReview.hitTokenLimit) warnings.push(`${formatModuleName(currentModule)} 质量审查达到 token 上限，已尽力解析。`);
                } catch (qualityError) {
                  if (isCancelledError(qualityError)) throw qualityError;
                  warnings.push(`${formatModuleName(currentModule)} 质量审查未完成：${getErrorMessage(qualityError)}`);
                }

                upsertModuleStat({
                  name: moduleName,
                  caseCount: moduleCases.length,
                  durationMs: moduleDurationMs,
                  ...(moduleUsage ? { usage: moduleUsage } : {}),
                });
                saveCheckpoint(`${moduleName} 已完成，已保存 ${moduleCases.length} 条阶段性用例。`, {
                  moduleStage: index + 1 >= modules.length ? "finalize" : "module-start",
                  nextModuleIndex: index + 1,
                });
              }

              const dedupeResult = semanticDedupeAndRenumber([...moduleCaseMap.values()].flat());
              const cases = dedupeResult.cases;
              const reviewReport = summarizeQualityReports(qualityReports);
              const evaluation = buildGenerationEvaluation({
                blueprint: coverageBlueprint,
                cases,
                semanticDuplicateCount: dedupeResult.semanticDuplicateCount,
              });
              const uncertaintyCount =
                (coverageBlueprint.uncertainties?.length ?? 0) +
                coverageBlueprint.modules.reduce((sum, module) => sum + (module.uncertainties?.length ?? 0), 0);
              const qualityReport = mergeQualityReport({
                evaluation,
                reviewReport,
                semanticDuplicateCount: dedupeResult.semanticDuplicateCount,
                semanticFindings: dedupeResult.findings,
                uncertaintyCount,
              });
              result = {
                source: "ai",
                fileName: file.name,
                summary: buildSummary(file.name, modules, cases, generationProfile),
                cases,
                warnings,
                coverageBlueprint,
                ...(qualityReport ? { qualityReport } : {}),
              };
            }
          } else {
            resultSource = "fallback";
            onEvent({
              type: "stage",
              message: "未检测到 API Key，改用本地规则生成",
              detail: "本次不会调用外部 AI 服务",
            });
            result = generateFallbackCases(text, file.name);
          }

          result = buildResultWithStats("success", result);

          if (mode !== "strategy") {
            try {
              const savedRecord = saveRunHistoryRecord({
                id: checkpointRecordId,
                status: "success",
                createdAt: generationStartedIso,
                completedAt: result.stats?.completedAt,
                provider,
                model,
                ...(provider === "aliyun" ? { thinkingMode } : {}),
                result,
              });
              result = {
                ...result,
                historyId: savedRecord.id,
              };
              onEvent({
                type: "stage",
                message: "运行记录已保存",
                detail: `SQLite 持久化记录：${savedRecord.id}`,
              });
            } catch (saveError) {
              result = {
                ...result,
                warnings: [...result.warnings, `运行记录保存失败：${getErrorMessage(saveError)}`],
              };
            }
          }

          onEvent({
            type: "stage",
            message: mode === "strategy" ? "测试策略已生成" : "阶段 3：合并并统计结果",
            detail:
              mode === "strategy"
                ? `识别 ${result.coverageBlueprint?.modules.length ?? 0} 个模块，等待确认后生成用例`
                : `识别 ${new Set(result.cases.map((item) => item.module)).size} 个模块，生成 ${result.cases.length} 条用例`,
          });
          onEvent({ type: "result", data: result });
          onEvent({ type: "done" });
        } catch (error) {
          console.error(error);
          totalUsage = addUsage(totalUsage, getErrorUsage(error));
          const cancelled = isCancelledError(error) || request.signal.aborted;
          const errorMessage = cancelled ? "已停止本次生成。" : "生成失败，请检查 API Key、额度、模型名称、模型权限或网络连接。";
          const errorDetail = cancelled ? "用户主动停止运行，已保存停止前的运行日志。" : getErrorMessage(error);
          const partialResult = buildPartialResult(cancelled ? "cancelled" : "failed", errorDetail, latestCheckpoint);

          try {
            const savedRecord = saveRunHistoryRecord({
              id: checkpointRecordId,
              status: cancelled ? "cancelled" : "failed",
              createdAt: generationStartedIso,
              completedAt: partialResult.stats?.completedAt,
              provider,
              model,
              ...(provider === "aliyun" ? { thinkingMode } : {}),
              failedStage: currentStage,
              errorMessage,
              errorDetail,
              errorRaw: serializeError(error),
              lastEvent: lastProgressEvent,
              result: partialResult,
            });

            if (!request.signal.aborted) {
              onEvent({
                type: "stage",
                message: cancelled ? "运行已停止并保存记录" : "失败运行记录已保存",
                detail: `SQLite 持久化记录：${savedRecord.id}`,
              });
            }
          } catch (saveError) {
            if (!request.signal.aborted) {
              onEvent({
                type: "stage",
                message: "运行日志保存失败",
                detail: getErrorMessage(saveError),
              });
            }
          }

          if (!request.signal.aborted) {
            onEvent({
              type: "error",
              message: errorMessage,
              detail: errorDetail,
            });
          }
        } finally {
          try {
            controller.close();
          } catch {
            // The client may have aborted the request before the server closed the stream.
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
