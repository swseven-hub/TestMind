import type { TestCategory, TestGenerationProfile } from "@/types/test-case";

export const generationProfiles: TestGenerationProfile[] = ["smoke", "standard", "high-coverage", "regression", "api-first", "permission-first", "release-risk"];

export type GenerationProfileConfig = {
  label: string;
  shortLabel: string;
  description: string;
  promptGuidance: string;
  caseMultiplier: number;
  maxPlannedCases: number;
  minCoreCases: number;
  categoryWeights: Partial<Record<TestCategory, number>>;
};

export const generationProfileConfigs: Record<TestGenerationProfile, GenerationProfileConfig> = {
  smoke: {
    label: "冒烟",
    shortLabel: "冒烟",
    description: "只保留核心正向链路、阻断级风险和最小回归入口。",
    promptGuidance: "生成冒烟策略：只覆盖 P0 主链路、核心入口、关键失败路径和上线阻断风险；不要铺开低风险边界和长尾组合。",
    caseMultiplier: 0.42,
    maxPlannedCases: 36,
    minCoreCases: 3,
    categoryWeights: { 功能: 1.1, 异常: 0.8, 权限: 0.8, 边界: 0.35, 性能: 0.25 },
  },
  standard: {
    label: "标准",
    shortLabel: "标准",
    description: "覆盖主路径、关键逆向、核心边界和适用权限/性能。",
    promptGuidance: "生成标准验收策略：覆盖核心主路径、主要失败路径、关键边界、适用权限和明确性能要求，数量保持可执行。",
    caseMultiplier: 1,
    maxPlannedCases: 96,
    minCoreCases: 6,
    categoryWeights: { 功能: 1, 边界: 1, 异常: 1, 权限: 1, 性能: 1 },
  },
  "high-coverage": {
    label: "高覆盖",
    shortLabel: "高覆盖",
    description: "展开字段、状态、规则组合和异常分支，适合完整验收。",
    promptGuidance: "生成高覆盖验收策略：系统展开字段边界、状态迁移、判定表、组合覆盖、接口契约、异常恢复、权限矩阵和数据一致性，允许明显增加用例数。",
    caseMultiplier: 2.05,
    maxPlannedCases: 180,
    minCoreCases: 12,
    categoryWeights: { 功能: 1.35, 边界: 1.75, 异常: 1.65, 权限: 1.35, 性能: 1.15 },
  },
  regression: {
    label: "回归",
    shortLabel: "回归",
    description: "强调历史稳定性、状态回归、配置差异和核心路径。",
    promptGuidance: "生成回归策略：优先覆盖核心路径、状态迁移、配置开关、数据兼容、幂等、回滚和容易被变更影响的风险点。",
    caseMultiplier: 0.95,
    maxPlannedCases: 80,
    minCoreCases: 6,
    categoryWeights: { 功能: 1.05, 边界: 0.9, 异常: 1.15, 权限: 1, 性能: 0.65 },
  },
  "api-first": {
    label: "接口优先",
    shortLabel: "接口",
    description: "优先覆盖接口契约、参数、状态码、幂等和依赖失败。",
    promptGuidance: "生成接口优先策略：优先覆盖接口契约、请求参数、响应字段、状态码、错误码、鉴权、幂等、回调、第三方依赖和超时重试。",
    caseMultiplier: 1.15,
    maxPlannedCases: 120,
    minCoreCases: 7,
    categoryWeights: { 功能: 1, 边界: 1.35, 异常: 1.45, 权限: 1.2, 性能: 0.85 },
  },
  "permission-first": {
    label: "权限优先",
    shortLabel: "权限",
    description: "优先覆盖登录态、角色矩阵、越权、数据隔离和敏感数据。",
    promptGuidance: "生成权限优先策略：优先覆盖登录态、角色矩阵、会员/组织/设备边界、越权、数据隔离、敏感数据脱敏和审计。",
    caseMultiplier: 1.12,
    maxPlannedCases: 120,
    minCoreCases: 7,
    categoryWeights: { 功能: 0.95, 边界: 0.9, 异常: 1.05, 权限: 1.9, 性能: 0.55 },
  },
  "release-risk": {
    label: "上线风险优先",
    shortLabel: "上线",
    description: "保留上线前最该测的高风险链路、回滚和监控检查。",
    promptGuidance: "生成上线风险优先策略：聚焦上线阻断风险、P0/P1 主链路、资金/资产/隐私/权限/数据一致性、回滚补偿、监控告警和冒烟清单。",
    caseMultiplier: 0.78,
    maxPlannedCases: 72,
    minCoreCases: 5,
    categoryWeights: { 功能: 1.05, 边界: 0.65, 异常: 1.25, 权限: 1.15, 性能: 0.8 },
  },
};

export function normalizeGenerationProfile(value: unknown): TestGenerationProfile {
  return generationProfiles.includes(value as TestGenerationProfile) ? (value as TestGenerationProfile) : "standard";
}
