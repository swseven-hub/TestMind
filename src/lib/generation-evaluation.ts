export const generationEvaluationBenchmarks = [
  {
    id: "login-only",
    name: "登录单模块 PRD",
    source: "docs/demo-prd-login-only.md",
    focus: ["P0 主链路", "字段边界", "登录态", "异常提示", "证据命中"],
  },
  {
    id: "membership-task-center",
    name: "会员任务中心 PRD",
    source: "docs/demo-prd-membership-task-center.md",
    focus: ["多模块覆盖", "状态迁移", "权限矩阵", "奖励规则", "重复率控制"],
  },
] as const;

export const generationEvaluationMetricLabels = ["覆盖率", "证据命中率", "重复率控制", "可执行性", "预期可验证性", "P0 主链路覆盖", "幻觉风险控制"] as const;

export function formatGenerationEvaluationBasis() {
  return generationEvaluationBenchmarks.map((item) => `${item.name}（${item.source}）`).join("、");
}
