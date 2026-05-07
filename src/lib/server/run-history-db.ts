import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { GenerateResponse, GenerationUsage, RunStatus, TestCase, ThinkingMode } from "@/types/test-case";
import type { Provider } from "@/lib/model-config";
import type { CaseReviewStatus } from "@/lib/case-review";

export type StoredRunHistoryRecord = {
  id: string;
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
  fileName: string;
  provider: Provider;
  model: string;
  thinkingMode?: ThinkingMode;
  caseCount: number;
  moduleCount: number;
  durationMs?: number;
  usage?: GenerationUsage;
  failedStage?: string;
  errorMessage?: string;
  errorDetail?: string;
  errorRaw?: string;
  lastEvent?: unknown;
  result: GenerateResponse;
};

type RunHistoryRow = {
  id: string;
  status: RunStatus | null;
  created_at: string;
  completed_at: string | null;
  file_name: string;
  provider: Provider;
  model: string;
  thinking_mode: ThinkingMode | null;
  case_count: number;
  module_count: number;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  reasoning_tokens: number | null;
  failed_stage: string | null;
  error_message: string | null;
  error_detail: string | null;
  error_raw: string | null;
  last_event_json: string | null;
  result_json: string;
};

let database: DatabaseSync | null = null;

function getDatabase() {
  if (database) return database;

  const dataDir = path.join(process.cwd(), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  database = new DatabaseSync(path.join(dataDir, "testmind.sqlite"));
  database.exec(`
    CREATE TABLE IF NOT EXISTS run_history (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'success',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      file_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      thinking_mode TEXT,
      case_count INTEGER NOT NULL,
      module_count INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      reasoning_tokens INTEGER,
      failed_stage TEXT,
      error_message TEXT,
      error_detail TEXT,
      error_raw TEXT,
      last_event_json TEXT,
      result_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_run_history_created_at ON run_history(created_at DESC);
  `);
  migrateRunHistoryTable(database);
  return database;
}

function migrateRunHistoryTable(db: DatabaseSync) {
  const columns = new Set((db.prepare("PRAGMA table_info(run_history)").all() as Array<{ name: string }>).map((item) => item.name));
  const additions: Array<[string, string]> = [
    ["status", "ALTER TABLE run_history ADD COLUMN status TEXT NOT NULL DEFAULT 'success'"],
    ["completed_at", "ALTER TABLE run_history ADD COLUMN completed_at TEXT"],
    ["failed_stage", "ALTER TABLE run_history ADD COLUMN failed_stage TEXT"],
    ["error_message", "ALTER TABLE run_history ADD COLUMN error_message TEXT"],
    ["error_detail", "ALTER TABLE run_history ADD COLUMN error_detail TEXT"],
    ["error_raw", "ALTER TABLE run_history ADD COLUMN error_raw TEXT"],
    ["last_event_json", "ALTER TABLE run_history ADD COLUMN last_event_json TEXT"],
  ];

  for (const [name, statement] of additions) {
    if (!columns.has(name)) db.exec(statement);
  }
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getModuleCount(result: GenerateResponse) {
  return new Set(result.cases.map((item) => item.module)).size;
}

function rowToRecord(row: RunHistoryRow): StoredRunHistoryRecord | null {
  try {
    const result = JSON.parse(row.result_json) as GenerateResponse;
    const lastEvent = row.last_event_json ? JSON.parse(row.last_event_json) : undefined;
    const usage =
      row.total_tokens === null
        ? undefined
        : {
            promptTokens: row.prompt_tokens ?? 0,
            completionTokens: row.completion_tokens ?? 0,
            totalTokens: row.total_tokens ?? 0,
            ...(row.reasoning_tokens === null ? {} : { reasoningTokens: row.reasoning_tokens }),
          };

    return {
      id: row.id,
      status: row.status ?? "success",
      createdAt: row.created_at,
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
      fileName: row.file_name,
      provider: row.provider,
      model: row.model,
      ...(row.thinking_mode ? { thinkingMode: row.thinking_mode } : {}),
      caseCount: row.case_count,
      moduleCount: row.module_count,
      ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
      ...(usage ? { usage } : {}),
      ...(row.failed_stage ? { failedStage: row.failed_stage } : {}),
      ...(row.error_message ? { errorMessage: row.error_message } : {}),
      ...(row.error_detail ? { errorDetail: row.error_detail } : {}),
      ...(row.error_raw ? { errorRaw: row.error_raw } : {}),
      ...(lastEvent ? { lastEvent } : {}),
      result,
    };
  } catch {
    return null;
  }
}

export function listRunHistoryRecords() {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM run_history ORDER BY created_at DESC").all() as RunHistoryRow[];
  return rows.map(rowToRecord).filter((item): item is StoredRunHistoryRecord => Boolean(item));
}

export function saveRunHistoryRecord(input: {
  id?: string;
  createdAt?: string;
  completedAt?: string;
  status?: RunStatus;
  provider: Provider;
  model: string;
  thinkingMode?: ThinkingMode;
  failedStage?: string;
  errorMessage?: string;
  errorDetail?: string;
  errorRaw?: string;
  lastEvent?: unknown;
  result: GenerateResponse;
}) {
  const db = getDatabase();
  const id = input.id || createId();
  const createdAt = input.createdAt || input.result.stats?.startedAt || input.result.stats?.completedAt || new Date().toISOString();
  const completedAt = input.completedAt || input.result.stats?.completedAt;
  const usage = input.result.stats?.usage;
  const moduleCount = input.result.stats?.moduleCount ?? getModuleCount(input.result);

  db.prepare(`
    INSERT OR REPLACE INTO run_history (
      id,
      status,
      created_at,
      completed_at,
      file_name,
      provider,
      model,
      thinking_mode,
      case_count,
      module_count,
      duration_ms,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      reasoning_tokens,
      failed_stage,
      error_message,
      error_detail,
      error_raw,
      last_event_json,
      result_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.status ?? "success",
    createdAt,
    completedAt ?? null,
    input.result.fileName,
    input.provider,
    input.model,
    input.thinkingMode ?? input.result.stats?.thinkingMode ?? null,
    input.result.cases.length,
    moduleCount,
    input.result.stats?.durationMs ?? null,
    usage?.promptTokens ?? null,
    usage?.completionTokens ?? null,
    usage?.totalTokens ?? null,
    usage?.reasoningTokens ?? null,
    input.failedStage ?? null,
    input.errorMessage ?? null,
    input.errorDetail ?? null,
    input.errorRaw ?? null,
    input.lastEvent ? JSON.stringify(input.lastEvent) : null,
    JSON.stringify(input.result),
  );

  return {
    id,
    status: input.status ?? "success",
    createdAt,
    ...(completedAt ? { completedAt } : {}),
    fileName: input.result.fileName,
    provider: input.provider,
    model: input.model,
    thinkingMode: input.thinkingMode ?? input.result.stats?.thinkingMode,
    caseCount: input.result.cases.length,
    moduleCount,
    durationMs: input.result.stats?.durationMs,
    usage,
    ...(input.failedStage ? { failedStage: input.failedStage } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.errorDetail ? { errorDetail: input.errorDetail } : {}),
    ...(input.errorRaw ? { errorRaw: input.errorRaw } : {}),
    ...(input.lastEvent ? { lastEvent: input.lastEvent } : {}),
    result: input.result,
  } satisfies StoredRunHistoryRecord;
}

export function updateRunHistoryCaseStatuses(
  id: string,
  updates: Array<{
    caseId: string;
    module: string;
    status?: CaseReviewStatus;
    patch?: Partial<TestCase>;
  }>,
) {
  if (!updates.length) return null;

  const db = getDatabase();
  const row = db.prepare("SELECT * FROM run_history WHERE id = ?").get(id) as RunHistoryRow | undefined;
  if (!row) return null;

  const result = JSON.parse(row.result_json) as GenerateResponse;
  let updatedCount = 0;

  for (const update of updates) {
    const item = result.cases.find((candidate) => candidate.id === update.caseId && candidate.module === update.module);
    if (!item) continue;
    if (update.patch) Object.assign(item, update.patch);
    if (update.status) item.status = update.status;
    updatedCount += 1;
  }

  if (!updatedCount) return rowToRecord(row);

  db.prepare("UPDATE run_history SET result_json = ? WHERE id = ?").run(JSON.stringify(result), id);

  return rowToRecord({
    ...row,
    result_json: JSON.stringify(result),
  });
}

export function deleteRunHistoryRecord(id: string) {
  const db = getDatabase();
  db.prepare("DELETE FROM run_history WHERE id = ?").run(id);
}

export function clearRunHistoryRecords() {
  const db = getDatabase();
  db.prepare("DELETE FROM run_history").run();
}
