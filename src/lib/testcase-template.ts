import type { TestCase, TestCaseImportType, TestCategory, TestExecutionType } from "@/types/test-case";
import { getCaseReviewStatus } from "@/lib/case-review";

export const testcaseTemplateSheetName = "test_case";

export const testcaseTemplateHeaders = ["模块", "编号", "标题", "状态", "维护人", "用例类型", "重要程度", "测试类型", "预估工时", "剩余工时", "关联工作项", "前置条件", "步骤描述", "预期结果", "关注人", "备注"] as const;

export const testcaseTemplateInstruction = `请按照下面的规则填写上传数据:
1.模块：填写用例库下已有的模块名称，请从第一级模块开始完整填写（所有用例不属于模块），层级之间用“/”间隔，例如：一级模块/二级模块/三级模块，最多 10 级，不填写自动归入至‘无模块用例’中。
2.编号: 编号样式为：测试库标识-XX，XX代表数字，如“ QLD-3 ”；用例管理下存在该编号时覆盖用例，不存在该编号或不填写编号时新建用例。
3.标题：必填项，不可为空。
4.维护人：填写团队成员的姓名或用户名（目前只有杨思伟一个人），若团队中有重名的成员默认随机选择其中一位成员。
5.用例类型：可选值：功能测试、性能测试、配置相关、安装部署、接口测试、安全相关、兼容性测试、UI测试、其他。
6.重要程度：可选值：P0、P1、P2。
7.测试类型：可选值：手动。
8.预估工时：数值类型，如 10，可为空。
9.剩余工时：数值类型，如 10，可为空。
10.关联工作项：填写关联的需求编号，填写多个值时，请用"|"隔开。
11.前置条件：选填。
12.步骤描述：文本，步骤请加编号填写，如1.xxx、2.xxx；分组填写，子步骤前加“→”，如1.xxx、→1.xxx；每个分组或步骤单元格内换行。
13.预期结果：文本，保持编号与步骤对应，如1.xxx、2.xxx；分组的预期结果不用填写，子预期前加“→”，如1. 空、→1.xxx，每个预期结果单元格内换行。
14.关注人：填写团队成员的姓名或用户名，若团队中有重名的成员默认随机选择其中一位成员，填写多个值时，请用"|"隔开。
15.备注：选填。
16.自定义属性使用系统中创建的属性名，非必填。
17.标签：标签支持多个导入，需要导入系统内存在的标签，并使用“，”隔开。
Tips：
1.单次导入最多支持5000条。
2.“标题”为必填项，必填字段为空时，不予以导入。`;

export const defaultMaintainer = "杨思伟";
export const defaultExecutionType: TestExecutionType = "手动";

export const caseTypeOptions: TestCaseImportType[] = ["功能测试", "性能测试", "配置相关", "安装部署", "接口测试", "安全相关", "兼容性测试", "UI测试", "其他"];

export function caseTypeForCategory(category: TestCategory): TestCaseImportType {
  if (category === "性能") return "性能测试";
  if (category === "权限") return "安全相关";
  return "功能测试";
}

export function normalizeCaseType(value: unknown, category: TestCategory): TestCaseImportType {
  return caseTypeOptions.includes(value as TestCaseImportType) ? (value as TestCaseImportType) : caseTypeForCategory(category);
}

export function normalizeExecutionType(value: unknown): TestExecutionType {
  return value === "手动" ? "手动" : defaultExecutionType;
}

export function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function formatNumberedLines(lines: string[]) {
  return lines.map((line, index) => `${index + 1}.${line.trim()}`).join("\n");
}

export function getExpectedResultLines(item: TestCase) {
  const expectedResults = (item.expectedResults ?? []).map((line) => line.trim()).filter(Boolean);
  return expectedResults.length ? expectedResults : [item.expectedResult].filter(Boolean);
}

export function formatExpectedResultLines(item: TestCase) {
  return formatNumberedLines(getExpectedResultLines(item));
}

export function buildTemplateRemarks(item: TestCase) {
  const parts = [
    item.remarks?.trim(),
    `测试分类：${item.category}`,
    item.testPoint ? `测试点：${item.testPoint}` : "",
    item.evidence ? `PRD依据：${item.evidence}` : "",
  ].filter(Boolean);

  return parts.join("\n");
}

export function normalizeTemplateText(value: string | undefined, fallback = "") {
  const text = value?.trim();
  return text || fallback;
}

export function getTemplateCaseFields(item: TestCase) {
  const maintainer = normalizeTemplateText(item.maintainer, defaultMaintainer);
  return {
    module: normalizeTemplateText(item.module, "无模块用例"),
    id: normalizeTemplateText(item.id),
    title: normalizeTemplateText(item.title, "未命名测试用例"),
    status: getCaseReviewStatus(item),
    maintainer,
    caseType: normalizeCaseType(item.caseType, item.category),
    priority: item.priority,
    executionType: normalizeExecutionType(item.executionType),
    estimatedHours: normalizeNullableNumber(item.estimatedHours),
    remainingHours: normalizeNullableNumber(item.remainingHours),
    relatedWorkItems: normalizeTemplateText(item.relatedWorkItems),
    preconditions: normalizeTemplateText(item.preconditions),
    steps: formatNumberedLines(item.steps.filter(Boolean)),
    expectedResults: formatExpectedResultLines(item),
    followers: normalizeTemplateText(item.followers, maintainer),
    remarks: buildTemplateRemarks(item),
  };
}

export function getTemplateCaseRow(item: TestCase) {
  const fields = getTemplateCaseFields(item);
  return [
    fields.module,
    fields.id,
    fields.title,
    fields.status,
    fields.maintainer,
    fields.caseType,
    fields.priority,
    fields.executionType,
    fields.estimatedHours ?? "",
    fields.remainingHours ?? "",
    fields.relatedWorkItems,
    fields.preconditions,
    fields.steps,
    fields.expectedResults,
    fields.followers,
    fields.remarks,
  ];
}
