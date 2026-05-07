import type {
  AgentAnalysisItem,
  AgentAnalysisResponse,
  AgentAnalysisSection,
  TestAgentAnalysisType,
  TestAgentType,
  TestPriority,
} from "@/types/test-case";

export const testAgentTypes: TestAgentType[] = ["requirement-review", "case-generator", "release-risk"];

export const analysisAgentTypes: TestAgentAnalysisType[] = ["requirement-review", "release-risk"];

const priorityValues: TestPriority[] = ["P0", "P1", "P2"];

type AgentPrompt = {
  system: string;
  user: string;
  maxTokens: number;
};

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePriority(value: unknown): TestPriority | undefined {
  if (priorityValues.includes(value as TestPriority)) return value as TestPriority;
  const text = cleanText(value).toUpperCase();
  if (priorityValues.includes(text as TestPriority)) return text as TestPriority;
  return undefined;
}

function normalizeItem(value: unknown, fallbackTitle: string): AgentAnalysisItem | null {
  if (typeof value === "string") {
    const detail = cleanText(value);
    if (!detail) return null;
    return { title: fallbackTitle, detail };
  }

  if (!value || typeof value !== "object") return null;
  const source = value as Partial<AgentAnalysisItem>;
  const title = cleanText(source.title) || fallbackTitle;
  const detail = cleanText(source.detail || source.suggestion || source.evidence);
  if (!title || !detail) return null;

  return {
    title,
    detail,
    ...(normalizePriority(source.priority) ? { priority: normalizePriority(source.priority) } : {}),
    ...(cleanText(source.category) ? { category: cleanText(source.category).slice(0, 20) } : {}),
    ...(cleanText(source.evidence) ? { evidence: cleanText(source.evidence).slice(0, 220) } : {}),
    ...(cleanText(source.suggestion) ? { suggestion: cleanText(source.suggestion).slice(0, 260) } : {}),
  };
}

function normalizeSection(value: unknown, index: number): AgentAnalysisSection | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<AgentAnalysisSection>;
  const title = cleanText(source.title) || `分析项 ${index + 1}`;
  const items = Array.isArray(source.items) ? source.items.map((item, itemIndex) => normalizeItem(item, `${title} ${itemIndex + 1}`)).filter((item): item is AgentAnalysisItem => item !== null) : [];
  if (!items.length) return null;

  return {
    title,
    ...(cleanText(source.description) ? { description: cleanText(source.description).slice(0, 260) } : {}),
    items: items.slice(0, 12),
  };
}

function normalizeList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean).slice(0, limit);
}

export function normalizeTestAgent(value: string): TestAgentType {
  if (value === "requirement-review" || value === "release-risk" || value === "case-generator") return value;
  return "case-generator";
}

export function normalizeAnalysisAgent(value: string): TestAgentAnalysisType {
  return value === "release-risk" ? "release-risk" : "requirement-review";
}

export function normalizeAgentAnalysisPayload(
  value: unknown,
  agent: TestAgentAnalysisType,
  source: AgentAnalysisResponse["source"],
  warnings: string[] = [],
): AgentAnalysisResponse {
  const payload = value && typeof value === "object" ? (value as Partial<AgentAnalysisResponse>) : {};
  const sections = Array.isArray(payload.sections)
    ? payload.sections.map(normalizeSection).filter((item): item is AgentAnalysisSection => item !== null)
    : [];
  const fallbackTitle = agent === "requirement-review" ? "需求评审报告" : "发布风险报告";
  const summary = cleanText(payload.summary) || (agent === "requirement-review" ? "已完成需求疑点、风险和测试关注点整理。" : "已完成发布风险、回归范围和上线检查整理。");

  return {
    agent,
    source,
    title: cleanText(payload.title) || fallbackTitle,
    summary,
    sections: sections.length ? sections.slice(0, 6) : fallbackSections(agent, summary),
    checklist: normalizeList(payload.checklist, 16),
    nextActions: normalizeList(payload.nextActions, 12),
    warnings,
  };
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[。！？.!?；;])\s+|[\n\r]+|(?:\d+\.|[一二三四五六七八九十]+、)/)
    .map(cleanText)
    .filter((item) => item.length >= 8)
    .slice(0, 120);
}

function pickBySignals(sentences: string[], signals: string[], limit: number) {
  const matched = sentences.filter((sentence) => signals.some((signal) => sentence.includes(signal)));
  return (matched.length ? matched : sentences).slice(0, limit);
}

function toItems(sentences: string[], category: string, priority: TestPriority) {
  return sentences.map((sentence, index) => ({
    title: `${category} ${index + 1}`,
    detail: sentence,
    priority,
    category,
  }));
}

function fallbackSections(agent: TestAgentAnalysisType, summary: string): AgentAnalysisSection[] {
  return [
    {
      title: agent === "requirement-review" ? "需求评审" : "发布风险",
      items: [
        {
          title: "分析结果",
          detail: summary,
          priority: "P1",
        },
      ],
    },
  ];
}

export function generateFallbackAgentAnalysis(agent: TestAgentAnalysisType, input: string): AgentAnalysisResponse {
  const sentences = splitSentences(input);
  const seed = sentences.length ? sentences : [cleanText(input) || "未提供足够内容。"];

  if (agent === "release-risk") {
    const scope = pickBySignals(seed, ["新增", "修改", "修复", "变更", "接口", "字段", "流程", "权限", "配置"], 6);
    const risks = pickBySignals(seed, ["风险", "失败", "异常", "兼容", "回滚", "影响", "线上", "数据", "支付", "权限"], 6);
    const sections: AgentAnalysisSection[] = [
      {
        title: "回归范围",
        description: "基于发布内容提取的必测范围。",
        items: toItems(scope, "回归", "P1"),
      },
      {
        title: "发布风险",
        description: "需要在发版前重点确认的风险。",
        items: toItems(risks, "风险", "P0"),
      },
      {
        title: "上线检查",
        items: [
          { title: "核心链路冒烟", detail: "覆盖登录、主流程提交、关键数据查询和异常提示。", priority: "P0", category: "冒烟" },
          { title: "失败回滚确认", detail: "确认发布失败、配置错误或依赖异常时有可执行的回滚方案。", priority: "P0", category: "上线" },
          { title: "监控与日志", detail: "确认关键接口、错误率、耗时和业务日志可观测。", priority: "P1", category: "监控" },
        ],
      },
    ];

    return {
      agent,
      source: "fallback",
      title: "发布风险报告",
      summary: `已基于 ${seed.length} 个发布片段整理回归范围、风险点和上线检查项。`,
      sections,
      checklist: ["核心链路冒烟通过", "关键接口无 5xx 或超时", "权限与数据隔离验证通过", "回滚方案可执行", "监控告警已确认"],
      nextActions: ["补充本次发布涉及的模块、接口和配置项", "将 P0 风险转成发版前检查项", "把核心链路沉淀为自动冒烟脚本"],
      warnings: ["未检测到可用的模型 API Key，当前报告由本地规则生成。"],
    };
  }

  const questions = pickBySignals(seed, ["是否", "如何", "待定", "需要", "支持", "规则", "默认", "配置", "可选"], 6);
  const boundaries = pickBySignals(seed, ["字段", "状态", "上限", "下限", "数量", "时间", "金额", "分页", "格式", "枚举"], 6);
  const permissions = pickBySignals(seed, ["角色", "权限", "登录", "账号", "会员", "管理员", "数据", "隐私", "越权"], 6);
  const failures = pickBySignals(seed, ["失败", "异常", "错误", "超时", "网络", "接口", "服务", "重复", "取消", "回滚"], 6);

  return {
    agent,
    source: "fallback",
    title: "需求评审报告",
    summary: `已基于 ${seed.length} 个需求片段整理需求疑点、边界、权限和异常关注点。`,
    sections: [
      { title: "需求疑点", description: "需要向产品或研发确认的内容。", items: toItems(questions, "疑点", "P1") },
      { title: "边界条件", description: "字段、状态、数量和流程边界。", items: toItems(boundaries, "边界", "P1") },
      { title: "权限与数据", description: "角色、登录态、数据隔离和敏感信息。", items: toItems(permissions, "权限", "P0") },
      { title: "异常场景", description: "失败路径、依赖异常和恢复机制。", items: toItems(failures, "异常", "P1") },
    ],
    checklist: ["主流程正向路径明确", "字段规则和状态流转明确", "权限边界明确", "异常提示和回滚规则明确", "数据兼容和历史数据影响明确"],
    nextActions: ["把 P0 疑点带到需求评审会确认", "将边界和异常项转成测试点", "确认需要研发补充日志或监控的位置"],
    warnings: ["未检测到可用的模型 API Key，当前报告由本地规则生成。"],
  };
}

export function buildAgentPrompt(agent: TestAgentAnalysisType, input: string): AgentPrompt {
  const clippedInput = input.slice(0, 45_000);
  const commonSchema = `只输出严格 JSON object，不要 Markdown。结构固定为：
{
  "title": "报告标题",
  "summary": "一句话总结",
  "sections": [
    {
      "title": "分组标题",
      "description": "分组说明",
      "items": [
        {
          "title": "条目标题",
          "detail": "具体分析",
          "priority": "P0",
          "category": "分类",
          "evidence": "输入中的依据",
          "suggestion": "建议动作"
        }
      ]
    }
  ],
  "checklist": ["检查项"],
  "nextActions": ["下一步动作"]
}`;

  if (agent === "release-risk") {
    return {
      maxTokens: 4_000,
      system: "你是资深测试负责人，专门在发版前根据需求变更、Bug、发布说明、接口变更或代码 diff 判断测试风险。输出中文、短句、可执行检查项。",
      user: `请分析下面发布材料，输出发布风险报告。要求：
1. 聚焦唯一测试可执行的回归范围，不写空泛建议。
2. 必须包含回归范围、P0/P1 发布风险、冒烟清单、上线检查项。
3. 如果材料中有接口、权限、数据、配置、兼容、性能、灰度、回滚、监控信息，必须单独指出。
4. priority 只能是 P0/P1/P2。P0 表示不测可能造成线上事故或核心链路失败。
5. checklist 用短句，适合发版前逐项勾选。
6. nextActions 写 3-8 条最该马上做的事。

${commonSchema}

发布材料：
${clippedInput}`,
    };
  }

  return {
    maxTokens: 4_500,
    system: "你是资深测试架构师，专门在需求评审阶段发现漏点、风险、边界、异常、权限和需要反问产品的问题。输出中文、短句、工具型。",
    user: `请评审下面需求材料，输出需求评审报告。要求：
1. 不生成测试用例，只做需求评审和测试设计前置分析。
2. 必须包含需求疑点、边界条件、异常场景、权限与数据、测试风险。
3. 每个条目要写依据 evidence，不能凭空扩展需求。
4. priority 只能是 P0/P1/P2。P0 表示不确认会影响核心流程或可能线上事故。
5. checklist 用短句，适合需求评审会逐项确认。
6. nextActions 写 3-8 条最该马上做的事。

${commonSchema}

需求材料：
${clippedInput}`,
  };
}
