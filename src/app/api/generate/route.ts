import OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import { jsonrepair } from "jsonrepair";
import { NextResponse } from "next/server";
import { generateFallbackCases } from "@/lib/test-case-generator";
import { normalizeReasoningEffort, providerBaseURLs, providerLabels, providerModels } from "@/lib/model-config";
import type { GenerateResponse, ReasoningEffort, TestCase } from "@/types/test-case";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "cases"],
  properties: {
    summary: { type: "string" },
    cases: {
      type: "array",
      minItems: 1,
      maxItems: 300,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "title", "priority", "module", "preconditions", "steps", "expectedResult"],
        properties: {
          id: { type: "string" },
          category: { enum: ["功能", "边界", "异常", "权限", "性能"] },
          title: { type: "string" },
          priority: { enum: ["P0", "P1", "P2"] },
          module: { type: "string" },
          preconditions: { type: "string" },
          steps: {
            type: "array",
            minItems: 2,
            items: { type: "string" },
          },
          expectedResult: { type: "string" },
        },
      },
    },
  },
};

type LlmProvider = "openai" | "deepseek" | "aliyun" | "velotric";

const providerDefaults: Record<LlmProvider, { model: string; baseURL?: string; envKey: string }> = {
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

function getProvider(value: FormDataEntryValue | null): LlmProvider {
  if (value === "openai" || value === "aliyun" || value === "velotric") return value;
  return "deepseek";
}

function getPrompt(text: string, fileName: string) {
  const truncatedText = text.slice(0, 45_000);
  const systemPrompt =
    "你是资深测试架构师。请从任意行业、任意产品形态的 PRD 中先判断复杂度和测试覆盖蓝图，再生成应该有的测试用例。数量必须由 PRD 的可测试点、风险等级和适用测试类型决定：简单 PRD 不硬凑，复杂 PRD 不漏测。输出必须是中文、可执行、无 Markdown，且不得引入 PRD 无依据的行业假设。";
  const userPrompt = `文件名：${fileName}\n\nPRD 文本：\n${truncatedText}`;

  return { systemPrompt, userPrompt, truncatedText };
}

const jsonOutputInstruction = `请只输出一个严格合法的 JSON object，不要输出 Markdown。JSON 结构示例：
{
  "summary": "一句话概述生成依据和覆盖范围",
  "cases": [
    {
      "id": "TC-001",
      "category": "功能",
      "title": "用例标题",
      "priority": "P0",
      "module": "模块名称",
      "preconditions": "前置条件",
      "steps": ["步骤一", "步骤二"],
      "expectedResult": "预期结果"
    }
  ]
}
字段要求：
1. 先识别 PRD 中所有明确或隐含的可测试模块、子模块、流程、角色、对象、字段规则、状态、权限、集成和数据约束，再按覆盖蓝图生成。
2. module 必须填写具体业务模块名称，不要填写“需求点”“系统”“页面”等泛化名称。
3. 功能用例必须最多，并覆盖正向和逆向功能路径；不要只生成 happy path。
4. 边界、异常、权限、性能只在 PRD 有字段范围、接口/依赖、角色/登录态、并发/大数据/响应时限等依据时生成；不适用时不要硬凑。
5. category 只能是 功能、边界、异常、权限、性能；priority 只能是 P0、P1、P2。
6. cases 总数自适应：极简 PRD 可只有 8-20 条，简单 PRD 通常 20-60 条，中等 PRD 通常 60-180 条，复杂 PRD 可更多。不要为了达到固定条数而扩展 PRD 没有依据的功能。`;

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

function normalizeCases(cases: TestCase[]) {
  return cases.map((item, index) => ({
    ...item,
    id: item.id || `TC-${String(index + 1).padStart(3, "0")}`,
    steps: item.steps.filter(Boolean),
  }));
}

function parseJsonPayload(content: string) {
  const trimmed = content.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  const json = start >= 0 && end >= start ? withoutFence.slice(start, end + 1) : withoutFence;

  try {
    return JSON.parse(json) as Pick<GenerateResponse, "summary" | "cases">;
  } catch {
    return JSON.parse(jsonrepair(json)) as Pick<GenerateResponse, "summary" | "cases">;
  }
}

async function generateWithOpenAI(text: string, fileName: string, apiKey: string, model: string, reasoningEffort: ReasoningEffort): Promise<GenerateResponse> {
  const client = new OpenAI({ apiKey });
  const { systemPrompt, userPrompt, truncatedText } = getPrompt(text, fileName);

  const response = await client.responses.create({
    model,
    reasoning: { effort: reasoningEffort },
    max_output_tokens: 12_000,
    input: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "test_cases",
        schema,
        strict: true,
      },
    },
  });

  const payload = JSON.parse(response.output_text) as Pick<GenerateResponse, "summary" | "cases">;

  return {
    source: "ai",
    fileName,
    summary: payload.summary,
    cases: normalizeCases(payload.cases),
    warnings: text.length > truncatedText.length ? ["PRD 文本较长，已截取前 45000 字符生成。"] : [],
  };
}

async function generateWithCompatibleChat(
  text: string,
  fileName: string,
  apiKey: string,
  model: string,
  provider: Exclude<LlmProvider, "openai">,
  reasoningEffort: ReasoningEffort,
  baseURL?: string,
): Promise<GenerateResponse> {
  const client = new OpenAI({
    apiKey,
    baseURL: baseURL || providerDefaults[provider].baseURL,
  });
  const { systemPrompt, userPrompt, truncatedText } = getPrompt(text, fileName);
  const useJsonMode = true;

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `${systemPrompt}\n\n${jsonOutputInstruction}`,
      },
      {
        role: "user",
        content: `${userPrompt}\n\n请以 json object 返回结果。`,
      },
    ],
    ...(useJsonMode ? { response_format: { type: "json_object" as const } } : {}),
    ...(provider === "velotric" ? { reasoning_effort: reasoningEffort } : {}),
    max_tokens: 12_000,
    stream: false,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`${provider} returned empty content.`);

  const payload = parseJsonPayload(content);

  return {
    source: "ai",
    fileName,
    summary: payload.summary,
    cases: normalizeCases(payload.cases),
    warnings: text.length > truncatedText.length ? ["PRD 文本较长，已截取前 45000 字符生成。"] : [],
  };
}

async function generateWithProvider(
  text: string,
  fileName: string,
  provider: LlmProvider,
  requestApiKey?: string,
  requestModel?: string,
  requestBaseURL?: string,
  requestReasoningEffort: ReasoningEffort = "medium",
): Promise<GenerateResponse | undefined> {
  const config = providerDefaults[provider];
  const apiKey = requestApiKey?.trim() || config.envKey;
  if (!apiKey) return undefined;

  const model = requestModel?.trim() || config.model;
  if (provider === "openai") {
    return generateWithOpenAI(text, fileName, apiKey, model, requestReasoningEffort);
  }

  return generateWithCompatibleChat(text, fileName, apiKey, model, provider, requestReasoningEffort, provider === "velotric" ? requestBaseURL : undefined);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const apiKey = formData.get("apiKey");
    const model = formData.get("model");
    const baseURL = formData.get("baseURL");
    const reasoningEffort = formData.get("reasoningEffort");
    const provider = getProvider(formData.get("provider"));
    const requestApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    const requestModel = typeof model === "string" ? model.trim() : "";
    const requestBaseURL = typeof baseURL === "string" ? baseURL.trim() : "";
    const requestReasoningEffort = normalizeReasoningEffort(typeof reasoningEffort === "string" ? reasoningEffort : "medium");

    if (!(file instanceof File)) {
      return NextResponse.json({ message: "请上传 PDF 格式的 PRD 文档。" }, { status: 400 });
    }

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ message: "仅支持 PDF 文件。" }, { status: 400 });
    }

    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ message: "PDF 文件不能超过 15MB。" }, { status: 400 });
    }

    const text = await extractPdfText(file);
    if (!text || text.length < 30) {
      return NextResponse.json({ message: "未能从 PDF 中提取到足够文本，请确认文档可复制或包含文本层。" }, { status: 422 });
    }

    let aiResult: GenerateResponse | undefined;
    try {
      aiResult = await generateWithProvider(text, file.name, provider, requestApiKey, requestModel, requestBaseURL, requestReasoningEffort);
    } catch (error) {
      console.error(error);
      if (requestApiKey) {
        const providerName = providerLabels[provider];
        return NextResponse.json({ message: `${providerName} 调用失败，请检查网页填写的 API Key、额度、模型名称或模型权限。` }, { status: 401 });
      }
      throw error;
    }

    return NextResponse.json(aiResult ?? generateFallbackCases(text, file.name));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "生成失败，请稍后重试或检查服务配置。" }, { status: 500 });
  }
}
