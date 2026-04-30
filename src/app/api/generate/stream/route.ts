import OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import { jsonrepair } from "jsonrepair";
import { generateFallbackCases } from "@/lib/test-case-generator";
import type { GenerateResponse, TestCase, TestCategory, TestPriority } from "@/types/test-case";

export const runtime = "nodejs";
export const maxDuration = 300;

type LlmProvider = "openai" | "deepseek" | "aliyun";

type StreamEvent =
  | { type: "stage"; message: string; detail?: string }
  | { type: "chunk"; content: string }
  | { type: "result"; data: GenerateResponse }
  | { type: "error"; message: string; detail?: string }
  | { type: "done" };

type ModulePlan = {
  name: string;
  parent?: string;
  description?: string;
  isCore?: boolean;
  testPoints?: string[];
  riskPoints?: string[];
  targetCaseCount?: number;
};

type ModulePlanResponse = {
  modules: ModulePlan[];
};

type CaseBatchResponse = {
  cases: TestCase[];
};

const categories: TestCategory[] = ["功能", "边界", "异常", "权限", "性能"];
const priorities: TestPriority[] = ["P0", "P1", "P2"];
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
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    envKey: process.env.OPENAI_API_KEY || "",
  },
  deepseek: {
    label: "DeepSeek",
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    baseURL: "https://api.deepseek.com",
    envKey: process.env.DEEPSEEK_API_KEY || "",
  },
  aliyun: {
    label: "阿里云百炼",
    model: process.env.DASHSCOPE_MODEL || "qwen-plus",
    baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envKey: process.env.DASHSCOPE_API_KEY || "",
  },
};

function getProvider(value: FormDataEntryValue | null): LlmProvider {
  if (value === "openai" || value === "aliyun") return value;
  return "deepseek";
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

function createClient(provider: LlmProvider, apiKey: string) {
  const config = providerDefaults[provider];
  return new OpenAI({
    apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

async function streamJsonRequest<T>({
  apiKey,
  model,
  provider,
  messages,
  maxTokens,
  onEvent,
  stageLabel,
}: {
  apiKey: string;
  model: string;
  provider: LlmProvider;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  maxTokens: number;
  onEvent: (event: StreamEvent) => void;
  stageLabel: string;
}) {
  const client = createClient(provider, apiKey);
  const stream = await client.chat.completions.create({
    model,
    messages,
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    stream: true,
  });

  let content = "";
  let chunkCount = 0;
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
    const delta = chunk.choices[0]?.delta?.content ?? "";
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

  if (!content.trim()) throw new Error(`${providerDefaults[provider].label} 返回了空内容。`);

  return {
    payload: parseJsonObject<T>(content),
    rawLength: content.length,
    finishReason,
  };
}

function formatModuleName(module: ModulePlan) {
  const name = module.name?.trim() || "未命名模块";
  const parent = module.parent?.trim();
  if (!parent || name.includes(parent)) return name;
  return `${parent} / ${name}`;
}

function normalizeModulePlan(payload: ModulePlanResponse) {
  const seen = new Set<string>();
  const modules = (payload.modules ?? [])
    .map((item) => ({
      ...item,
      name: item.name?.trim(),
      parent: item.parent?.trim(),
      testPoints: (item.testPoints ?? []).map((point) => point.trim()).filter(Boolean).slice(0, 24),
      riskPoints: (item.riskPoints ?? []).map((point) => point.trim()).filter(Boolean).slice(0, 12),
    }))
    .filter((item) => Boolean(item.name))
    .filter((item) => {
      const key = formatModuleName(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);

  return modules.map((item) => {
    const pointCount = item.testPoints?.length ?? 0;
    const baseTarget = item.isCore ? 36 : 22;
    const pointTarget = Math.max(0, pointCount - 4) * 2;
    return {
      ...item,
      name: item.name || "未命名模块",
      targetCaseCount: Math.min(56, Math.max(item.isCore ? 32 : 20, item.targetCaseCount ?? baseTarget + pointTarget)),
    };
  });
}

function getRelevantPrdText(text: string, module: ModulePlan) {
  const chunks = text
    .split(/(?<=[。！？.!?；;])\s+|[\n\r]+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 8);
  const keywords = [module.name, module.parent, ...(module.testPoints ?? []), ...(module.riskPoints ?? [])]
    .filter(Boolean)
    .flatMap((item) => String(item).split(/[、,，/｜|()（）\s]+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 30);

  const matched = chunks.filter((chunk) => keywords.some((keyword) => chunk.includes(keyword)));
  const source = matched.length >= 6 ? matched : chunks;
  return source.join("\n").slice(0, matched.length >= 6 ? 22_000 : 32_000);
}

function getCaseTargets(total: number) {
  const functional = Math.max(12, Math.ceil(total * 0.64));
  const boundary = Math.max(3, Math.ceil(total * 0.12));
  const exception = Math.max(3, Math.ceil(total * 0.12));
  const permission = Math.max(2, Math.ceil(total * 0.06));
  const performance = Math.max(1, total - functional - boundary - exception - permission);
  const negativeFunctional = Math.max(5, Math.ceil(functional * 0.38));
  return { functional, negativeFunctional, boundary, exception, permission, performance };
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

function normalizeCases(cases: TestCase[], module: ModulePlan) {
  return cases
    .map((item) => {
      const category = categories.includes(item.category) ? item.category : "功能";
      const priority = priorities.includes(item.priority) ? item.priority : category === "功能" ? "P1" : "P2";
      return {
        id: item.id || "",
        category,
        title: item.title?.trim() || `${formatModuleName(module)}测试用例`,
        priority,
        module: formatModuleName(module),
        preconditions: item.preconditions?.trim() || `${formatModuleName(module)}模块可访问，测试数据和依赖服务可用。`,
        steps: (item.steps ?? []).map((step) => step.trim()).filter(Boolean),
        expectedResult: item.expectedResult?.trim() || "结果符合 PRD 预期。",
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

function buildSummary(fileName: string, modules: ModulePlan[], cases: TestCase[]) {
  const counts = categories.map((category) => `${category} ${cases.filter((item) => item.category === category).length} 条`).join("、");
  const coreModules = modules.filter((module) => module.isCore).map(formatModuleName).slice(0, 8);
  return `基于 ${fileName} 分阶段生成：识别 ${modules.length} 个功能模块，合并 ${cases.length} 条可执行测试用例，其中 ${counts}。功能用例按显式功能点优先展开；${coreModules.length ? `核心模块包括 ${coreModules.join("、")}。` : "未单独标记核心模块。"}`;
}

async function generateModulePlan({
  apiKey,
  fileName,
  model,
  onEvent,
  provider,
  text,
}: {
  apiKey: string;
  fileName: string;
  model: string;
  onEvent: (event: StreamEvent) => void;
  provider: LlmProvider;
  text: string;
}) {
  onEvent({
    type: "stage",
    message: "阶段 1：识别功能模块树",
    detail: `${providerDefaults[provider].label} / ${model}`,
  });

  const truncatedText = text.slice(0, 45_000);
  const { payload, rawLength } = await streamJsonRequest<ModulePlanResponse>({
    apiKey,
    model,
    provider,
    maxTokens: 5_000,
    stageLabel: "模块识别",
    onEvent,
    messages: [
      {
        role: "system",
        content:
          "你是资深测试架构师。你的任务是从任意行业、任意产品形态的 PRD 中识别完整可测试范围，不生成测试用例。只输出严格 JSON object。",
      },
      {
        role: "user",
        content: `文件名：${fileName}

请从下面 PRD 中识别所有可测试功能模块和子模块。要求：
1. 不要假设产品类型。先从 PRD 自身识别业务域、用户角色、使用场景、端类型和核心对象。
2. 覆盖所有可测试范围：一级模块、子模块、页面/接口/流程/任务、配置项、数据对象、状态机、字段规则、业务规则、审批/流转、通知、报表、导入导出、第三方集成、权限、审计、异常和性能相关能力。
3. testPoints 必须列出该模块全部显式测试点，包括但不限于入口、操作、字段、参数、校验规则、状态变化、前置条件、后置结果、数据展示、数据同步、兼容差异、错误码、空状态和降级逻辑。
4. riskPoints 列出该模块需要重点覆盖的边界、异常、权限、安全、兼容、性能、数据一致性和幂等风险。
5. isCore 标记高频、高风险、强依赖、功能密集、资金/隐私/权限/数据影响大的模块。
6. targetCaseCount 根据模块复杂度估算；核心模块通常 36-56，普通模块通常 22-36，简单模块不低于 16。
7. 不要生成测试用例。
8. 只输出 JSON：
{
  "modules": [
    {
      "name": "子模块名称",
      "parent": "一级模块名称",
      "description": "模块职责",
      "isCore": true,
      "testPoints": ["显式功能点1", "显式功能点2"],
      "riskPoints": ["边界/异常/权限/性能风险点"],
      "targetCaseCount": 36
    }
  ]
}

PRD 文本：
${truncatedText}`,
      },
    ],
  });

  const modules = normalizeModulePlan(payload);
  onEvent({
    type: "stage",
    message: "模块树识别完成",
    detail: `收到 ${rawLength.toLocaleString("zh-CN")} 字符，识别 ${modules.length} 个模块`,
  });
  return modules;
}

async function generateCasesForModule({
  apiKey,
  index,
  model,
  module,
  moduleCount,
  onEvent,
  provider,
  text,
}: {
  apiKey: string;
  index: number;
  model: string;
  module: ModulePlan;
  moduleCount: number;
  onEvent: (event: StreamEvent) => void;
  provider: LlmProvider;
  text: string;
}) {
  const moduleName = formatModuleName(module);
  const target = module.targetCaseCount ?? (module.isCore ? 36 : 22);
  const targets = getCaseTargets(target);
  const context = getRelevantPrdText(text, module);

  onEvent({
    type: "stage",
    message: `阶段 2：生成模块用例 ${index + 1}/${moduleCount}`,
    detail: `${moduleName}，目标 ${target} 条，功能用例至少 ${targets.functional} 条`,
  });

  const { payload, rawLength, finishReason } = await streamJsonRequest<CaseBatchResponse>({
    apiKey,
    model,
    provider,
    maxTokens: Math.min(14_000, Math.max(7_000, target * 420)),
    stageLabel: moduleName,
    onEvent,
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
显式测试点：
${(module.testPoints ?? []).map((point, pointIndex) => `${pointIndex + 1}. ${point}`).join("\n") || "无"}
风险点：
${(module.riskPoints ?? []).map((point, pointIndex) => `${pointIndex + 1}. ${point}`).join("\n") || "无"}

请只为当前模块生成测试用例，禁止生成其他模块。

数量和覆盖规则：
1. 总数目标 ${target} 条，允许上下浮动 3 条。
2. 功能用例必须最多，至少 ${targets.functional} 条。
3. 功能用例不能只有正向 happy path，至少 ${targets.negativeFunctional} 条功能用例必须是逆向/失败/不可用/状态不满足/前置条件不满足/用户取消/服务返回失败等场景，category 仍然标为“功能”。
4. 边界至少 ${targets.boundary} 条，异常至少 ${targets.exception} 条，权限至少 ${targets.permission} 条，性能至少 ${targets.performance} 条。
5. 对每一个显式测试点，至少生成 1 条正向功能用例和 1 条逆向功能用例；复杂测试点还要补充状态切换、保存失败、取消、重试、恢复默认、重复点击、前后台切换等功能类用例。
6. 每个入口、操作、字段、开关/配置、状态、参数范围、角色差异、数据差异、环境差异、保存/取消/恢复、重复提交、并发操作、前后台/页面切换、网络/依赖服务、错误码/错误提示，都要尽量单独成用例。
7. 不要把多个功能点合并成一个“核心流程”用例。不要只写“成功进入/成功保存”。
8. title 必须具体到功能点、条件或状态，不要泛化。
9. steps 写成可执行动作，expectedResult 写可验证结果。
10. module 字段统一填写：${moduleName}

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
      "preconditions": "前置条件",
      "steps": ["步骤1", "步骤2"],
      "expectedResult": "预期结果"
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
  };
}

async function generateNegativeRepairCasesForModule({
  apiKey,
  existingCases,
  gap,
  model,
  module,
  onEvent,
  provider,
  text,
}: {
  apiKey: string;
  existingCases: TestCase[];
  gap: number;
  model: string;
  module: ModulePlan;
  onEvent: (event: StreamEvent) => void;
  provider: LlmProvider;
  text: string;
}) {
  const moduleName = formatModuleName(module);
  const context = getRelevantPrdText(text, module);

  onEvent({
    type: "stage",
    message: "质量检查：补充逆向功能用例",
    detail: `${moduleName} 逆向功能缺口 ${gap} 条`,
  });

  const { payload, rawLength, finishReason } = await streamJsonRequest<CaseBatchResponse>({
    apiKey,
    model,
    provider,
    maxTokens: Math.min(7_000, Math.max(3_500, gap * 520)),
    stageLabel: `${moduleName} 逆向补充`,
    onEvent,
    messages: [
      {
        role: "system",
        content:
          "你是资深测试架构师。你正在修复某个模块的逆向功能覆盖不足问题。只输出严格 JSON object，不要 Markdown，不要总结说明。",
      },
      {
        role: "user",
        content: `当前模块：${moduleName}
模块说明：${module.description ?? "无"}
显式测试点：
${(module.testPoints ?? []).map((point, pointIndex) => `${pointIndex + 1}. ${point}`).join("\n") || "无"}

该模块已生成的用例标题：
${existingCases.map((item, caseIndex) => `${caseIndex + 1}. [${item.category}] ${item.title}`).join("\n")}

请补充 ${gap} 条新的“功能”类逆向用例，要求：
1. category 必须全部填写“功能”。
2. 只补当前模块，module 字段统一填写：${moduleName}
3. 必须覆盖已生成用例没有覆盖到的失败路径、状态不满足、前置条件不满足、取消、重复提交、依赖失败、数据不一致、服务错误、超时、不可用、权限外但属于功能路径的场景。
4. 不要重复已生成标题，不要写泛化标题。
5. 每条 steps 必须可执行，expectedResult 必须可验证。
6. 严格依据 PRD 文本，不要引入无依据的行业假设。

只输出 JSON：
{
  "cases": [
    {
      "id": "补充ID",
      "category": "功能",
      "title": "具体逆向功能测试点",
      "priority": "P1",
      "module": "${moduleName}",
      "preconditions": "前置条件",
      "steps": ["步骤1", "步骤2"],
      "expectedResult": "预期结果"
    }
  ]
}

PRD 相关文本：
${context}`,
      },
    ],
  });

  const cases = normalizeCases(payload.cases ?? [], module).map((item) => ({ ...item, category: "功能" as const }));
  onEvent({
    type: "stage",
    message: "逆向功能补充完成",
    detail: `${moduleName}：收到 ${rawLength.toLocaleString("zh-CN")} 字符，补充 ${cases.length} 条${finishReason === "length" ? "，模型触达 token 上限" : ""}`,
  });

  return {
    cases,
    hitTokenLimit: finishReason === "length",
  };
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const onEvent = (event: StreamEvent) => send(controller, encoder, event);

        try {
          onEvent({ type: "stage", message: "已收到生成请求" });

          const formData = await request.formData();
          const file = formData.get("file");
          const apiKeyValue = formData.get("apiKey");
          const modelValue = formData.get("model");
          const provider = getProvider(formData.get("provider"));
          const config = providerDefaults[provider];
          const requestApiKey = typeof apiKeyValue === "string" ? apiKeyValue.trim() : "";
          const apiKey = requestApiKey || config.envKey;
          const model = typeof modelValue === "string" && modelValue.trim() ? modelValue.trim() : config.model;

          onEvent({
            type: "stage",
            message: "已读取模型配置",
            detail: `${config.label} / ${model} / ${apiKey ? "已提供 API Key" : "未提供 API Key"}`,
          });

          if (!(file instanceof File)) {
            onEvent({ type: "error", message: "请上传 PDF 格式的 PRD 文档。" });
            return;
          }

          if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
            onEvent({ type: "error", message: "仅支持 PDF 文件。" });
            return;
          }

          if (file.size > 15 * 1024 * 1024) {
            onEvent({ type: "error", message: "PDF 文件不能超过 15MB。" });
            return;
          }

          onEvent({
            type: "stage",
            message: "正在解析 PDF 文本",
            detail: `${file.name} / ${(file.size / 1024 / 1024).toFixed(2)} MB`,
          });

          const text = await extractPdfText(file);
          if (!text || text.length < 30) {
            onEvent({ type: "error", message: "未能从 PDF 中提取到足够文本，请确认文档可复制或包含文本层。" });
            return;
          }

          onEvent({
            type: "stage",
            message: "PDF 解析完成",
            detail: `提取 ${text.length.toLocaleString("zh-CN")} 个字符`,
          });

          let result: GenerateResponse;
          if (apiKey) {
            const modules = await generateModulePlan({
              apiKey,
              fileName: file.name,
              model,
              onEvent,
              provider,
              text,
            });

            if (!modules.length) throw new Error("模型未能识别出可测试功能模块。");

            const warnings: string[] = [];
            const allCases: TestCase[] = [];

            for (let index = 0; index < modules.length; index += 1) {
              const currentModule = modules[index];
              const batch = await generateCasesForModule({
                apiKey,
                index,
                model,
                module: currentModule,
                moduleCount: modules.length,
                onEvent,
                provider,
                text,
              });
              let moduleCases = batch.cases;
              if (batch.hitTokenLimit) warnings.push(`${formatModuleName(currentModule)} 输出达到 token 上限，已尽力解析。`);

              const gap = getNegativeCoverageGap(moduleCases, getCaseTargets(currentModule.targetCaseCount ?? (currentModule.isCore ? 36 : 22)));
              if (gap > 0) {
                const repair = await generateNegativeRepairCasesForModule({
                  apiKey,
                  existingCases: moduleCases,
                  gap,
                  model,
                  module: currentModule,
                  onEvent,
                  provider,
                  text,
                });
                moduleCases = [...moduleCases, ...repair.cases];
                if (repair.hitTokenLimit) warnings.push(`${formatModuleName(currentModule)} 逆向补充达到 token 上限，已尽力解析。`);
              }

              allCases.push(...moduleCases);
            }

            const cases = dedupeAndRenumber(allCases);
            result = {
              source: "ai",
              fileName: file.name,
              summary: buildSummary(file.name, modules, cases),
              cases,
              warnings,
            };
          } else {
            onEvent({
              type: "stage",
              message: "未检测到 API Key，改用本地规则生成",
              detail: "本次不会调用外部 AI 服务",
            });
            result = generateFallbackCases(text, file.name);
          }

          onEvent({
            type: "stage",
            message: "阶段 3：合并并统计结果",
            detail: `识别 ${new Set(result.cases.map((item) => item.module)).size} 个模块，生成 ${result.cases.length} 条用例`,
          });
          onEvent({ type: "result", data: result });
          onEvent({ type: "done" });
        } catch (error) {
          console.error(error);
          onEvent({
            type: "error",
            message: "生成失败，请检查 API Key、额度、模型名称、模型权限或网络连接。",
            detail: getErrorMessage(error),
          });
        } finally {
          controller.close();
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
