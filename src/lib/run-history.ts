import { useEffect, useState } from "react";

import type { Provider } from "@/lib/model-config";
import type { CaseReviewStatus } from "@/lib/case-review";
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

export type RunHistoryProvider = Provider;

type RunHistoryBase = {
  id: string;
  agent: TestAgentType;
  status: RunStatus;
  createdAt: string;
  pinnedAt?: string;
  completedAt?: string;
  fileName: string;
  provider: RunHistoryProvider;
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

export type CaseRunHistoryRecord = RunHistoryBase & {
  agent: "case-generator";
  result: GenerateResponse;
};

export type AnalysisRunHistoryRecord = RunHistoryBase & {
  agent: TestAgentAnalysisType;
  analysisResult: AgentAnalysisResponse;
};

export type RunHistoryRecord = CaseRunHistoryRecord | AnalysisRunHistoryRecord;

export const storageChangeEvent = "testmind.storage-change";
const legacyRunHistoryStorageKey = "testmind.runHistory.v1";
const historyChangeEvent = "testmind.run-history-change";

let runHistoryCache: RunHistoryRecord[] = [];
let migrationStarted = false;

export function subscribeStorage(callback: () => void) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("storage", callback);
  window.addEventListener(storageChangeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(storageChangeEvent, callback);
  };
}

function dispatchHistoryChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(historyChangeEvent));
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

export function isCaseRunHistoryRecord(record: RunHistoryRecord): record is CaseRunHistoryRecord {
  return record.agent === "case-generator";
}

export function isAnalysisRunHistoryRecord(record: RunHistoryRecord): record is AnalysisRunHistoryRecord {
  return record.agent !== "case-generator";
}

function normalizeRunHistoryRecord(value: unknown): RunHistoryRecord | null {
  const record = value as Partial<RunHistoryRecord> & {
    agent?: unknown;
    result?: unknown;
    analysisResult?: unknown;
  };
  if (!record?.id || !record.fileName || !record.provider || !record.model) return null;

  const agent = normalizeHistoryAgent(record.agent);
  if (agent === "case-generator") {
    if (!isGenerateResponse(record.result)) return null;
    return {
      ...record,
      agent,
      result: record.result,
    } as CaseRunHistoryRecord;
  }

  if (!isAgentAnalysisResponse(record.analysisResult)) return null;
  return {
    ...record,
    agent,
    analysisResult: record.analysisResult,
  } as AnalysisRunHistoryRecord;
}

function readLegacyRunHistory(): RunHistoryRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(legacyRunHistoryStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(normalizeRunHistoryRecord).filter((item): item is RunHistoryRecord => Boolean(item)) : [];
  } catch {
    return [];
  }
}

async function migrateLegacyRunHistory() {
  if (migrationStarted) return;
  const legacyRecords = readLegacyRunHistory();
  if (!legacyRecords.length) return;

  migrationStarted = true;
  try {
    await fetch("/api/run-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: legacyRecords }),
    });
    window.localStorage.removeItem(legacyRunHistoryStorageKey);
  } catch {
    migrationStarted = false;
  }
}

export async function refreshRunHistory() {
  if (typeof window === "undefined") return runHistoryCache;

  await migrateLegacyRunHistory();

  try {
    const response = await fetch("/api/run-history", { cache: "no-store" });
    if (!response.ok) throw new Error("读取运行记录失败。");
    const payload = (await response.json()) as { records?: RunHistoryRecord[] };
    runHistoryCache = Array.isArray(payload.records) ? payload.records.map(normalizeRunHistoryRecord).filter((item): item is RunHistoryRecord => Boolean(item)) : [];
    dispatchHistoryChange();
  } catch {
    dispatchHistoryChange();
  }

  return runHistoryCache;
}

export async function removeRunHistoryRecord(id: string) {
  const response = await fetch(`/api/run-history?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("删除运行记录失败。");
  return refreshRunHistory();
}

export async function updateRunHistoryCaseStatuses(
  id: string,
  caseUpdates: Array<{
    caseId: string;
    module: string;
    status?: CaseReviewStatus;
    patch?: Partial<TestCase>;
  }>,
) {
  const response = await fetch("/api/run-history", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, caseUpdates }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message || "更新用例状态失败。");
  }
  return refreshRunHistory();
}

export async function updateRunHistoryPinned(id: string, pinned: boolean) {
  const response = await fetch("/api/run-history", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, pinned }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message || "更新运行记录置顶状态失败。");
  }
  return refreshRunHistory();
}

export async function clearRunHistory(agent?: TestAgentType) {
  const query = agent ? `?agent=${encodeURIComponent(agent)}` : "";
  const response = await fetch(`/api/run-history${query}`, { method: "DELETE" });
  if (!response.ok) throw new Error("清空运行记录失败。");
  return refreshRunHistory();
}

export function useRunHistory() {
  const [history, setHistory] = useState(runHistoryCache);

  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (alive) setHistory([...runHistoryCache]);
    };
    window.addEventListener(historyChangeEvent, sync);
    refreshRunHistory().then(() => {
      if (alive) setHistory([...runHistoryCache]);
    });
    return () => {
      alive = false;
      window.removeEventListener(historyChangeEvent, sync);
    };
  }, []);

  return history;
}

export function formatRunTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(ms?: number) {
  if (ms === undefined || ms === null || ms < 0) return "未记录";
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}分${rest}秒` : `${rest}秒`;
}

export function formatTokens(value?: number) {
  if (!value) return "未返回";
  return value.toLocaleString("zh-CN");
}
