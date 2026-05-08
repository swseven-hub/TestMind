import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type {
  AgentAnalysisResponse,
  GenerateResponse,
  GenerationUsage,
  RunStatus,
  TestAgentAnalysisType,
  TestAgentType,
  TestCase,
  ThinkingMode,
} from "@/types/test-case";
import type { Provider } from "@/lib/model-config";
import type { CaseReviewStatus } from "@/lib/case-review";

type SqliteStatement = {
  all: (...values: unknown[]) => unknown[];
  get: (...values: unknown[]) => unknown;
  run: (...values: unknown[]) => { changes?: number };
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
};

const nodeRequire = createRequire(import.meta.url);
const sqliteModuleName = "node" + ":sqlite";
const { DatabaseSync } = Reflect.apply(nodeRequire, null, [sqliteModuleName]) as {
  DatabaseSync: new (filename: string) => SqliteDatabase;
};

type StoredRunHistoryBase = {
  id: string;
  agent: TestAgentType;
  status: RunStatus;
  createdAt: string;
  pinnedAt?: string;
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
};

export type StoredCaseRunHistoryRecord = StoredRunHistoryBase & {
  agent: "case-generator";
  result: GenerateResponse;
};

export type StoredAnalysisRunHistoryRecord = StoredRunHistoryBase & {
  agent: TestAgentAnalysisType;
  analysisResult: AgentAnalysisResponse;
};

export type StoredRunHistoryRecord = StoredCaseRunHistoryRecord | StoredAnalysisRunHistoryRecord;

type RunHistoryRow = {
  id: string;
  agent: TestAgentType | null;
  status: RunStatus | null;
  created_at: string;
  pinned_at: string | null;
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

let database: SqliteDatabase | null = null;

function getDatabase() {
  if (database) return database;

  const dataDir = path.join(process.cwd(), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  database = new DatabaseSync(path.join(dataDir, "testmind.sqlite"));
  database.exec(`
    CREATE TABLE IF NOT EXISTS run_history (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL DEFAULT 'case-generator',
      status TEXT NOT NULL DEFAULT 'success',
      created_at TEXT NOT NULL,
      pinned_at TEXT,
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

function migrateRunHistoryTable(db: SqliteDatabase) {
  const columns = new Set((db.prepare("PRAGMA table_info(run_history)").all() as Array<{ name: string }>).map((item) => item.name));
  const additions: Array<[string, string]> = [
    ["agent", "ALTER TABLE run_history ADD COLUMN agent TEXT NOT NULL DEFAULT 'case-generator'"],
    ["status", "ALTER TABLE run_history ADD COLUMN status TEXT NOT NULL DEFAULT 'success'"],
    ["pinned_at", "ALTER TABLE run_history ADD COLUMN pinned_at TEXT"],
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
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_run_history_agent_created_at ON run_history(agent, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_history_pinned_created_at ON run_history(pinned_at DESC, created_at DESC);
  `);
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeHistoryAgent(value: unknown): TestAgentType {
  if (value === "requirement-review" || value === "release-risk" || value === "case-generator" || value === "change-impact" || value === "debug-assistant") return value;
  return "case-generator";
}

function isGenerateResponse(value: unknown): value is GenerateResponse {
  const result = value as GenerateResponse;
  return Boolean(result?.fileName && Array.isArray(result.cases));
}

function isAgentAnalysisResponse(value: unknown): value is AgentAnalysisResponse {
  const result = value as AgentAnalysisResponse;
  return Boolean(result?.agent && Array.isArray(result.sections));
}

function getPayloadItemCount(result: GenerateResponse | AgentAnalysisResponse) {
  if (isGenerateResponse(result)) return result.cases.length;
  return result.sections.reduce((sum, section) => sum + section.items.length, 0);
}

function getModuleCount(result: GenerateResponse | AgentAnalysisResponse) {
  if (isGenerateResponse(result)) return new Set(result.cases.map((item) => item.module)).size;
  return result.sections.length;
}

function getPayloadFileName(agent: TestAgentType, result: GenerateResponse | AgentAnalysisResponse, fileName?: string) {
  if (fileName?.trim()) return fileName.trim();
  if (isGenerateResponse(result)) return result.fileName;
  if (agent === "requirement-review") return "需求分析结果";
  if (agent === "change-impact") return "变更影响分析";
  if (agent === "debug-assistant") return "Bug 根因分析";
  return "发布风险分析";
}

function rowToRecord(row: RunHistoryRow): StoredRunHistoryRecord | null {
  try {
    const payload = JSON.parse(row.result_json) as GenerateResponse | AgentAnalysisResponse;
    let agent = normalizeHistoryAgent(row.agent);
    if (agent === "case-generator" && isAgentAnalysisResponse(payload)) agent = payload.agent;
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

    const common = {
      id: row.id,
      agent,
      status: row.status ?? "success",
      createdAt: row.created_at,
      ...(row.pinned_at ? { pinnedAt: row.pinned_at } : {}),
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
    };

    if (agent === "case-generator") {
      if (!isGenerateResponse(payload)) return null;
      return {
        ...common,
        agent,
        result: payload,
      };
    }

    if (!isAgentAnalysisResponse(payload)) return null;
    return {
      ...common,
      agent,
      analysisResult: payload,
    };
  } catch {
    return null;
  }
}

export function listRunHistoryRecords() {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM run_history ORDER BY pinned_at IS NULL, pinned_at DESC, created_at DESC").all() as RunHistoryRow[];
  return rows.map(rowToRecord).filter((item): item is StoredRunHistoryRecord => Boolean(item));
}

export function saveRunHistoryRecord(input: {
  id?: string;
  agent?: TestAgentType;
  fileName?: string;
  createdAt?: string;
  pinnedAt?: string;
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
  result: GenerateResponse | AgentAnalysisResponse;
}) {
  const db = getDatabase();
  const id = input.id || createId();
  let agent = normalizeHistoryAgent(input.agent);
  if (agent === "case-generator" && isAgentAnalysisResponse(input.result)) agent = input.result.agent;
  const createdAt = input.createdAt || input.result.stats?.startedAt || input.result.stats?.completedAt || new Date().toISOString();
  const pinnedAt = input.pinnedAt || null;
  const completedAt = input.completedAt || input.result.stats?.completedAt;
  const usage = isGenerateResponse(input.result) ? input.result.stats?.usage : undefined;
  const moduleCount = isGenerateResponse(input.result) ? input.result.stats?.moduleCount ?? getModuleCount(input.result) : getModuleCount(input.result);
  const caseCount = getPayloadItemCount(input.result);
  const fileName = getPayloadFileName(agent, input.result, input.fileName);

  db.prepare(`
    INSERT OR REPLACE INTO run_history (
      id,
      agent,
      status,
      created_at,
      pinned_at,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    agent,
    input.status ?? "success",
    createdAt,
    pinnedAt,
    completedAt ?? null,
    fileName,
    input.provider,
    input.model,
    input.thinkingMode ?? input.result.stats?.thinkingMode ?? null,
    caseCount,
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

  const common = {
    id,
    agent,
    status: input.status ?? "success",
    createdAt,
    ...(pinnedAt ? { pinnedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    fileName,
    provider: input.provider,
    model: input.model,
    thinkingMode: input.thinkingMode ?? input.result.stats?.thinkingMode,
    caseCount,
    moduleCount,
    durationMs: input.result.stats?.durationMs,
    usage,
    ...(input.failedStage ? { failedStage: input.failedStage } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.errorDetail ? { errorDetail: input.errorDetail } : {}),
    ...(input.errorRaw ? { errorRaw: input.errorRaw } : {}),
    ...(input.lastEvent ? { lastEvent: input.lastEvent } : {}),
  };

  if (agent === "case-generator" && isGenerateResponse(input.result)) {
    return {
      ...common,
      agent,
      result: input.result,
    } satisfies StoredCaseRunHistoryRecord;
  }

  if (isAgentAnalysisResponse(input.result) && agent !== "case-generator") {
    return {
      ...common,
      agent,
      analysisResult: input.result,
    } satisfies StoredAnalysisRunHistoryRecord;
  }

  throw new Error("运行记录结果类型与智能体不匹配。");
}

export function updateRunHistoryPinned(id: string, pinned: boolean) {
  const db = getDatabase();
  const pinnedAt = pinned ? new Date().toISOString() : null;
  const result = db.prepare("UPDATE run_history SET pinned_at = ? WHERE id = ?").run(pinnedAt, id);
  if (!result.changes) return null;
  const row = db.prepare("SELECT * FROM run_history WHERE id = ?").get(id) as RunHistoryRow | undefined;
  return row ? rowToRecord(row) : null;
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

  const result = JSON.parse(row.result_json) as GenerateResponse | AgentAnalysisResponse;
  if (normalizeHistoryAgent(row.agent) !== "case-generator" || !isGenerateResponse(result)) return rowToRecord(row);

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

export function deleteRunHistoryRecordsByAgent(agent: TestAgentType) {
  const db = getDatabase();
  db.prepare("DELETE FROM run_history WHERE agent = ?").run(agent);
}

export function clearRunHistoryRecords() {
  const db = getDatabase();
  db.prepare("DELETE FROM run_history").run();
}
