import { NextRequest, NextResponse } from "next/server";

import { clearRunHistoryRecords, deleteRunHistoryRecord, listRunHistoryRecords, saveRunHistoryRecord } from "@/lib/server/run-history-db";
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

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    deleteRunHistoryRecord(id);
  } else {
    clearRunHistoryRecords();
  }
  return NextResponse.json({ ok: true });
}
