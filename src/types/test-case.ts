export type TestCategory = "功能" | "边界" | "异常" | "权限" | "性能";

export type TestPriority = "P0" | "P1" | "P2";

export type TestCaseImportType = "功能测试" | "性能测试" | "配置相关" | "安装部署" | "接口测试" | "安全相关" | "兼容性测试" | "UI测试" | "其他";

export type TestExecutionType = "手动";

export type Complexity = "minimal" | "simple" | "medium" | "complex" | "large";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ThinkingMode = "fast" | "quality";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type RunStatus = "running" | "success" | "failed" | "cancelled";

export type TestAgentType = "requirement-review" | "case-generator" | "release-risk" | "change-impact" | "debug-assistant";

export type TestAgentAnalysisType = Exclude<TestAgentType, "case-generator">;

export type TestGenerationProfile = "smoke" | "standard" | "high-coverage" | "regression" | "api-first" | "permission-first" | "release-risk";

export type TestDesignTechnique =
  | "等价类"
  | "边界值"
  | "判定表"
  | "状态迁移"
  | "流程分支"
  | "权限矩阵"
  | "组合覆盖"
  | "接口契约"
  | "幂等"
  | "并发"
  | "回滚";

export type QualityFindingSeverity = "info" | "medium" | "high";

export type QualityFinding = {
  severity: QualityFindingSeverity;
  issueType: string;
  caseId?: string;
  title?: string;
  detail: string;
  suggestion: string;
};

export type GenerationEvaluationMetric = {
  id: string;
  label: string;
  score: number;
  detail: string;
};

export type GenerationQualityReport = {
  score: number;
  summary: string;
  revisedCaseCount: number;
  findingCount: number;
  findings: QualityFinding[];
  metrics?: GenerationEvaluationMetric[];
  semanticDuplicateCount?: number;
  uncertaintyCount?: number;
};

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

export type TestDataRequirement = {
  id: string;
  name: string;
  scope: string;
  values: string[];
  setup: string;
  cleanup: string;
  owner?: string;
};

export type TestEnvironmentRequirement = {
  id: string;
  name: string;
  type: "账号" | "角色" | "配置" | "状态" | "依赖服务" | "第三方" | "数据" | "其他";
  description: string;
  dependencies: string[];
  setup: string;
  cleanup: string;
};

export type RequirementUncertainty = {
  id: string;
  type: "无法确定的规则" | "需要产品确认的问题" | "基于假设生成";
  title: string;
  detail: string;
  impact: string;
  question?: string;
  relatedRequirementId?: string;
};

export type CoverageTestPoint = {
  id: string;
  name: string;
  evidence: string;
  requirementId?: string;
  requirementSection?: string;
  sourceQuote?: string;
  fields: string[];
  states: string[];
  roles: string[];
  flows: string[];
  rules: string[];
  designTechniques?: TestDesignTechnique[];
  riskLevel: RiskLevel;
  riskFactors: string[];
  coverage: CategoryTargetMap;
  expectedCaseCount: number;
  locked?: boolean;
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
  testData?: TestDataRequirement[];
  environment?: TestEnvironmentRequirement[];
  uncertainties?: RequirementUncertainty[];
  designTechniques?: TestDesignTechnique[];
  categoryTargets: CategoryTargetMap;
  skippedCategories: string[];
  coverageNotes: string[];
  targetCaseCount: number;
  locked?: boolean;
};

export type CoverageBlueprint = {
  generationProfile?: TestGenerationProfile;
  documentComplexity: Complexity;
  coverageRationale: string;
  modules: CoverageModule[];
  plannedCaseCount: number;
  uncertainties?: RequirementUncertainty[];
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
  requirementId?: string;
  requirementSection?: string;
  sourceQuote?: string;
  testPointId?: string;
  testPoint?: string;
  evidence?: string;
  fieldsCovered?: string[];
  statesCovered?: string[];
  rulesCovered?: string[];
  riskTags?: string[];
  designTechniques?: TestDesignTechnique[];
  testDataRefs?: string[];
  environmentRefs?: string[];
  assumptions?: string[];
  uncertaintyRefs?: string[];
  requiresConfirmation?: boolean;
  preconditions: string;
  steps: string[];
  expectedResults?: string[];
  expectedResult: string;
  followers?: string;
  remarks?: string;
  qualityFindings?: QualityFinding[];
};

export type GenerateResponse = {
  source: "ai" | "fallback" | "demo";
  historyId?: string;
  fileName: string;
  summary: string;
  cases: TestCase[];
  warnings: string[];
  coverageBlueprint?: CoverageBlueprint;
  qualityReport?: GenerationQualityReport;
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
  historyId?: string;
  title: string;
  summary: string;
  sections: AgentAnalysisSection[];
  checklist: string[];
  nextActions: string[];
  warnings: string[];
  stats?: AgentAnalysisStats;
};
