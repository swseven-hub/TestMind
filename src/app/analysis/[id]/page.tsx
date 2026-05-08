"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListChecks,
  Search,
} from "lucide-react";
import clsx from "clsx";
import { providerLabels, reasoningEffortLabels, thinkingModeLabels } from "@/lib/model-config";
import { formatDuration, isAnalysisRunHistoryRecord, useRunHistory, type AnalysisRunHistoryRecord } from "@/lib/run-history";
import type { AgentAnalysisItem, AgentAnalysisResponse, AgentAnalysisSection, TestPriority } from "@/types/test-case";

const currentAgentAnalysisStorageKey = "testmind.currentAgentAnalysis.v1";
const pageSizeOptions = [20, 50, 100];

function readCurrentAnalysis() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(currentAgentAnalysisStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgentAnalysisResponse;
    return parsed && Array.isArray(parsed.sections) ? parsed : null;
  } catch {
    return null;
  }
}

function priorityBadgeClass(priority?: TestPriority) {
  if (priority === "P0") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (priority === "P1") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-slate-50 text-slate-600 ring-slate-200";
}

function getItemSearchText(section: AgentAnalysisSection, item: AgentAnalysisItem) {
  return [section.title, section.description, item.title, item.detail, item.category, item.evidence, item.suggestion, item.priority]
    .join(" ")
    .toLowerCase();
}

function flattenItems(sections: AgentAnalysisSection[]) {
  return sections.flatMap((section) => section.items.map((item) => ({ section, item })));
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

function AnalysisItemCard({ item, section }: { item: AgentAnalysisItem; section: AgentAnalysisSection }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {item.priority ? <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium ring-1", priorityBadgeClass(item.priority))}>{item.priority}</span> : null}
        {item.category ? <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">{item.category}</span> : null}
        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-500 ring-1 ring-slate-200">{section.title}</span>
      </div>
      <h3 className="mt-3 break-words text-base font-semibold leading-snug text-slate-900">{item.title}</h3>
      <p className="mt-2 break-words text-sm leading-6 text-slate-600">{item.detail}</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {item.evidence ? (
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase text-slate-400">依据</p>
            <p className="mt-2 break-words text-sm leading-6 text-slate-700">{item.evidence}</p>
          </div>
        ) : null}
        {item.suggestion ? (
          <div className="rounded-lg bg-teal-50 p-3 ring-1 ring-teal-100">
            <p className="text-xs font-medium uppercase text-teal-700/70">测试注意</p>
            <p className="mt-2 break-words text-sm leading-6 text-teal-800">{item.suggestion}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function AnalysisDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params.id ?? ""));
  const history = useRunHistory();
  const [currentResult, setCurrentResult] = useState<AgentAnalysisResponse | null>(null);
  const [activeSection, setActiveSection] = useState("全部");
  const [activePriority, setActivePriority] = useState<TestPriority | "全部">("全部");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const contentRef = useRef<HTMLElement | null>(null);
  const pendingScrollTopRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setCurrentResult(readCurrentAnalysis()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const record = history.find((item): item is AnalysisRunHistoryRecord => item.id === id && isAnalysisRunHistoryRecord(item)) ?? null;
  const result = record?.analysisResult ?? (id === currentResult?.agent || id === "current" ? currentResult : null);
  const itemCount = useMemo(() => (result ? result.sections.reduce((sum, section) => sum + section.items.length, 0) : 0), [result]);
  const p0Count = useMemo(() => (result ? result.sections.reduce((sum, section) => sum + section.items.filter((item) => item.priority === "P0").length, 0) : 0), [result]);

  function requestContentTop() {
    pendingScrollTopRef.current = true;
  }

  function resetPage() {
    requestContentTop();
    setCurrentPage(1);
  }

  function changeSection(sectionTitle: string) {
    setActiveSection(sectionTitle);
    resetPage();
  }

  function changePriority(priority: TestPriority | "全部") {
    setActivePriority(priority);
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

  function changePage(page: number) {
    requestContentTop();
    setCurrentPage(page);
  }

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return flattenItems(result?.sections ?? []).filter(({ section, item }) => {
      const sectionMatched = activeSection === "全部" || section.title === activeSection;
      const priorityMatched = activePriority === "全部" || item.priority === activePriority;
      const textMatched = !normalized || getItemSearchText(section, item).includes(normalized);
      return sectionMatched && priorityMatched && textMatched;
    });
  }, [activePriority, activeSection, query, result]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = filteredItems.length ? (safePage - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(safePage * pageSize, filteredItems.length);
  const paginatedItems = useMemo(() => filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize), [filteredItems, pageSize, safePage]);

  useEffect(() => {
    if (!pendingScrollTopRef.current) return;

    pendingScrollTopRef.current = false;
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activePriority, activeSection, pageSize, query, safePage]);

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
                <h1 className="truncate text-lg font-semibold sm:text-xl">需求测试点详情</h1>
                <p className="truncate text-sm text-slate-500">{result?.title ?? (id === "requirement-review" ? "需求分析智能体" : "智能体分析结果")}</p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <Link className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 sm:w-auto" href="/">
                <ArrowLeft className="size-4" />
                返回工作台
              </Link>
            </div>
          </div>
        </section>

        <section className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden px-3 py-3 sm:px-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <h2 className="font-semibold">模块目录</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">点击模块查看对应测试点。</p>
              <div className="mt-3 grid max-h-[44vh] gap-1.5 overflow-y-auto pr-1">
                <button
                  className={clsx(
                    "flex min-h-9 items-center justify-between rounded-lg px-3 text-sm transition",
                    activeSection === "全部" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                  )}
                  type="button"
                  onClick={() => changeSection("全部")}
                >
                  <span>全部模块</span>
                  <span>{itemCount}</span>
                </button>
                {(result?.sections ?? []).map((section) => (
                  <button
                    key={section.title}
                    className={clsx(
                      "flex min-h-9 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                      activeSection === section.title ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                    )}
                    type="button"
                    onClick={() => changeSection(section.title)}
                  >
                    <span className="min-w-0 flex-1 break-words leading-5">{section.title}</span>
                    <span className="shrink-0">{section.items.length}</span>
                  </button>
                ))}
              </div>
            </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <h2 className="font-semibold">优先级</h2>
              <div className="mt-3 grid gap-1.5">
                {(["全部", "P0", "P1", "P2"] as const).map((priority) => (
                  <button
                    key={priority}
                    className={clsx(
                      "flex h-9 items-center justify-between rounded-lg px-3 text-sm transition",
                      activePriority === priority ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                    )}
                    type="button"
                    onClick={() => changePriority(priority)}
                  >
                    <span>{priority}</span>
                    <span>
                      {priority === "全部"
                        ? itemCount
                        : result?.sections.reduce((sum, section) => sum + section.items.filter((item) => item.priority === priority).length, 0) ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

          <section ref={contentRef} className="min-h-0 min-w-0 space-y-3 overflow-y-auto pr-1">
          {result ? (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
                      <FileText className="size-4" />
                      需求分析报告
                    </div>
                    <h2 className="mt-2 text-xl font-semibold tracking-normal">{result.title}</h2>
                    <p className="mt-1 break-words text-sm leading-6 text-slate-500">{result.summary}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">模块</p>
                      <p className="mt-1 font-semibold text-slate-800">{result.sections.length} 个</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">测试点</p>
                      <p className="mt-1 font-semibold text-slate-800">{itemCount} 条</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">P0</p>
                      <p className="mt-1 font-semibold text-slate-800">{p0Count} 条</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-xs text-slate-400">耗时</p>
                      <p className="mt-1 font-semibold text-slate-800">{formatDuration(result.stats?.durationMs)}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                    模型 {result.stats ? `${providerLabels[result.stats.provider]} / ${result.stats.model}` : "未记录"}
                  </span>
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                    原文 {result.stats?.sourceTextLength?.toLocaleString("zh-CN") ?? "未记录"} 字符
                  </span>
                  {result.stats?.thinkingMode ? (
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                      模式 {thinkingModeLabels[result.stats.thinkingMode]}
                    </span>
                  ) : null}
                  {result.stats?.reasoningEffort ? (
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                      推理 {reasoningEffortLabels[result.stats.reasoningEffort]}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-700 ring-1 ring-teal-200">
                    {result.source === "fallback" ? "本地规则分析" : "AI 分析"}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <label className="relative block min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <input
                      className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white"
                      placeholder="搜索模块、功能点、测试注意、依据"
                      value={query}
                      onChange={(event) => changeQuery(event.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                      筛选后 {filteredItems.length} 条
                    </span>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                      {activeSection} / {activePriority}
                    </span>
                  </div>
                </div>
              </div>

              <PaginationControls
                end={pageEnd}
                page={safePage}
                pageSize={pageSize}
                start={pageStart}
                total={filteredItems.length}
                totalPages={totalPages}
                onPageChange={changePage}
                onPageSizeChange={changePageSize}
              />

              {paginatedItems.length ? (
                <div className="grid gap-3">
                  {paginatedItems.map(({ section, item }, index) => (
                    <AnalysisItemCard key={`${section.title}-${item.title}-${index}`} item={item} section={section} />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
                  <p className="font-medium text-slate-700">没有匹配的测试点</p>
                  <p className="mt-2 text-sm text-slate-500">可以调整模块、优先级或搜索关键词。</p>
                </div>
              )}

              <div className="grid gap-3 xl:grid-cols-2">
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="font-semibold">检查清单</h3>
                  <div className="mt-3 grid gap-2">
                    {result.checklist.map((item, index) => (
                      <div key={`${item}-${index}`} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-700" />
                        <span className="break-words">{item}</span>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="font-semibold">下一步</h3>
                  <div className="mt-3 grid gap-2">
                    {result.nextActions.map((item, index) => (
                      <div key={`${item}-${index}`} className="grid grid-cols-[24px_1fr] gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                        <span className="grid size-6 place-items-center rounded-full bg-white text-xs font-semibold text-slate-500 ring-1 ring-slate-200">{index + 1}</span>
                        <span className="min-w-0 break-words">{item}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <div className="grid min-h-[320px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
              <div className="max-w-md">
                <div className="mx-auto grid size-14 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                  <AlertCircle className="size-7" />
                </div>
                <p className="mt-4 font-medium text-slate-700">还没有可查看的需求分析结果</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">请先在工作台运行需求分析智能体，完成后从首页点击“查看全部测试点”。</p>
              </div>
            </div>
          )}
          </section>
        </section>
      </div>
    </main>
  );
}
