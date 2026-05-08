import { NextRequest, NextResponse } from "next/server";

import {
  clearRunHistoryRecords,
  deleteRunHistoryRecord,
  deleteRunHistoryRecordsByAgent,
  listRunHistoryRecords,
  saveRunHistoryRecord,
  updateRunHistoryCaseStatuses,
  updateRunHistoryPinned,
} from "@/lib/server/run-history-db";
import { normalizeCaseReviewStatus } from "@/lib/case-review";
import { normalizeProvider, normalizeThinkingMode } from "@/lib/model-config";
import { normalizeTestAgent } from "@/lib/test-agent";
import type { GenerateResponse, RunStatus, TestAgentType, TestCase, TestCategory, TestPriority } from "@/types/test-case";

export const runtime = "nodejs";

type IncomingRecord = {
  id?: string;
  agent?: TestAgentType;
  status?: RunStatus;
  createdAt?: string;
  pinnedAt?: string;
  completedAt?: string;
  provider?: string;
  model?: string;
  thinkingMode?: string;
  failedStage?: string;
  errorMessage?: string;
  errorDetail?: string;
  errorRaw?: string;
  lastEvent?: unknown;
  result?: GenerateResponse;
};

type IncomingCaseStatusUpdate = {
  caseId?: string;
  module?: string;
  status?: string;
  patch?: Partial<TestCase>;
};

const categories: TestCategory[] = ["功能", "边界", "异常", "权限", "性能"];
const priorities: TestPriority[] = ["P0", "P1", "P2"];

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeCasePatch(value: unknown): Partial<TestCase> | undefined {
  const patch = value as Partial<TestCase> | undefined;
  if (!patch || typeof patch !== "object") return undefined;

  const normalized: Partial<TestCase> = {};
  const title = normalizeString(patch.title);
  const moduleName = normalizeString(patch.module);
  const preconditions = normalizeString(patch.preconditions);
  const expectedResult = normalizeString(patch.expectedResult);
  const testPoint = normalizeString(patch.testPoint);
  const evidence = normalizeString(patch.evidence);
  const steps = normalizeStringArray(patch.steps);
  const expectedResults = normalizeStringArray(patch.expectedResults);

  if (title) normalized.title = title;
  if (moduleName) normalized.module = moduleName;
  if (categories.includes(patch.category as TestCategory)) normalized.category = patch.category as TestCategory;
  if (priorities.includes(patch.priority as TestPriority)) normalized.priority = patch.priority as TestPriority;
  normalized.preconditions = preconditions;
  normalized.steps = steps;
  normalized.expectedResult = expectedResult;
  normalized.expectedResults = expectedResults.length ? expectedResults : expectedResult ? [expectedResult] : [];
  normalized.testPoint = testPoint;
  normalized.evidence = evidence;

  return normalized;
}

function normalizeIncomingRecord(record: IncomingRecord) {
  if (!record.result || !Array.isArray(record.result.cases)) return null;
  return {
    id: record.id,
    agent: normalizeTestAgent(record.agent || "case-generator"),
    status: record.status ?? "success",
    createdAt: record.createdAt,
    pinnedAt: record.pinnedAt,
    completedAt: record.completedAt,
    provider: normalizeProvider(record.provider || record.result.stats?.provider || "deepseek"),
    model: record.model || record.result.stats?.model || "unknown",
    thinkingMode: record.thinkingMode ? normalizeThinkingMode(record.thinkingMode) : record.result.stats?.thinkingMode,
    failedStage: record.failedStage,
    errorMessage: record.errorMessage,
    errorDetail: record.errorDetail,
    errorRaw: record.errorRaw,
    lastEvent: record.lastEvent,
    result: record.result,
  };
}

export async function GET() {
  return NextResponse.json({ records: listRunHistoryRecords() });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { records?: IncomingRecord[] } | IncomingRecord | null;
  if (!body) return NextResponse.json({ message: "请求体不是有效 JSON。" }, { status: 400 });

  const incomingRecords = Array.isArray((body as { records?: IncomingRecord[] }).records) ? (body as { records: IncomingRecord[] }).records : [body as IncomingRecord];
  const saved = incomingRecords
    .map(normalizeIncomingRecord)
    .filter((record): record is NonNullable<ReturnType<typeof normalizeIncomingRecord>> => Boolean(record))
    .map(saveRunHistoryRecord);

  return NextResponse.json({ records: saved });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { id?: string; caseUpdates?: IncomingCaseStatusUpdate[]; pinned?: boolean } | null;
  if (!body?.id) return NextResponse.json({ message: "缺少运行记录 ID。" }, { status: 400 });
  if (typeof body.pinned === "boolean") {
    const record = updateRunHistoryPinned(body.id, body.pinned);
    if (!record) return NextResponse.json({ message: "未找到对应运行记录。" }, { status: 404 });
    return NextResponse.json({ record });
  }
  if (!Array.isArray(body.caseUpdates) || !body.caseUpdates.length) {
    return NextResponse.json({ message: "缺少要更新的用例状态。" }, { status: 400 });
  }

  const caseUpdates = body.caseUpdates
    .filter((item) => item.caseId && item.module)
    .map((item) => ({
      caseId: item.caseId as string,
      module: item.module as string,
      ...(item.status === undefined ? {} : { status: normalizeCaseReviewStatus(item.status) }),
      patch: normalizeCasePatch(item.patch),
    }));

  if (!caseUpdates.length) return NextResponse.json({ message: "用例状态更新内容无效。" }, { status: 400 });

  const record = updateRunHistoryCaseStatuses(body.id, caseUpdates);
  if (!record) return NextResponse.json({ message: "未找到对应运行记录。" }, { status: 404 });

  return NextResponse.json({ record });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const agent = request.nextUrl.searchParams.get("agent");
  if (id) {
    deleteRunHistoryRecord(id);
  } else if (agent) {
    deleteRunHistoryRecordsByAgent(normalizeTestAgent(agent));
  } else {
    clearRunHistoryRecords();
  }
  return NextResponse.json({ ok: true });
}
