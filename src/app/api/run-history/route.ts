import { NextRequest, NextResponse } from "next/server";

import { clearRunHistoryRecords, deleteRunHistoryRecord, listRunHistoryRecords, saveRunHistoryRecord, updateRunHistoryCaseStatuses } from "@/lib/server/run-history-db";
import { normalizeCaseReviewStatus } from "@/lib/case-review";
import { normalizeProvider, normalizeThinkingMode } from "@/lib/model-config";
import type { GenerateResponse, RunStatus } from "@/types/test-case";

export const runtime = "nodejs";

type IncomingRecord = {
  id?: string;
  status?: RunStatus;
  createdAt?: string;
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
};

function normalizeIncomingRecord(record: IncomingRecord) {
  if (!record.result || !Array.isArray(record.result.cases)) return null;
  return {
    id: record.id,
    status: record.status ?? "success",
    createdAt: record.createdAt,
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
  const body = (await request.json().catch(() => null)) as { id?: string; caseUpdates?: IncomingCaseStatusUpdate[] } | null;
  if (!body?.id) return NextResponse.json({ message: "缺少运行记录 ID。" }, { status: 400 });
  if (!Array.isArray(body.caseUpdates) || !body.caseUpdates.length) {
    return NextResponse.json({ message: "缺少要更新的用例状态。" }, { status: 400 });
  }

  const caseUpdates = body.caseUpdates
    .filter((item) => item.caseId && item.module)
    .map((item) => ({
      caseId: item.caseId as string,
      module: item.module as string,
      status: normalizeCaseReviewStatus(item.status),
    }));

  if (!caseUpdates.length) return NextResponse.json({ message: "用例状态更新内容无效。" }, { status: 400 });

  const record = updateRunHistoryCaseStatuses(body.id, caseUpdates);
  if (!record) return NextResponse.json({ message: "未找到对应运行记录。" }, { status: 404 });

  return NextResponse.json({ record });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    deleteRunHistoryRecord(id);
  } else {
    clearRunHistoryRecords();
  }
  return NextResponse.json({ ok: true });
}
