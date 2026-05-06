import type { GenerationUsage } from "@/types/test-case";

export type Provider = "deepseek" | "aliyun" | "openai" | "velotric";
export type ThinkingMode = "fast" | "quality";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export const providerModels: Record<Provider, string> = {
  deepseek: "deepseek-v4-flash",
  aliyun: "qwen-plus",
  openai: "gpt-5.4-mini",
  velotric: "gpt-5.4",
};

export const providerLabels: Record<Provider, string> = {
  deepseek: "DeepSeek",
  aliyun: "阿里云百炼",
  openai: "OpenAI",
  velotric: "Velotric 号池",
};

export const providerBaseURLs: Partial<Record<Provider, string>> = {
  velotric: "https://api-ai.velotric.net",
};

export const thinkingModeLabels: Record<ThinkingMode, string> = {
  fast: "快速模式",
  quality: "高质量模式",
};

export const thinkingModeDescriptions: Record<ThinkingMode, string> = {
  fast: "关闭思考，首包更快、停顿更少，适合简单到中等 PRD。",
  quality: "开启思考，等待更久、成本更高，适合复杂 PRD 和最终审查。",
};

export const reasoningEffortLabels: Record<ReasoningEffort, string> = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
};

export const reasoningEffortDescriptions: Record<ReasoningEffort, string> = {
  low: "更快、更省 reasoning token，适合简单 PRD 或快速试跑。",
  medium: "速度和质量均衡，适合日常 PRD 生成。",
  high: "推理更充分，适合复杂模块和正式生成。",
  xhigh: "最充分但更慢、更贵；是否可用取决于模型和公司号池权限。",
};

export const reasoningEffortOptions: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

export type ModelPricing = {
  inputPerMTokens: number;
  outputPerMTokens: number;
  qualityOutputPerMTokens?: number;
};

export type DeepSeekPricing = {
  inputCacheHitPerMTokens: number;
  inputCacheMissPerMTokens: number;
  outputPerMTokens: number;
  discountedUntil?: string;
  originalInputCacheHitPerMTokens?: number;
  originalInputCacheMissPerMTokens?: number;
  originalOutputPerMTokens?: number;
};

export type AliyunModelOption = {
  id: string;
  name: string;
  badge: string;
  description: string;
  suitableFor: string;
  pricing: ModelPricing;
};

export type DeepSeekModelOption = {
  id: string;
  name: string;
  badge: string;
  description: string;
  suitableFor: string;
  pricing: DeepSeekPricing;
};

export type OpenAIModelOption = {
  id: string;
  name: string;
  badge: string;
  description: string;
  suitableFor: string;
  pricingNote: string;
};

export const aliyunModelOptions: AliyunModelOption[] = [
  {
    id: "qwen-plus",
    name: "Qwen Plus",
    badge: "默认",
    description: "响应稳定、价格低，默认不开深度思考时延迟较低。",
    suitableFor: "日常 PRD、简单到中等复杂度、希望生成过程更顺滑的场景。",
    pricing: {
      inputPerMTokens: 0.8,
      outputPerMTokens: 2,
      qualityOutputPerMTokens: 8,
    },
  },
  {
    id: "qwen3.6-plus",
    name: "Qwen 3.6 Plus",
    badge: "质量",
    description: "新一代长上下文模型，覆盖拆解和结构化输出能力更强。",
    suitableFor: "中大型 PRD、模块多、规则复杂、希望覆盖更完整的场景。",
    pricing: {
      inputPerMTokens: 2,
      outputPerMTokens: 12,
    },
  },
  {
    id: "qwen3.6-max-preview",
    name: "Qwen 3.6 Max Preview",
    badge: "最强",
    description: "更强推理能力，但 preview 模型可能更慢且费用明显更高。",
    suitableFor: "特别复杂 PRD、关键业务、最终补充审查，不建议日常默认使用。",
    pricing: {
      inputPerMTokens: 9,
      outputPerMTokens: 54,
    },
  },
];

export const deepseekModelOptions: DeepSeekModelOption[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    badge: "默认",
    description: "速度快、成本低，适合输出量大的测试用例生成。",
    suitableFor: "日常 PRD、批量生成、简单到复杂文档的默认尝试。",
    pricing: {
      inputCacheHitPerMTokens: 0.02,
      inputCacheMissPerMTokens: 1,
      outputPerMTokens: 2,
    },
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    badge: "质量",
    description: "复杂任务更稳，当前官方有阶段性优惠，优惠结束后成本会明显上升。",
    suitableFor: "大型复杂 PRD、关键业务、对覆盖完整性要求更高的最终生成。",
    pricing: {
      inputCacheHitPerMTokens: 0.025,
      inputCacheMissPerMTokens: 3,
      outputPerMTokens: 6,
      discountedUntil: "2026-05-31 23:59",
      originalInputCacheHitPerMTokens: 0.1,
      originalInputCacheMissPerMTokens: 12,
      originalOutputPerMTokens: 24,
    },
  },
];

export const openaiModelOptions: OpenAIModelOption[] = [
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    badge: "默认",
    description: "成本和速度更友好，适合日常生成、演示和中小型 PRD。",
    suitableFor: "简单到中等复杂度 PRD、快速验证平台效果、批量试跑。",
    pricingNote: "实际费用按 OpenAI 控制台账单和该模型实时价格为准。",
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    badge: "质量",
    description: "通用能力更强，适合需要更稳覆盖和更好结构化输出的 PRD。",
    suitableFor: "中大型 PRD、规则较多、流程和状态较复杂的产品需求。",
    pricingNote: "通常高于 mini 档，实际费用以 OpenAI 控制台账单为准。",
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    badge: "最强",
    description: "更适合高复杂度拆解和最终审查，但成本和等待时间通常更高。",
    suitableFor: "大型复杂 PRD、核心业务验收、对覆盖完整性要求最高的场景。",
    pricingNote: "通常为高质量档，建议只在关键 PRD 上使用，实际费用以 OpenAI 控制台账单为准。",
  },
];

export const velotricModelOptions: OpenAIModelOption[] = [
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    badge: "公司默认",
    description: "公司 AI Portal 指南推荐模型，需配合 Velotric GPT 号池网关和 sk-velotric Key 使用。",
    suitableFor: "日常 Codex 同款模型能力、中大型 PRD、希望走公司统一号池的场景。",
    pricingNote: "费用、额度和权限由公司 AI 网关统一管理；如遇 403 优先检查模型名和公司号池权限。",
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    badge: "更强",
    description: "公司号池可选的更强模型，适合复杂 PRD 的覆盖拆解和最终审查。",
    suitableFor: "大型复杂 PRD、关键业务、希望覆盖更稳但可以接受更慢等待的场景。",
    pricingNote: "费用、额度和权限由公司 AI 网关统一管理；如遇 403 可能是模型权限未开通。",
  },
];

export function normalizeProvider(value: string): Provider {
  return value === "aliyun" || value === "openai" || value === "deepseek" || value === "velotric" ? value : "deepseek";
}

export function normalizeThinkingMode(value: string): ThinkingMode {
  return value === "quality" ? "quality" : "fast";
}

export function normalizeReasoningEffort(value: string): ReasoningEffort {
  if (value === "low" || value === "high" || value === "xhigh") return value;
  return "medium";
}

export function getAliyunModelOption(model: string) {
  return aliyunModelOptions.find((item) => item.id === model) ?? aliyunModelOptions[0];
}

export function getDeepSeekModelOption(model: string) {
  return deepseekModelOptions.find((item) => item.id === model) ?? deepseekModelOptions[0];
}

export function getOpenAIModelOption(model: string) {
  return openaiModelOptions.find((item) => item.id === model) ?? openaiModelOptions[0];
}

export function getVelotricModelOption(model: string) {
  return velotricModelOptions.find((item) => item.id === model) ?? velotricModelOptions[0];
}

export function getAliyunOutputPrice(model: string, thinkingMode: ThinkingMode) {
  const option = getAliyunModelOption(model);
  if (thinkingMode === "quality" && option.pricing.qualityOutputPerMTokens) return option.pricing.qualityOutputPerMTokens;
  return option.pricing.outputPerMTokens;
}

export function estimateAliyunCostCny(model: string, thinkingMode: ThinkingMode, usage?: GenerationUsage) {
  if (!usage?.totalTokens) return null;
  const option = getAliyunModelOption(model);
  const inputCost = ((usage.promptTokens ?? 0) / 1_000_000) * option.pricing.inputPerMTokens;
  const outputCost = ((usage.completionTokens ?? 0) / 1_000_000) * getAliyunOutputPrice(model, thinkingMode);
  return inputCost + outputCost;
}

export function estimateDeepSeekCostCny(model: string, usage?: GenerationUsage) {
  if (!usage?.totalTokens) return null;
  const option = getDeepSeekModelOption(model);
  const inputCost = ((usage.promptTokens ?? 0) / 1_000_000) * option.pricing.inputCacheMissPerMTokens;
  const outputCost = ((usage.completionTokens ?? 0) / 1_000_000) * option.pricing.outputPerMTokens;
  return inputCost + outputCost;
}
