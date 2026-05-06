export type TestCategory = "功能" | "边界" | "异常" | "权限" | "性能";

export type TestPriority = "P0" | "P1" | "P2";

export type TestCase = {
  id: string;
  category: TestCategory;
  title: string;
  priority: TestPriority;
  module: string;
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
};
