"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  History,
  Loader2,
  Search,
  Shield,
  Trash2,
  Zap,
} from "lucide-react";
import clsx from "clsx";

import { downloadExcel } from "@/lib/download-excel";
import { providerLabels, reasoningEffortLabels, thinkingModeLabels } from "@/lib/model-config";
import { clearRunHistory, formatDuration, formatRunTime, formatTokens, removeRunHistoryRecord, useRunHistory } from "@/lib/run-history";
import { getTemplateCaseFields } from "@/lib/testcase-template";
import type { RunStatus, TestCase, TestCategory } from "@/types/test-case";

const categories: TestCategory[] = ["功能", "边界", "异常", "权限", "性能"];

const categoryStyles: Record<TestCategory, string> = {
  功能: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  边界: "bg-amber-50 text-amber-700 ring-amber-200",
  异常: "bg-rose-50 text-rose-700 ring-rose-200",
  权限: "bg-sky-50 text-sky-700 ring-sky-200",
  性能: "bg-violet-50 text-violet-700 ring-violet-200",
};

const categoryIcons = {
  功能: CheckCircle2,
  边界: Search,
  异常: AlertCircle,
  权限: Shield,
  性能: Zap,
};

const statusLabels: Record<RunStatus, string> = {
  success: "成功",
  failed: "失败",
  cancelled: "已停止",
};

const statusStyles: Record<RunStatus, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  cancelled: "bg-amber-50 text-amber-700 ring-amber-200",
};

function groupCases(cases: TestCase[]) {
  const data = new Map<string, TestCase[]>();
  for (const item of cases) data.set(item.module, [...(data.get(item.module) ?? []), item]);
  return [...data.entries()].map(([moduleName, items]) => ({ moduleName, cases: items }));
}

function formatJsonPreview(value: unknown) {
  if (!value) return "未记录";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function HistoryPage() {
  const history = useRunHistory();
  const [activeId, setActiveId] = useState("");
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [error, setError] = useState("");
  const selectedRecord = history.find((record) => record.id === activeId) ?? history[0] ?? null;

  const groupedCases = useMemo(() => groupCases(selectedRecord?.result.cases ?? []), [selectedRecord]);
  const categoryCounts = useMemo(() => {
    const data = Object.fromEntries(categories.map((category) => [category, 0])) as Record<TestCategory, number>;
    for (const item of selectedRecord?.result.cases ?? []) data[item.category] += 1;
    return data;
  }, [selectedRecord]);

  async function exportSelectedExcel() {
    if (!selectedRecord || isExportingExcel) return;

    setIsExportingExcel(true);
    setError("");
    try {
      await downloadExcel(selectedRecord.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Excel 导出失败，请稍后重试。");
    } finally {
      setIsExportingExcel(false);
    }
  }

  async function deleteRecord(id: string) {
    setError("");
    try {
      await removeRunHistoryRecord(id);
      if (activeId === id) setActiveId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除运行记录失败。");
    }
  }

  async function clearRecords() {
    setError("");
    try {
      await clearRunHistory();
      setActiveId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "清空运行记录失败。");
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f4ef] text-slate-950">
      <section className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Link
              aria-label="返回首页"
              className="grid size-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
              href="/"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold">运行记录</h1>
              <p className="text-sm text-slate-500">共保存 {history.length} 次运行记录，包含成功、失败和已停止任务</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              disabled={!selectedRecord || isExportingExcel}
              type="button"
              onClick={exportSelectedExcel}
            >
              {isExportingExcel ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              导出当前记录
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-rose-200"
              disabled={!history.length}
              type="button"
              onClick={clearRecords}
            >
              <Trash2 className="size-4" />
              清空记录
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-3">
          {history.length ? (
            history.map((record) => {
              const active = selectedRecord?.id === record.id;
              return (
                <div
                  key={record.id}
                  className={clsx(
                    "rounded-lg border transition",
                    active ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300",
                  )}
                >
                  <div className="flex items-stretch gap-1 p-3">
                    <button className="min-w-0 flex-1 text-left" type="button" onClick={() => setActiveId(record.id)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{record.fileName}</p>
                          <p className={clsx("mt-1 text-xs", active ? "text-slate-300" : "text-slate-500")}>
                            {formatRunTime(record.createdAt)} · {providerLabels[record.provider]} · {record.caseCount} 条
                          </p>
                        </div>
                        <span
                          className={clsx(
                            "shrink-0 rounded-full px-2 py-1 text-xs ring-1",
                            active ? "bg-white/10 text-white ring-white/20" : statusStyles[record.status],
                          )}
                        >
                          {statusLabels[record.status]}
                        </span>
                      </div>
                      <p className={clsx("mt-2 truncate text-xs", active ? "text-slate-300" : "text-slate-400")}>
                        {record.model}
                        {record.thinkingMode ? ` · ${thinkingModeLabels[record.thinkingMode]}` : ""} · {formatDuration(record.durationMs)}
                        {record.result.stats?.reasoningEffort ? ` · 推理${reasoningEffortLabels[record.result.stats.reasoningEffort]}` : ""}
                      </p>
                    </button>
                    <button
                      aria-label="删除运行记录"
                      className={clsx(
                        "grid size-8 shrink-0 place-items-center rounded-md opacity-70 transition hover:opacity-100",
                        active ? "hover:bg-white/10" : "hover:bg-slate-100",
                      )}
                      type="button"
                      onClick={() => deleteRecord(record.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
              <div className="mx-auto grid size-12 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                <History className="size-6" />
              </div>
              <p className="mt-4 font-medium text-slate-700">暂无运行记录</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">生成成功后会保存在这里，刷新页面后也能继续查看。</p>
            </div>
          )}
        </aside>

        <section className="min-w-0 space-y-4">
          {selectedRecord ? (
            <>
              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="space-y-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-teal-700">
                      <FileText className="size-4" />
                      <span className="min-w-0 break-words">
                        {providerLabels[selectedRecord.provider]} / {selectedRecord.model}
                        {selectedRecord.thinkingMode ? ` / ${thinkingModeLabels[selectedRecord.thinkingMode]}` : ""}
                        {selectedRecord.result.stats?.reasoningEffort ? ` / 推理${reasoningEffortLabels[selectedRecord.result.stats.reasoningEffort]}` : ""}
                      </span>
                      <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium ring-1", statusStyles[selectedRecord.status])}>
                        {statusLabels[selectedRecord.status]}
                      </span>
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold tracking-normal break-words">{selectedRecord.fileName}</h2>
                    <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-500 break-words">{selectedRecord.result.summary}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3 2xl:grid-cols-6">
                    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">用例</p>
                      <p className="mt-1 font-semibold text-slate-800">{selectedRecord.caseCount} 条</p>
                    </div>
                    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">模块</p>
                      <p className="mt-1 font-semibold text-slate-800">{groupedCases.length} 个</p>
                    </div>
                    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">时间</p>
                      <p className="mt-1 break-words font-semibold text-slate-800">{formatRunTime(selectedRecord.createdAt)}</p>
                    </div>
                    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">耗时</p>
                      <p className="mt-1 font-semibold text-slate-800">{formatDuration(selectedRecord.durationMs ?? selectedRecord.result.stats?.durationMs)}</p>
                    </div>
                    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">Token</p>
                      <p className="mt-1 font-semibold text-slate-800">{formatTokens(selectedRecord.usage?.totalTokens ?? selectedRecord.result.stats?.usage?.totalTokens)}</p>
                    </div>
                    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">估算费用</p>
                      <p className="mt-1 font-semibold text-slate-800">
                        {selectedRecord.result.stats?.estimatedCostCny === null || selectedRecord.result.stats?.estimatedCostCny === undefined
                          ? "未估算"
                          : `¥${selectedRecord.result.stats.estimatedCostCny < 0.01 ? selectedRecord.result.stats.estimatedCostCny.toFixed(4) : selectedRecord.result.stats.estimatedCostCny.toFixed(2)}`}
                      </p>
                    </div>
                  </div>
                </div>

                {selectedRecord.result.stats?.modules.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedRecord.result.stats.modules.slice(0, 14).map((module) => (
                      <span key={module.name} className="max-w-full rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                        <span className="break-words">{module.name}</span> · {module.caseCount} 条 · {formatDuration(module.durationMs)}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {categories.map((category) => {
                    const count = categoryCounts[category];
                    if (!count) return null;
                    return (
                      <span key={category} className={clsx("rounded-full px-2.5 py-1 text-xs font-medium ring-1", categoryStyles[category])}>
                        {category} {count}
                      </span>
                    );
                  })}
                </div>

                {selectedRecord.result.warnings.length ? (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
                    {selectedRecord.result.warnings.join(" ")}
                  </div>
                ) : null}

                {selectedRecord.status !== "success" ? (
                  <div className="mt-4 min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-800">运行日志详情</h3>
                      <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium ring-1", statusStyles[selectedRecord.status])}>
                        {statusLabels[selectedRecord.status]}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                      <div>
                        <p className="text-xs text-slate-400">失败/停止阶段</p>
                        <p className="mt-1 break-words text-slate-700">{selectedRecord.failedStage || "未记录"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">错误信息</p>
                        <p className="mt-1 break-words text-slate-700">{selectedRecord.errorMessage || selectedRecord.errorDetail || "未记录"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">供应商 / 模型</p>
                        <p className="mt-1 break-words text-slate-700">
                          {providerLabels[selectedRecord.provider]} / {selectedRecord.model}
                          {selectedRecord.result.stats?.reasoningEffort ? ` / 推理${reasoningEffortLabels[selectedRecord.result.stats.reasoningEffort]}` : ""}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">耗时 / Token</p>
                        <p className="mt-1 break-words text-slate-700">
                          {formatDuration(selectedRecord.durationMs ?? selectedRecord.result.stats?.durationMs)} /{" "}
                          {formatTokens(selectedRecord.usage?.totalTokens ?? selectedRecord.result.stats?.usage?.totalTokens)}
                        </p>
                      </div>
                    </div>
                    {selectedRecord.errorDetail ? (
                      <div className="mt-3">
                        <p className="text-xs text-slate-400">错误详情</p>
                        <p className="mt-1 break-words text-sm leading-6 text-slate-700">{selectedRecord.errorDetail}</p>
                      </div>
                    ) : null}
                    <details className="mt-3 min-w-0">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700">查看原始错误和最后一次事件</summary>
                      <div className="mt-2 grid min-w-0 gap-3 lg:grid-cols-2">
                        <pre className="min-w-0 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-3 text-xs leading-5 text-slate-600 ring-1 ring-slate-200">
                          {selectedRecord.errorRaw || "未记录"}
                        </pre>
                        <pre className="min-w-0 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-3 text-xs leading-5 text-slate-600 ring-1 ring-slate-200">
                          {formatJsonPreview(selectedRecord.lastEvent)}
                        </pre>
                      </div>
                    </details>
                  </div>
                ) : null}

                {error ? (
                  <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
                ) : null}
              </div>

              {groupedCases.length ? (
                <div className="grid gap-5">
                  {groupedCases.map((group, groupIndex) => (
                    <section key={`${group.moduleName}-${groupIndex}`} className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
                        <div>
                          <h3 className="break-words text-lg font-semibold">{group.moduleName}</h3>
                          <p className="mt-1 text-sm text-slate-500">{group.cases.length} 条测试用例</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {categories.map((category) => {
                            const count = group.cases.filter((item) => item.category === category).length;
                            if (!count) return null;
                            return (
                              <span key={category} className={clsx("rounded-full px-2.5 py-1 text-xs font-medium ring-1", categoryStyles[category])}>
                                {category} {count}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid gap-3">
                        {group.cases.map((item, caseIndex) => (
                          <HistoryCaseCard key={`${group.moduleName}-${item.id}-${caseIndex}`} item={item} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
                  <p className="font-medium text-slate-700">本次运行没有保存到可展示用例</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">可以查看上方运行日志详情，定位失败阶段、模型返回和最后一次事件。</p>
                </div>
              )}
            </>
          ) : (
            <div className="grid min-h-96 place-items-center rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="max-w-md">
                <div className="mx-auto grid size-14 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                  <FileText className="size-7" />
                </div>
                <p className="mt-4 font-medium text-slate-700">还没有可查看的结果</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">返回首页上传 PRD 并生成测试用例后，结果会自动出现在这里。</p>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function HistoryCaseCard({ item }: { item: TestCase }) {
  const Icon = categoryIcons[item.category];
  const template = getTemplateCaseFields(item);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1", categoryStyles[item.category])}>
              <Icon className="size-3.5" />
              {item.category}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">重要程度 {template.priority}</span>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">{template.caseType}</span>
            <span className="text-xs text-slate-400">{template.id}</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold leading-snug">{item.title}</h3>
          <p className="mt-1 break-words text-sm text-slate-500">{template.module}</p>
          {item.testPoint || item.evidence ? (
            <p className="mt-2 break-words text-sm leading-6 text-slate-500">
              {item.testPoint ? `测试点：${item.testPoint}` : ""}
              {item.testPoint && item.evidence ? " ｜ " : ""}
              {item.evidence ? `依据：${item.evidence}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.2fr_1fr]">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase text-slate-400">前置条件</p>
          <p className="mt-2 break-words text-sm leading-6 text-slate-700">{template.preconditions || "无"}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase text-slate-400">步骤描述</p>
          <ol className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
            {item.steps.map((step, index) => (
              <li key={`${item.id}-history-step-${index}`} className="grid grid-cols-[24px_1fr] gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-white text-xs font-semibold text-slate-500 ring-1 ring-slate-200">{index + 1}</span>
                <span className="min-w-0 break-words">{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase text-slate-400">预期结果</p>
          <div className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
            {template.expectedResults.split("\n").map((line, index) => (
              <p key={`${item.id}-history-expected-${index}`} className="break-words">{line}</p>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
