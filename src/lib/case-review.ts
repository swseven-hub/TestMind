import type { GenerateResponse, TestCase, TestCategory } from "@/types/test-case";

export const testCategories: TestCategory[] = ["功能", "边界", "异常", "权限", "性能"];

export const caseReviewStatuses = ["待确认", "已采纳", "需修改", "已废弃"] as const;

export type CaseReviewStatus = (typeof caseReviewStatuses)[number];

export type CoverageReviewSeverity = "high" | "medium" | "info";

export type CoverageReviewIssue = {
  id: string;
  severity: CoverageReviewSeverity;
  title: string;
  detail: string;
  moduleName?: string;
  category?: TestCategory;
};

const severityRank: Record<CoverageReviewSeverity, number> = {
  high: 0,
  medium: 1,
  info: 2,
};

export function normalizeCaseReviewStatus(value: unknown): CaseReviewStatus {
  return caseReviewStatuses.includes(value as CaseReviewStatus) ? (value as CaseReviewStatus) : "待确认";
}

export function getCaseReviewStatus(item: TestCase): CaseReviewStatus {
  return normalizeCaseReviewStatus(item.status);
}

export function getCaseIdentity(item: Pick<TestCase, "id" | "module">) {
  return `${item.module}::${item.id}`;
}

function countByCategory(cases: TestCase[]) {
  const counts = Object.fromEntries(testCategories.map((category) => [category, 0])) as Record<TestCategory, number>;
  for (const item of cases) counts[item.category] += 1;
  return counts;
}

function matchesTestPoint(item: TestCase, testPointId: string, testPointName: string) {
  return item.testPointId === testPointId || item.testPoint?.includes(testPointName) || item.title.includes(testPointName);
}

function pushIssue(issues: CoverageReviewIssue[], issue: CoverageReviewIssue) {
  if (!issues.some((item) => item.id === issue.id)) issues.push(issue);
}

export function buildCoverageReview(result: GenerateResponse | null | undefined): CoverageReviewIssue[] {
  if (!result) return [];

  const cases = result.cases ?? [];
  const issues: CoverageReviewIssue[] = [];
  if (!cases.length) {
    return [
      {
        id: "empty-cases",
        severity: "high",
        title: "没有可审查的测试用例",
        detail: "本次运行没有保存到测试用例，无法判断模块、测试类型和测试点覆盖情况。",
      },
    ];
  }

  const blueprint = result.coverageBlueprint;
  const overallCounts = countByCategory(cases);
  for (const category of testCategories) {
    if (!overallCounts[category]) {
      pushIssue(issues, {
        id: `overall-missing-${category}`,
        severity: category === "功能" ? "high" : "medium",
        title: `整体缺少${category}类用例`,
        detail: `当前结果中没有${category}类用例，交付前建议确认该类型是否确实不适用。`,
        category,
      });
    }
  }

  if (!blueprint) {
    const moduleNames = [...new Set(cases.map((item) => item.module))];
    for (const moduleName of moduleNames) {
      const moduleCases = cases.filter((item) => item.module === moduleName);
      const moduleCounts = countByCategory(moduleCases);
      if (moduleCases.length >= 10 && !moduleCounts.异常) {
        pushIssue(issues, {
          id: `fallback-${moduleName}-missing-exception`,
          severity: "medium",
          title: "异常场景覆盖偏少",
          detail: `${moduleName} 已有 ${moduleCases.length} 条用例，但没有异常类用例，建议补充失败路径、非法输入或前置条件不满足场景。`,
          moduleName,
          category: "异常",
        });
      }
      if (moduleCases.length >= 10 && !moduleCounts.权限) {
        pushIssue(issues, {
          id: `fallback-${moduleName}-missing-permission`,
          severity: "info",
          title: "权限覆盖可补充",
          detail: `${moduleName} 暂无权限类用例，如果该模块存在登录态、角色或设备绑定限制，建议补充权限校验。`,
          moduleName,
          category: "权限",
        });
      }
    }
    return issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }

  if (blueprint.plannedCaseCount && cases.length < Math.ceil(blueprint.plannedCaseCount * 0.85)) {
    pushIssue(issues, {
      id: "planned-case-gap",
      severity: "medium",
      title: "实际用例数低于蓝图计划",
      detail: `覆盖蓝图计划约 ${blueprint.plannedCaseCount} 条，实际生成 ${cases.length} 条，建议检查是否有模块生成失败或合并去重过多。`,
    });
  }

  for (const blueprintModule of blueprint.modules) {
    const moduleCases = cases.filter((item) => item.module === blueprintModule.name);
    if (!moduleCases.length) {
      pushIssue(issues, {
        id: `module-${blueprintModule.name}-empty`,
        severity: "high",
        title: "蓝图模块没有生成用例",
        detail: `${blueprintModule.name} 在覆盖蓝图中存在，但最终结果里没有对应测试用例。`,
        moduleName: blueprintModule.name,
      });
      continue;
    }

    const moduleCounts = countByCategory(moduleCases);
    for (const category of testCategories) {
      const target = blueprintModule.categoryTargets[category] ?? 0;
      const actual = moduleCounts[category];
      if (target > 0 && actual === 0) {
        pushIssue(issues, {
          id: `module-${blueprintModule.name}-missing-${category}`,
          severity: blueprintModule.isCore || target >= 3 ? "high" : "medium",
          title: `${category}类覆盖缺失`,
          detail: `${blueprintModule.name} 蓝图计划 ${target} 条${category}类用例，但最终没有生成对应用例。`,
          moduleName: blueprintModule.name,
          category,
        });
      } else if (target >= 4 && actual < Math.ceil(target * 0.5)) {
        pushIssue(issues, {
          id: `module-${blueprintModule.name}-thin-${category}`,
          severity: "medium",
          title: `${category}类覆盖偏少`,
          detail: `${blueprintModule.name} 蓝图计划 ${target} 条${category}类用例，当前只有 ${actual} 条，建议补充关键路径。`,
          moduleName: blueprintModule.name,
          category,
        });
      }
    }

    if ((blueprintModule.riskLevel === "high" || blueprintModule.riskLevel === "critical") && !moduleCounts.异常) {
      pushIssue(issues, {
        id: `module-${blueprintModule.name}-risk-no-exception`,
        severity: "medium",
        title: "高风险模块缺少异常路径",
        detail: `${blueprintModule.name} 风险等级为 ${blueprintModule.riskLevel}，但没有异常类用例，建议补充失败、超时、非法状态或依赖不可用场景。`,
        moduleName: blueprintModule.name,
        category: "异常",
      });
    }

    for (const testPoint of blueprintModule.testPoints) {
      if (testPoint.expectedCaseCount < 2) continue;
      const actual = moduleCases.filter((item) => matchesTestPoint(item, testPoint.id, testPoint.name)).length;
      if (actual === 0) {
        pushIssue(issues, {
          id: `testpoint-${blueprintModule.name}-${testPoint.id}-empty`,
          severity: testPoint.riskLevel === "high" || testPoint.riskLevel === "critical" ? "high" : "medium",
          title: "测试点没有对应用例",
          detail: `${blueprintModule.name} 的“${testPoint.name}”计划约 ${testPoint.expectedCaseCount} 条，但未匹配到对应用例。`,
          moduleName: blueprintModule.name,
        });
      } else if (testPoint.expectedCaseCount >= 4 && actual < Math.ceil(testPoint.expectedCaseCount * 0.5)) {
        pushIssue(issues, {
          id: `testpoint-${blueprintModule.name}-${testPoint.id}-thin`,
          severity: "medium",
          title: "测试点覆盖偏少",
          detail: `${blueprintModule.name} 的“${testPoint.name}”计划约 ${testPoint.expectedCaseCount} 条，当前匹配 ${actual} 条。`,
          moduleName: blueprintModule.name,
        });
      }
    }

    for (const note of blueprintModule.coverageNotes.slice(0, 2)) {
      pushIssue(issues, {
        id: `module-${blueprintModule.name}-note-${note}`,
        severity: "info",
        title: "蓝图覆盖备注",
        detail: `${blueprintModule.name}：${note}`,
        moduleName: blueprintModule.name,
      });
    }
  }

  return issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}
