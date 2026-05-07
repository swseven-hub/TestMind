import OpenAI from "openai";
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
    const body = (await request.json()) as AnalyzeRequest;
    const agent = normalizeAnalysisAgent(body.agent ?? "");
    const input = String(body.input ?? "").trim();

    if (input.length < 20) {
      return NextResponse.json({ message: "请输入至少 20 个字符的分析材料。" }, { status: 400 });
    }

    if (input.length > 80_000) {
      return NextResponse.json({ message: "单次分析材料不能超过 80000 个字符。" }, { status: 400 });
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
      const fallback = generateFallbackAgentAnalysis(agent, input);
      return NextResponse.json(withStats({ agent, input, model, provider, result: fallback, startedAt, thinkingMode, reasoningEffort }));
    }

    const result = await analyzeWithModel({
      agent,
      apiKey,
      baseURL,
      input,
      model,
      provider,
      reasoningEffort,
      thinkingMode,
    });

    return NextResponse.json(withStats({ agent, input, model, provider, result, startedAt, thinkingMode, reasoningEffort }));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: error instanceof Error ? error.message : "智能体分析失败，请稍后重试。" }, { status: 500 });
  }
}
