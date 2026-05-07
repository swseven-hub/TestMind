export type TestCategory = "功能" | "边界" | "异常" | "权限" | "性能";

export type TestPriority = "P0" | "P1" | "P2";

export type TestCaseImportType = "功能测试" | "性能测试" | "配置相关" | "安装部署" | "接口测试" | "安全相关" | "兼容性测试" | "UI测试" | "其他";

export type TestExecutionType = "手动";

export type Complexity = "minimal" | "simple" | "medium" | "complex" | "large";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ThinkingMode = "fast" | "quality";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type RunStatus = "success" | "failed" | "cancelled";

export type TestAgentType = "requirement-review" | "case-generator" | "release-risk" | "change-impact" | "debug-assistant";

export type TestAgentAnalysisType = Exclude<TestAgentType, "case-generator">;

export type GenerationUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
};

export type GenerationModuleStats = {
  name: string;
  caseCount: number;
  durationMs: number;
  usage?: GenerationUsage;
};

export type GenerationStats = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  provider: "deepseek" | "aliyun" | "openai" | "velotric";
  model: string;
  thinkingMode?: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
  usage?: GenerationUsage;
  estimatedCostCny?: number | null;
  sourceTextLength?: number;
  plannedCaseCount?: number;
  moduleCount: number;
  caseCount: number;
  modules: GenerationModuleStats[];
};

export type CategoryTargetMap = Partial<Record<TestCategory, number>>;

export type CoverageTestPoint = {
  id: string;
  name: string;
  evidence: string;
  fields: string[];
  states: string[];
  roles: string[];
  flows: string[];
  rules: string[];
  riskLevel: RiskLevel;
  riskFactors: string[];
  coverage: CategoryTargetMap;
  expectedCaseCount: number;
};

export type CoverageModule = {
  name: string;
  parent?: string;
  description?: string;
  complexity: Complexity;
  riskLevel: RiskLevel;
  isCore: boolean;
  testPoints: CoverageTestPoint[];
  riskPoints: string[];
  categoryTargets: CategoryTargetMap;
  skippedCategories: string[];
  coverageNotes: string[];
  targetCaseCount: number;
};

export type CoverageBlueprint = {
  documentComplexity: Complexity;
  coverageRationale: string;
  modules: CoverageModule[];
  plannedCaseCount: number;
};

export type TestCase = {
  id: string;
  category: TestCategory;
  title: string;
  priority: TestPriority;
  module: string;
  status?: string;
  maintainer?: string;
  caseType?: TestCaseImportType;
  executionType?: TestExecutionType;
  estimatedHours?: number | null;
  remainingHours?: number | null;
  relatedWorkItems?: string;
  testPointId?: string;
  testPoint?: string;
  evidence?: string;
  preconditions: string;
  steps: string[];
  expectedResults?: string[];
  expectedResult: string;
  followers?: string;
  remarks?: string;
};

export type GenerateResponse = {
  source: "ai" | "fallback" | "demo";
  historyId?: string;
  fileName: string;
  summary: string;
  cases: TestCase[];
  warnings: string[];
  coverageBlueprint?: CoverageBlueprint;
  stats?: GenerationStats;
};

export type AgentAnalysisItem = {
  title: string;
  detail: string;
  priority?: TestPriority;
  category?: string;
  evidence?: string;
  suggestion?: string;
};

export type AgentAnalysisSection = {
  title: string;
  description?: string;
  items: AgentAnalysisItem[];
};

export type AgentAnalysisStats = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  provider: "deepseek" | "aliyun" | "openai" | "velotric";
  model: string;
  thinkingMode?: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
  sourceTextLength: number;
};

export type AgentAnalysisResponse = {
  agent: TestAgentAnalysisType;
  source: "ai" | "fallback";
  title: string;
  summary: string;
  sections: AgentAnalysisSection[];
  checklist: string[];
  nextActions: string[];
  warnings: string[];
  stats?: AgentAnalysisStats;
};
