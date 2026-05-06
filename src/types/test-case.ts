export type TestCategory = "功能" | "边界" | "异常" | "权限" | "性能";

export type TestPriority = "P0" | "P1" | "P2";

export type Complexity = "minimal" | "simple" | "medium" | "complex" | "large";

export type RiskLevel = "low" | "medium" | "high" | "critical";

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
  testPointId?: string;
  testPoint?: string;
  evidence?: string;
  preconditions: string;
  steps: string[];
  expectedResult: string;
};

export type GenerateResponse = {
  source: "ai" | "fallback" | "demo";
  fileName: string;
  summary: string;
  cases: TestCase[];
  warnings: string[];
  coverageBlueprint?: CoverageBlueprint;
};
