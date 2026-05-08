"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  History,
  ListChecks,
  Loader2,
  Search,
  Shield,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { demoGenerateResponse } from "@/lib/demo-test-cases";
import { downloadExcel } from "@/lib/download-excel";
import { formatDuration, formatTokens, isCaseRunHistoryRecord, useRunHistory, type CaseRunHistoryRecord } from "@/lib/run-history";
import { getTemplateCaseFields } from "@/lib/testcase-template";
import type { GenerateResponse, TestCase, TestCategory } from "@/types/test-case";

const categories: TestCategory[] = ["功能", "边界", "异常", "权限", "性能"];
const currentCaseReportStorageKey = "testmind.currentCaseReport.v1";
const pageSizeOptions = [20, 50, 100];

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

function readCurrentReport() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(currentCaseReportStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GenerateResponse;
    return parsed && Array.isArray(parsed.cases) ? parsed : null;
  } catch {
    return null;
  }
}

function formatCost(value?: number | null) {
  if (value === null || value === undefined) return "未估算";
  if (value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

function getCaseSearchText(item: TestCase) {
  const template = getTemplateCaseFields(item);
  return [
    item.id,
    item.title,
    item.module,
    item.priority,
    item.testPoint,
    item.evidence,
    item.preconditions,
    item.expectedResult,
    template.caseType,
    template.executionType,
    template.maintainer,
    template.followers,
    template.relatedWorkItems,
    template.remarks,
    ...item.steps,
  ]
    .join(" ")
    .toLowerCase();
}

function groupCases(cases: TestCase[]) {
  const data = new Map<string, TestCase[]>();
  for (const item of cases) data.set(item.module, [...(data.get(item.module) ?? []), item]);
  return [...data.entries()].map(([moduleName, items]) => ({ moduleName, cases: items }));
}

function PaginationControls({
  end,
  page,
  pageSize,
  start,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  end: number;
  page: number;
  pageSize: number;
  start: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  if (!total) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="text-slate-500">
        当前显示 <span className="font-semibold text-slate-800">{start}-{end}</span> / {total} 条
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
          {pageSizeOptions.map((option) => (
            <button
              key={option}
              className={clsx(
                "h-8 rounded-md px-2.5 text-xs font-medium transition",
                pageSize === option ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white hover:text-slate-950",
              )}
              type="button"
              onClick={() => onPageSizeChange(option)}
            >
              {option}/页
            </button>
          ))}
        </div>
        <button
          aria-label="上一页"
          className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          disabled={page <= 1}
          type="button"
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-16 text-center text-sm font-medium text-slate-700">
          {page} / {totalPages}
        </span>
        <button
          aria-label="下一页"
          className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          disabled={page >= totalPages}
          type="button"
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function CaseDetailCard({ item }: { item: TestCase }) {
  const Icon = categoryIcons[item.category];
  const template = getTemplateCaseFields(item);
  const templateMeta = [
    ["模块", template.module],
    ["编号", template.id || "自动新建"],
    ["状态", template.status || "未设置"],
    ["维护人", template.maintainer],
    ["用例类型", template.caseType],
    ["重要程度", template.priority],
    ["测试类型", template.executionType],
    ["预估工时", template.estimatedHours === null ? "未估算" : String(template.estimatedHours)],
    ["剩余工时", template.remainingHours === null ? "未估算" : String(template.remainingHours)],
    ["关联工作项", template.relatedWorkItems || "无"],
    ["关注人", template.followers],
  ];

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
          <h3 className="mt-3 text-lg font-semibold leading-snug text-slate-900">{item.title}</h3>
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

      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        {templateMeta.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <span className="text-xs font-medium text-slate-400">{label}</span>
            <p className="mt-1 break-words text-slate-700">{value}</p>
          </div>
        ))}
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
              <li key={`${item.id}-step-${index}`} className="grid grid-cols-[24px_1fr] gap-2">
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
              <p key={`${item.id}-expected-${index}`} className="break-words">{line}</p>
            ))}
          </div>
        </div>
      </div>
      {template.remarks ? (
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase text-slate-400">备注</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{template.remarks}</p>
        </div>
      ) : null}
    </article>
  );
}

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params.id ?? ""));
  const history = useRunHistory();
  const [currentReport, setCurrentReport] = useState<GenerateResponse | null>(null);
  const [activeModule, setActiveModule] = useState("全部");
  const [activeCategory, setActiveCategory] = useState<TestCategory | "全部">("全部");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setCurrentReport(readCurrentReport()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function resetPage() {
    setCurrentPage(1);
  }

  function changeModule(moduleName: string) {
    setActiveModule(moduleName);
    resetPage();
  }

  function changeCategory(category: TestCategory | "全部") {
    setActiveCategory(category);
    resetPage();
  }

  function changeQuery(value: string) {
    setQuery(value);
    resetPage();
  }

  function changePageSize(nextPageSize: number) {
    setPageSize(nextPageSize);
    resetPage();
  }

  const record = history.find((item): item is CaseRunHistoryRecord => item.id === id && isCaseRunHistoryRecord(item)) ?? null;
  const result = id === "demo" ? demoGenerateResponse : record?.result ?? (id === "current" ? currentReport : null);
  const stats = result?.stats;

  const moduleCounts = useMemo(() => {
    const data: Record<string, number> = {};
    for (const item of result?.cases ?? []) data[item.module] = (data[item.module] ?? 0) + 1;
    return data;
  }, [result]);

  const moduleNames = useMemo(
    () => Object.keys(moduleCounts).sort((a, b) => moduleCounts[b] - moduleCounts[a] || a.localeCompare(b, "zh-CN")),
    [moduleCounts],
  );

  const filteredCases = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (result?.cases ?? []).filter((item) => {
      const moduleMatched = activeModule === "全部" || item.module === activeModule;
      const categoryMatched = activeCategory === "全部" || item.category === activeCategory;
      const textMatched = !normalized || getCaseSearchText(item).includes(normalized);
      return moduleMatched && categoryMatched && textMatched;
    });
  }, [activeCategory, activeModule, query, result]);

  const categoryCounts = useMemo(() => {
    const data = Object.fromEntries(categories.map((category) => [category, 0])) as Record<TestCategory, number>;
    for (const item of result?.cases ?? []) {
      if (activeModule === "全部" || item.module === activeModule) data[item.category] += 1;
    }
    return data;
  }, [activeModule, result]);

  const totalPages = Math.max(1, Math.ceil(filteredCases.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = filteredCases.length ? (safePage - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(safePage * pageSize, filteredCases.length);
  const paginatedCases = useMemo(() => filteredCases.slice((safePage - 1) * pageSize, safePage * pageSize), [filteredCases, pageSize, safePage]);
  const groupedCases = useMemo(() => groupCases(paginatedCases), [paginatedCases]);

  async function exportExcel() {
    if (!result || isExporting) return;

    setIsExporting(true);
    try {
      await downloadExcel(result);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-[#f6f8fb] text-slate-950">
      <div className="flex h-full min-h-0 w-full flex-col">
        <section className="shrink-0 border-b border-slate-200/80 bg-white/90 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur">
          <div className="flex min-h-[72px] flex-col gap-3 px-4 py-3 sm:px-5 lg:h-[72px] lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-950 text-white shadow-sm ring-1 ring-slate-900/10">
                <ListChecks className="size-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold sm:text-xl">测试点详情</h1>
                <p className="truncate text-sm text-slate-500">{result?.fileName ?? "正在读取运行记录"}</p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <Link className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 sm:w-auto" href="/history">
                <History className="size-4" />
                运行记录
              </Link>
              <Link className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 sm:w-auto" href="/">
                <ArrowLeft className="size-4" />
                返回工作台
              </Link>
              <button
                className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 sm:w-auto"
                disabled={!result || isExporting}
                type="button"
                onClick={exportExcel}
              >
                {isExporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                Excel
              </button>
            </div>
          </div>
        </section>

        <section className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden px-3 py-3 sm:px-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">目录</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">点击模块查看对应测试点。</p>
              <div className="mt-3 grid max-h-[52vh] gap-1.5 overflow-y-auto pr-1">
                <button
                  className={clsx(
                    "flex min-h-9 items-center justify-between rounded-lg px-3 text-sm transition",
                    activeModule === "全部" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                  )}
                  type="button"
                  onClick={() => changeModule("全部")}
                >
                  <span>全部模块</span>
                  <span>{result?.cases.length ?? 0}</span>
                </button>
                {moduleNames.map((moduleName) => (
                  <button
                    key={moduleName}
                    className={clsx(
                      "flex min-h-9 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                      activeModule === moduleName ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                    )}
                    type="button"
                    onClick={() => changeModule(moduleName)}
                  >
                    <span className="min-w-0 flex-1 break-words leading-5">{moduleName}</span>
                    <span className="shrink-0">{moduleCounts[moduleName]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">类型</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">当前模块：{activeModule}</p>
              <div className="mt-3 grid gap-1.5">
                <button
                  className={clsx(
                    "flex h-9 items-center justify-between rounded-lg px-3 text-sm transition",
                    activeCategory === "全部" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                  )}
                  type="button"
                  onClick={() => changeCategory("全部")}
                >
                  <span>全部</span>
                  <span>{Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}</span>
                </button>
                {categories.map((category) => {
                  const Icon = categoryIcons[category];
                  return (
                    <button
                      key={category}
                      className={clsx(
                        "flex h-9 items-center justify-between rounded-lg px-3 text-sm transition",
                        activeCategory === category ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                      )}
                      type="button"
                      onClick={() => changeCategory(category)}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="size-4" />
                        {category}
                      </span>
                      <span>{categoryCounts[category]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

          <section className="min-h-0 min-w-0 space-y-3 overflow-y-auto pr-1">
          {result ? (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
                      <FileText className="size-4" />
                      生成报告
                    </div>
                    <h2 className="mt-2 text-xl font-semibold tracking-normal">{result.fileName}</h2>
                    <p className="mt-1 break-words text-sm leading-6 text-slate-500">{result.summary}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">模块</p>
                      <p className="mt-1 font-semibold text-slate-800">{moduleNames.length} 个</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">测试点</p>
                      <p className="mt-1 font-semibold text-slate-800">{result.cases.length} 条</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">耗时</p>
                      <p className="mt-1 font-semibold text-slate-800">{formatDuration(stats?.durationMs)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">费用</p>
                      <p className="mt-1 font-semibold text-slate-800">{formatCost(stats?.estimatedCostCny)}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                    Token {formatTokens(stats?.usage?.totalTokens)}
                  </span>
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                    原文 {stats?.sourceTextLength?.toLocaleString("zh-CN") ?? "未记录"} 字符
                  </span>
                  <span className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-700 ring-1 ring-teal-200">
                    {result.source === "demo" ? "演示案例" : result.source === "fallback" ? "本地规则" : "AI 生成"}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <label className="relative block min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <input
                      className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white"
                      placeholder="搜索标题、模块、步骤、依据"
                      value={query}
                      onChange={(event) => changeQuery(event.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                      筛选后 {filteredCases.length} 条
                    </span>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                      {activeModule} / {activeCategory}
                    </span>
                  </div>
                </div>
              </div>

              <PaginationControls
                end={pageEnd}
                page={safePage}
                pageSize={pageSize}
                start={pageStart}
                total={filteredCases.length}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                onPageSizeChange={changePageSize}
              />

              {groupedCases.length ? (
                <div className="grid gap-4">
                  {groupedCases.map((group) => (
                    <section key={group.moduleName} className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
                        <div>
                          <h3 className="break-words text-lg font-semibold">{group.moduleName}</h3>
                          <p className="mt-1 text-sm text-slate-500">
                            本页 {group.cases.length} 条 / 模块 {moduleCounts[group.moduleName] ?? group.cases.length} 条
                          </p>
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
                          <CaseDetailCard key={`${group.moduleName}-${item.id}-${caseIndex}`} item={item} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
                  <p className="font-medium text-slate-700">没有匹配的测试点</p>
                  <p className="mt-2 text-sm text-slate-500">可以调整模块、类型或搜索关键词。</p>
                </div>
              )}

              <PaginationControls
                end={pageEnd}
                page={safePage}
                pageSize={pageSize}
                start={pageStart}
                total={filteredCases.length}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                onPageSizeChange={changePageSize}
              />
            </>
          ) : (
            <div className="grid min-h-[320px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
              <div className="max-w-md">
                <div className="mx-auto grid size-14 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                  <Clock3 className="size-7" />
                </div>
                <p className="mt-4 font-medium text-slate-700">正在读取测试点详情</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">如果这是刚生成的结果，请稍等运行记录刷新；也可以返回工作台重新进入详情。</p>
              </div>
            </div>
          )}
          </section>
        </section>
      </div>
    </main>
  );
}
