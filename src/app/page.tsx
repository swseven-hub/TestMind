"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  ListChecks,
  Loader2,
  Minimize2,
  PlayCircle,
  Search,
  Shield,
  Sparkles,
  Square,
  Terminal,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { demoGenerateResponse, demoPrdHighlights } from "@/lib/demo-test-cases";
import { downloadExcel } from "@/lib/download-excel";
import {
  aliyunModelOptions,
  deepseekModelOptions,
  getAliyunModelOption,
  getAliyunOutputPrice,
  getDeepSeekModelOption,
  getOpenAIModelOption,
  getVelotricModelOption,
  normalizeProvider,
  normalizeThinkingMode,
  openaiModelOptions,
  providerBaseURLs,
  providerLabels,
  providerModels,
  reasoningEffortDescriptions,
  reasoningEffortLabels,
  reasoningEffortOptions,
  thinkingModeDescriptions,
  thinkingModeLabels,
  velotricModelOptions,
  type Provider,
  type ReasoningEffort,
  type ThinkingMode,
  normalizeReasoningEffort,
} from "@/lib/model-config";
import { formatDuration, formatTokens, refreshRunHistory, storageChangeEvent, subscribeStorage, useRunHistory } from "@/lib/run-history";
import { getTemplateCaseFields } from "@/lib/testcase-template";
import type { Complexity, CoverageModule, GenerateResponse, RiskLevel, TestCase, TestCategory } from "@/types/test-case";

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

const complexityLabels: Record<Complexity, string> = {
  minimal: "极简",
  simple: "简单",
  medium: "中等",
  complex: "复杂",
  large: "大型",
};

const riskLabels: Record<RiskLevel, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  critical: "关键风险",
};

const storageKeys = {
  provider: "testmind.provider",
};

const providerOptions: Provider[] = ["deepseek", "aliyun", "openai", "velotric"];

function apiKeyStorageKey(provider: Provider) {
  return `testmind.${provider}.apiKey`;
}

function modelStorageKey(provider: Provider) {
  return `testmind.${provider}.model`;
}

function thinkingModeStorageKey(provider: Provider) {
  return `testmind.${provider}.thinkingMode`;
}

function baseURLStorageKey(provider: Provider) {
  return `testmind.${provider}.baseURL`;
}

function reasoningEffortStorageKey(provider: Provider) {
  return `testmind.${provider}.reasoningEffort`;
}

function readStoredValue(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;

  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key: string, value: string) {
  if (typeof window === "undefined") return;

  try {
    const normalized = value.trim();
    if (normalized) {
      window.localStorage.setItem(key, normalized);
    } else {
      window.localStorage.removeItem(key);
    }
    window.dispatchEvent(new Event(storageChangeEvent));
  } catch {
    // Ignore storage errors such as private browsing quota restrictions.
  }
}

function useStoredValue(key: string, fallback: string) {
  return useSyncExternalStore(
    subscribeStorage,
    () => readStoredValue(key, fallback),
    () => fallback,
  );
}

function useStoredProvider() {
  return normalizeProvider(useStoredValue(storageKeys.provider, "deepseek"));
}

function subscribeClientReady() {
  return () => {};
}

function useClientReady() {
  return useSyncExternalStore(
    subscribeClientReady,
    () => true,
    () => false,
  );
}

type CustomSelectOption = {
  value: string;
  label: string;
  badge?: string;
  description?: string;
};

function CustomSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: CustomSelectOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <button
        aria-expanded={open}
        className={clsx(
          "mt-1 flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-left text-sm outline-none transition",
          open ? "border-teal-500 ring-2 ring-teal-100" : "border-slate-200 hover:border-slate-300",
        )}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-slate-900">{selected?.label}</span>
          {selected?.description ? <span className="mt-0.5 block truncate text-xs text-slate-400">{selected.description}</span> : null}
        </span>
        <ChevronDown className={clsx("size-4 shrink-0 text-slate-500 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
          <div className="max-h-72 overflow-y-auto">
            {options.map((item) => {
              const active = item.value === selected?.value;
              return (
                <button
                  key={item.value}
                  className={clsx(
                    "flex w-full items-start justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition",
                    active ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-50",
                  )}
                  type="button"
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{item.label}</span>
                      {item.badge ? (
                        <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-xs", active ? "bg-white/15 text-white" : "bg-teal-50 text-teal-700")}>
                          {item.badge}
                        </span>
                      ) : null}
                    </span>
                    {item.description ? <span className={clsx("mt-1 block text-xs leading-5", active ? "text-slate-300" : "text-slate-400")}>{item.description}</span> : null}
                  </span>
                  {active ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ProgressStatus = "idle" | "running" | "success" | "error" | "cancelled";

type ProgressLog = {
  id: string;
  type: "stage" | "thinking" | "error" | "cancelled";
  message: string;
  detail?: string;
};

type StreamEvent =
  | { type: "stage"; message: string; detail?: string }
  | { type: "thinking"; message: string; detail?: string }
  | { type: "chunk"; content: string }
  | { type: "result"; data: GenerateResponse }
  | { type: "error"; message: string; detail?: string }
  | { type: "done" };

function getNowMs() {
  return Date.now();
}

function useTicker(active: boolean) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(getNowMs()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  return now;
}

function GenerationProgressModal({
  elapsedMs,
  error,
  idleContentMs,
  idleEventMs,
  logs,
  onStop,
  onClose,
  open,
  status,
  streamPreview,
  totalChars,
}: {
  elapsedMs: number;
  error: string;
  idleContentMs: number;
  idleEventMs: number;
  logs: ProgressLog[];
  onStop: () => void;
  onClose: () => void;
  open: boolean;
  status: ProgressStatus;
  streamPreview: string;
  totalChars: number;
}) {
  const streamRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open || !streamRef.current) return;
    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [open, streamPreview]);

  if (!open) return null;

  const statusText: Record<ProgressStatus, string> = {
    idle: "等待",
    running: "生成中",
    success: "已完成",
    error: "失败",
    cancelled: "已停止",
  };
  const idleContentSeconds = Math.max(0, Math.round(idleContentMs / 1000));
  const idleEventSeconds = Math.max(0, Math.round(idleEventMs / 1000));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-slate-950 text-white">
              {status === "running" ? <Loader2 className="size-5 animate-spin" /> : <Terminal className="size-5" />}
            </div>
            <div>
              <h2 className="font-semibold">AI 生成过程</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {statusText[status]} · 已运行 {formatDuration(elapsedMs)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === "running" ? (
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
                type="button"
                onClick={onStop}
              >
                <Square className="size-3.5 fill-current" />
                停止运行
              </button>
            ) : null}
            <button
              aria-label={status === "running" ? "最小化" : "关闭"}
              className="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              type="button"
              onClick={onClose}
            >
              {status === "running" ? <Minimize2 className="size-5" /> : <X className="size-5" />}
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="min-h-0 overflow-y-auto rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">状态日志</h3>
              <span className="text-xs text-slate-500">{logs.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {logs.map((item) => (
                <div
                  key={item.id}
                  className={clsx(
                    "rounded-lg border bg-white p-3 text-sm",
                    item.type === "error"
                      ? "border-rose-200 text-rose-700"
                      : item.type === "cancelled"
                        ? "border-amber-200 text-amber-800"
                        : item.type === "thinking"
                        ? "border-amber-200 text-amber-800"
                        : "border-slate-200 text-slate-700",
                  )}
                >
                  <p className="font-medium">{item.message}</p>
                  {item.detail ? <p className="mt-1 break-words text-xs leading-5 text-slate-500">{item.detail}</p> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-0 min-w-0 flex-col rounded-lg bg-slate-950 p-3 text-slate-100">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">模型实时输出</h3>
              <span className="text-xs text-slate-400">
                已接收 {totalChars.toLocaleString("zh-CN")} / 展示最近 {streamPreview.length.toLocaleString("zh-CN")}
              </span>
            </div>
            <div className="mt-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs leading-5 text-slate-300">
              {status === "running" && idleContentMs > 15_000
                ? `已 ${idleContentSeconds} 秒没有收到可展示内容，模型可能仍在推理、排队或组织 JSON；连接仍在等待。`
                : `最近事件 ${idleEventSeconds} 秒前，实时输出会自动滚动到底部。`}
            </div>
            <pre ref={streamRef} className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/25 p-3 text-xs leading-5 text-slate-200">
              {streamPreview || "等待模型返回内容..."}
            </pre>
          </section>
        </div>

        {status === "error" || status === "cancelled" ? (
          <div
            className={clsx(
              "border-t px-5 py-3 text-sm",
              status === "cancelled" ? "border-amber-100 bg-amber-50 text-amber-800" : "border-rose-100 bg-rose-50 text-rose-700",
            )}
          >
            {error || (status === "cancelled" ? "已停止本次生成。" : "生成失败，请检查模型配置后重试。")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ApiKeyConfigSkeleton() {
  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <KeyRound className="size-4 text-teal-700" />
          API Key
        </div>
        <span className="h-6 w-20 animate-pulse rounded-full bg-white ring-1 ring-slate-200" />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-200">
        <span className="h-8 animate-pulse rounded-md bg-slate-100" />
        <span className="h-8 animate-pulse rounded-md bg-slate-100" />
        <span className="h-8 animate-pulse rounded-md bg-slate-100" />
        <span className="h-8 animate-pulse rounded-md bg-slate-100" />
      </div>
      <div className="mt-3 h-10 animate-pulse rounded-lg bg-white ring-1 ring-slate-200" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="h-5 w-28 animate-pulse rounded-md bg-white ring-1 ring-slate-100" />
        <span className="h-5 w-14 animate-pulse rounded-md bg-white ring-1 ring-slate-100" />
      </div>
      <div className="mt-3 h-10 animate-pulse rounded-lg bg-white ring-1 ring-slate-200" />
    </div>
  );
}

function DemoExperienceCard({ active, onLoad }: { active: boolean; onLoad: () => void }) {
  const moduleCount = new Set(demoGenerateResponse.cases.map((item) => item.module)).size;

  return (
    <div className="rounded-lg border border-teal-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
            <BookOpen className="size-4" />
            快速体验
          </div>
          <h2 className="mt-2 text-lg font-semibold tracking-normal">内嵌示例 PRD</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">不用上传 PDF，也不用填写 API Key，先看一份完整示例的生成效果。</p>
        </div>
        <span className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
          {demoGenerateResponse.cases.length} 条
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 border-y border-slate-200 py-3 text-sm">
        <div>
          <p className="text-xs text-slate-400">模块</p>
          <p className="mt-1 font-semibold text-slate-800">{moduleCount} 个</p>
        </div>
        <div className="border-l border-slate-200 pl-4">
          <p className="text-xs text-slate-400">覆盖类型</p>
          <p className="mt-1 font-semibold text-slate-800">5 类</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {demoPrdHighlights.slice(0, 3).map((item) => (
          <div key={item} className="grid grid-cols-[20px_1fr] gap-2 text-sm leading-6 text-slate-600">
            <ListChecks className="mt-1 size-4 text-teal-600" />
            <span>{item}</span>
          </div>
        ))}
      </div>

      <button
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
        type="button"
        onClick={onLoad}
      >
        <PlayCircle className="size-4" />
        {active ? "重新加载演示案例" : "一键体验演示案例"}
      </button>
    </div>
  );
}

function RunHistoryEntryCard({ count }: { count: number }) {
  return (
    <Link
      className="group flex min-h-14 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      href="/history"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-950 text-white">
          <Database className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800">查看运行记录</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{count ? `数据库已保存 ${count} 次生成结果` : "生成成功后会自动持久化到本地数据库"}</span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
    </Link>
  );
}

function formatCost(value?: number | null) {
  if (value === null || value === undefined) return "未估算";
  if (value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

function RunStatsPanel({ result }: { result: GenerateResponse | null }) {
  const stats = result?.stats;
  if (!stats) return null;

  const modules = stats.modules.slice(0, 10);
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
            <Clock3 className="size-4" />
            运行统计
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {providerLabels[stats.provider]} / {stats.model}
            {stats.thinkingMode ? ` / ${thinkingModeLabels[stats.thinkingMode]}` : ""}
            {stats.reasoningEffort ? ` / 推理${reasoningEffortLabels[stats.reasoningEffort]}` : ""}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <p className="text-xs text-slate-400">耗时</p>
            <p className="mt-1 font-semibold text-slate-800">{formatDuration(stats.durationMs)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <p className="text-xs text-slate-400">Token</p>
            <p className="mt-1 font-semibold text-slate-800">{formatTokens(stats.usage?.totalTokens)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <p className="text-xs text-slate-400">模块</p>
            <p className="mt-1 font-semibold text-slate-800">{stats.moduleCount} 个</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <p className="text-xs text-slate-400">估算费用</p>
            <p className="mt-1 font-semibold text-slate-800">{formatCost(stats.estimatedCostCny)}</p>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {modules.map((module) => (
          <span key={module.name} className="max-w-full rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
            <span className="break-words">{module.name}</span> · {module.caseCount} 条
          </span>
        ))}
        {stats.modules.length > modules.length ? (
          <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400 ring-1 ring-slate-200">
            还有 {stats.modules.length - modules.length} 个模块
          </span>
        ) : null}
      </div>
    </section>
  );
}

function AliyunModelConfig({
  model,
  onModelChange,
  onThinkingModeChange,
  thinkingMode,
}: {
  model: string;
  onModelChange: (value: string) => void;
  onThinkingModeChange: (value: ThinkingMode) => void;
  thinkingMode: ThinkingMode;
}) {
  const selected = getAliyunModelOption(model);
  const outputPrice = getAliyunOutputPrice(model, thinkingMode);

  return (
    <div className="mt-3 space-y-3">
      <CustomSelect
        label="模型选择"
        options={aliyunModelOptions.map((item) => ({
          value: item.id,
          label: item.id,
          badge: item.badge,
          description: item.suitableFor,
        }))}
        value={selected.id}
        onChange={onModelChange}
      />

      <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {selected.name}
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-100">{selected.badge}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{selected.description}</p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">适合：{selected.suitableFor}</p>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          参考单价：输入 ¥{selected.pricing.inputPerMTokens}/百万 Token，输出 ¥{outputPrice}/百万 Token，以阿里云账单为准。
        </p>
      </div>

      <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Brain className="size-4 text-teal-700" />
          生成模式
        </div>
        <div className="mt-3 grid grid-cols-2 rounded-lg bg-slate-50 p-1 ring-1 ring-slate-200">
          {(["fast", "quality"] as const).map((item) => (
            <button
              key={item}
              className={clsx(
                "min-h-8 rounded-md px-2 text-sm font-medium transition",
                thinkingMode === item ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white",
              )}
              type="button"
              onClick={() => onThinkingModeChange(item)}
            >
              {thinkingModeLabels[item]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{thinkingModeDescriptions[thinkingMode]}</p>
      </div>
    </div>
  );
}

function DeepSeekModelConfig({ model, onModelChange }: { model: string; onModelChange: (value: string) => void }) {
  const selected = getDeepSeekModelOption(model);

  return (
    <div className="mt-3 space-y-3">
      <CustomSelect
        label="模型选择"
        options={deepseekModelOptions.map((item) => ({
          value: item.id,
          label: item.id,
          badge: item.badge,
          description: item.suitableFor,
        }))}
        value={selected.id}
        onChange={onModelChange}
      />

      <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {selected.name}
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-100">{selected.badge}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{selected.description}</p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">适合：{selected.suitableFor}</p>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          参考单价：输入缓存命中 ¥{selected.pricing.inputCacheHitPerMTokens}/百万 Token，输入未命中 ¥{selected.pricing.inputCacheMissPerMTokens}/百万 Token，输出 ¥{selected.pricing.outputPerMTokens}/百万 Token。
        </p>
        {selected.pricing.discountedUntil ? (
          <p className="mt-1 text-xs leading-5 text-amber-700">
            当前为优惠价，优惠至 {selected.pricing.discountedUntil}；原价输入未命中 ¥{selected.pricing.originalInputCacheMissPerMTokens}/百万 Token，输出 ¥{selected.pricing.originalOutputPerMTokens}/百万 Token。
          </p>
        ) : null}
      </div>
    </div>
  );
}

function OpenAIModelConfig({ model, onModelChange }: { model: string; onModelChange: (value: string) => void }) {
  const selected = getOpenAIModelOption(model);

  return (
    <div className="mt-3 space-y-3">
      <CustomSelect
        label="模型选择"
        options={openaiModelOptions.map((item) => ({
          value: item.id,
          label: item.id,
          badge: item.badge,
          description: item.suitableFor,
        }))}
        value={selected.id}
        onChange={onModelChange}
      />

      <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {selected.name}
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-100">{selected.badge}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{selected.description}</p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">适合：{selected.suitableFor}</p>
        <p className="mt-2 text-xs leading-5 text-slate-400">{selected.pricingNote}</p>
      </div>
    </div>
  );
}

function ReasoningEffortConfig({
  reasoningEffort,
  onReasoningEffortChange,
}: {
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
}) {
  return (
    <div className="mt-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <Brain className="size-4 text-teal-700" />
        推理等级
      </div>
      <div className="mt-3">
        <CustomSelect
          label="智能"
          options={reasoningEffortOptions.map((item) => ({
            value: item,
            label: reasoningEffortLabels[item],
            badge: item === "medium" ? "默认" : undefined,
            description: reasoningEffortDescriptions[item],
          }))}
          value={reasoningEffort}
          onChange={(value) => onReasoningEffortChange(normalizeReasoningEffort(value))}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{reasoningEffortDescriptions[reasoningEffort]}</p>
    </div>
  );
}

function VelotricGatewayConfig({
  baseURL,
  model,
  onBaseURLChange,
  onModelChange,
}: {
  baseURL: string;
  model: string;
  onBaseURLChange: (value: string) => void;
  onModelChange: (value: string) => void;
}) {
  const selected = getVelotricModelOption(model);

  return (
    <div className="mt-3 space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-slate-500">公司网关地址</span>
        <input
          className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
          placeholder={providerBaseURLs.velotric}
          value={baseURL}
          spellCheck={false}
          onChange={(event) => onBaseURLChange(event.target.value)}
        />
      </label>

      <CustomSelect
        label="模型选择"
        options={velotricModelOptions.map((item) => ({
          value: item.id,
          label: item.id,
          badge: item.badge,
          description: item.suitableFor,
        }))}
        value={selected.id}
        onChange={onModelChange}
      />

      <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {selected.name}
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-100">{selected.badge}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{selected.description}</p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">适合：{selected.suitableFor}</p>
        <p className="mt-2 text-xs leading-5 text-slate-400">{selected.pricingNote}</p>
      </div>
    </div>
  );
}

function formatCoverageModuleName(module: CoverageModule) {
  if (!module.parent || module.name.includes(module.parent)) return module.name;
  return `${module.parent} / ${module.name}`;
}

function CoverageBlueprintPanel({ activeModule, result }: { activeModule: string; result: GenerateResponse | null }) {
  const blueprint = result?.coverageBlueprint;
  if (!blueprint) return null;

  const modules = activeModule === "全部" ? blueprint.modules : blueprint.modules.filter((module) => formatCoverageModuleName(module) === activeModule);
  const visibleModules = modules.length ? modules : blueprint.modules;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
            <ListChecks className="size-4" />
            覆盖蓝图
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-normal">
            {complexityLabels[blueprint.documentComplexity]} PRD · 计划 {blueprint.plannedCaseCount} 条
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{blueprint.coverageRationale}</p>
        </div>
        <span className="rounded-full bg-slate-50 px-3 py-1 text-sm text-slate-600 ring-1 ring-slate-200">{blueprint.modules.length} 个模块</span>
      </div>

      <div className="mt-5 divide-y divide-slate-200">
        {visibleModules.map((module) => {
          const moduleName = formatCoverageModuleName(module);
          return (
            <details key={moduleName} className="group py-4 first:pt-0 last:pb-0" open={activeModule !== "全部"}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{moduleName}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {complexityLabels[module.complexity]} · {riskLabels[module.riskLevel]} · {module.testPoints.length} 个测试点 · 计划 {module.targetCaseCount} 条
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => {
                    const count = module.categoryTargets[category] ?? 0;
                    if (!count) return null;
                    return (
                      <span key={category} className={clsx("rounded-full px-2.5 py-1 text-xs font-medium ring-1", categoryStyles[category])}>
                        {category} {count}
                      </span>
                    );
                  })}
                </div>
              </summary>

              {module.coverageNotes.length || module.skippedCategories.length ? (
                <div className="mt-3 space-y-1 text-sm leading-6 text-slate-500">
                  {module.coverageNotes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                  {module.skippedCategories.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
                {module.testPoints.map((point) => (
                  <div key={point.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800">{point.name}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{point.evidence}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                        {riskLabels[point.riskLevel]} · {point.expectedCaseCount} 条
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {categories.map((category) => {
                        const count = point.coverage[category] ?? 0;
                        if (!count) return null;
                        return (
                          <span key={category} className={clsx("rounded-full px-2 py-0.5 text-xs ring-1", categoryStyles[category])}>
                            {category} {count}
                          </span>
                        );
                      })}
                    </div>
                    {[point.fields, point.states, point.roles, point.rules, point.riskFactors].some((items) => items.length) ? (
                      <p className="mt-2 text-xs leading-5 text-slate-400">
                        {[point.fields.length ? `字段：${point.fields.join("、")}` : "", point.states.length ? `状态：${point.states.join("、")}` : "", point.roles.length ? `角色：${point.roles.join("、")}` : "", point.rules.length ? `规则：${point.rules.join("、")}` : "", point.riskFactors.length ? `风险：${point.riskFactors.join("、")}` : ""]
                          .filter(Boolean)
                          .join(" ｜ ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [activeModule, setActiveModule] = useState("全部");
  const [activeCategory, setActiveCategory] = useState<TestCategory | "全部">("全部");
  const [query, setQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [error, setError] = useState("");
  const isClientReady = useClientReady();
  const provider = useStoredProvider();
  const apiKey = useStoredValue(apiKeyStorageKey(provider), "");
  const model = useStoredValue(modelStorageKey(provider), providerModels[provider]);
  const baseURL = useStoredValue(baseURLStorageKey(provider), providerBaseURLs[provider] ?? "");
  const thinkingMode = normalizeThinkingMode(useStoredValue(thinkingModeStorageKey(provider), "fast"));
  const reasoningEffort = normalizeReasoningEffort(useStoredValue(reasoningEffortStorageKey(provider), "medium"));
  const runHistory = useRunHistory();
  const [showApiKey, setShowApiKey] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressStatus, setProgressStatus] = useState<ProgressStatus>("idle");
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [streamPreview, setStreamPreview] = useState("");
  const [receivedChars, setReceivedChars] = useState(0);
  const [progressError, setProgressError] = useState("");
  const [runStartedAt, setRunStartedAt] = useState(0);
  const [runCompletedAt, setRunCompletedAt] = useState(0);
  const [lastContentAt, setLastContentAt] = useState(0);
  const [lastEventAt, setLastEventAt] = useState(0);
  const now = useTicker(isLoading || progressOpen);
  const isDemoResult = result?.source === "demo";
  const sourceLabel = result?.source === "ai" ? "AI 生成" : isDemoResult ? "演示案例" : "本地可运行";
  const elapsedMs = runStartedAt ? (runCompletedAt || now || runStartedAt) - runStartedAt : 0;
  const idleContentMs = lastContentAt ? now - lastContentAt : elapsedMs;
  const idleEventMs = lastEventAt ? now - lastEventAt : elapsedMs;

  const visibleCases = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (result?.cases ?? []).filter((item) => {
      const template = getTemplateCaseFields(item);
      const moduleMatched = activeModule === "全部" || item.module === activeModule;
      const categoryMatched = activeCategory === "全部" || item.category === activeCategory;
      const textMatched =
        !normalized ||
        [
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
          .toLowerCase()
          .includes(normalized);
      return moduleMatched && categoryMatched && textMatched;
    });
  }, [activeCategory, activeModule, query, result]);

  const moduleCounts = useMemo(() => {
    const data: Record<string, number> = {};
    for (const item of result?.cases ?? []) data[item.module] = (data[item.module] ?? 0) + 1;
    return data;
  }, [result]);

  const moduleNames = useMemo(
    () => Object.keys(moduleCounts).sort((a, b) => moduleCounts[b] - moduleCounts[a] || a.localeCompare(b, "zh-CN")),
    [moduleCounts],
  );

  const categoryCounts = useMemo(() => {
    const data = Object.fromEntries(categories.map((category) => [category, 0])) as Record<TestCategory, number>;
    for (const item of result?.cases ?? []) {
      if (activeModule === "全部" || item.module === activeModule) data[item.category] += 1;
    }
    return data;
  }, [activeModule, result]);

  const groupedCases = useMemo(() => {
    const moduleOrder = new Map(moduleNames.map((moduleName, index) => [moduleName, index]));
    const data = new Map<string, TestCase[]>();
    for (const item of visibleCases) data.set(item.module, [...(data.get(item.module) ?? []), item]);
    return [...data.entries()]
      .sort((a, b) => (moduleOrder.get(a[0]) ?? 999) - (moduleOrder.get(b[0]) ?? 999))
      .map(([moduleName, cases]) => ({ moduleName, cases }));
  }, [moduleNames, visibleCases]);

  function pickFile(nextFile?: File) {
    if (!nextFile) return;
    setError("");
    setResult(null);
    setActiveModule("全部");
    setActiveCategory("全部");
    setFile(nextFile);
  }

  function clearSavedApiKey() {
    writeStoredValue(apiKeyStorageKey(provider), "");
  }

  function selectProvider(nextProvider: Provider) {
    writeStoredValue(storageKeys.provider, nextProvider);
    if (!readStoredValue(modelStorageKey(nextProvider), "")) {
      writeStoredValue(modelStorageKey(nextProvider), providerModels[nextProvider]);
    }
    if (!readStoredValue(thinkingModeStorageKey(nextProvider), "")) {
      writeStoredValue(thinkingModeStorageKey(nextProvider), "fast");
    }
    if (!readStoredValue(reasoningEffortStorageKey(nextProvider), "")) {
      writeStoredValue(reasoningEffortStorageKey(nextProvider), "medium");
    }
    if (providerBaseURLs[nextProvider] && !readStoredValue(baseURLStorageKey(nextProvider), "")) {
      writeStoredValue(baseURLStorageKey(nextProvider), providerBaseURLs[nextProvider]);
    }
  }

  function loadDemoCase() {
    setError("");
    setFile(null);
    setResult(demoGenerateResponse);
    setActiveModule("全部");
    setActiveCategory("全部");
    setQuery("");
    setProgressOpen(false);
    setProgressStatus("idle");
    setProgressError("");
    setStreamPreview("");
    setReceivedChars(0);
    setProgressLogs([]);
    setRunStartedAt(0);
    setRunCompletedAt(0);
    setLastContentAt(0);
    setLastEventAt(0);
  }

  async function exportExcel() {
    if (!result || isExportingExcel) return;

    setIsExportingExcel(true);
    setError("");
    try {
      await downloadExcel(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Excel 导出失败，请稍后重试。");
    } finally {
      setIsExportingExcel(false);
    }
  }

  async function generate() {
    if (isLoading) {
      setProgressOpen(true);
      return;
    }

    if (!isClientReady) {
      setError("正在读取本机保存的模型配置，请稍后再试。");
      return;
    }

    if (!file) {
      setError("请选择 PRD PDF。");
      return;
    }

    setIsLoading(true);
    const startedAt = getNowMs();
    setRunStartedAt(startedAt);
    setRunCompletedAt(0);
    setLastContentAt(0);
    setLastEventAt(startedAt);
    setError("");
    setProgressOpen(true);
    setProgressStatus("running");
    setProgressError("");
    setStreamPreview("");
    setReceivedChars(0);
    setProgressLogs([
      {
        id: "start",
        type: "stage",
        message: "准备开始生成",
        detail: `${providerLabels[provider]} / ${model.trim() || providerModels[provider]}${
          provider === "aliyun" ? ` / ${thinkingModeLabels[thinkingMode]}` : provider === "openai" || provider === "velotric" ? ` / 推理${reasoningEffortLabels[reasoningEffort]}` : ""
        }`,
      },
    ]);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("provider", provider);
    formData.append("model", model.trim() || providerModels[provider]);
    formData.append("thinkingMode", thinkingMode);
    formData.append("reasoningEffort", reasoningEffort);
    if (provider === "velotric") {
      formData.append("baseURL", baseURL.trim() || providerBaseURLs.velotric || "");
    }
    const trimmedApiKey = apiKey.trim();
    if (trimmedApiKey) {
      formData.append("apiKey", trimmedApiKey);
    }

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const response = await fetch("/api/generate/stream", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error("生成服务没有返回可读取的进度流。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: GenerateResponse | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "stage") {
            setLastEventAt(getNowMs());
            appendProgressLog("stage", event.message, event.detail);
          }
          if (event.type === "thinking") {
            setLastEventAt(getNowMs());
            appendProgressLog("thinking", event.message, event.detail);
          }
          if (event.type === "chunk") {
            const eventTime = getNowMs();
            setLastEventAt(eventTime);
            setLastContentAt(eventTime);
            setReceivedChars((current) => current + event.content.length);
            setStreamPreview((current) => `${current}${event.content}`.slice(-16_000));
          }
          if (event.type === "result") {
            setLastEventAt(getNowMs());
            finalResult = event.data;
            setResult(event.data);
          }
          if (event.type === "error") {
            appendProgressLog("error", event.message, event.detail);
            setProgressError(event.detail ? `${event.message} ${event.detail}` : event.message);
            throw new Error(event.message);
          }
        }
      }

      if (!finalResult) throw new Error("生成结束但没有收到测试用例结果。");

      await refreshRunHistory();
      setProgressStatus("success");
      setRunCompletedAt(getNowMs());
      setActiveModule("全部");
      setActiveCategory("全部");
      window.setTimeout(() => setProgressOpen(false), 900);
    } catch (caught) {
      const isAbort = caught instanceof Error && caught.name === "AbortError";
      const message = isAbort ? "已停止本次生成。" : caught instanceof Error ? caught.message : "生成失败";
      if (isAbort) {
        setError("");
        setProgressStatus("cancelled");
        setProgressError("已停止本次生成，运行日志会保存在历史记录中。");
        refreshRunHistory();
        window.setTimeout(() => refreshRunHistory(), 1500);
      } else {
        setError(message);
        setProgressStatus("error");
        setProgressError((current) => current || message);
      }
      setRunCompletedAt(getNowMs());
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }

  function stopGeneration() {
    if (!isLoading || !abortControllerRef.current) return;
    abortControllerRef.current.abort();
    setProgressStatus("cancelled");
    setProgressError("正在停止本次生成，停止前的运行日志会保存到历史记录。");
    setRunCompletedAt(getNowMs());
    appendProgressLog("cancelled", "已请求停止生成", "正在中断模型流式请求，后端会记录停止前的阶段和已生成内容。");
  }

  function appendProgressLog(type: ProgressLog["type"], message: string, detail?: string) {
    setProgressLogs((current) => {
      const nextLog = {
        id: `${Date.now()}-${Math.random()}`,
        type,
        message,
        detail,
      };

      if (message === "AI 正在持续生成" || message === "模型正在思考") {
        const existingIndex = current.findIndex((item) => item.message === message);
        if (existingIndex >= 0) {
          return current.map((item, index) => (index === existingIndex ? { ...item, detail } : item));
        }
      }

      return [...current, nextLog].slice(-40);
    });
  }

  return (
    <main className="min-h-screen bg-[#f7f4ef] text-slate-950">
      <GenerationProgressModal
        elapsedMs={elapsedMs}
        error={progressError}
        idleContentMs={idleContentMs}
        idleEventMs={idleEventMs}
        logs={progressLogs}
        onClose={() => setProgressOpen(false)}
        onStop={stopGeneration}
        open={progressOpen}
        status={progressStatus}
        streamPreview={streamPreview}
        totalChars={receivedChars}
      />

      {isLoading && !progressOpen ? (
        <button
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-3 rounded-lg bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-white shadow-xl ring-1 ring-white/10 transition hover:bg-slate-800"
          type="button"
          onClick={() => setProgressOpen(true)}
        >
          <Loader2 className="size-4 animate-spin" />
          <span>
            <span className="block">AI 正在生成</span>
            <span className="mt-0.5 block text-xs font-normal text-slate-300">已运行 {formatDuration(elapsedMs)}，点击查看过程</span>
          </span>
        </button>
      ) : null}

      <section className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-slate-950 text-white shadow-sm">
              <Bot className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">TestMind</h1>
              <p className="text-sm text-slate-500">PRD to Test Cases</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 sm:flex">
            <Sparkles className="size-4 text-teal-600" />
            {sourceLabel}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div
              className={clsx(
                "group grid min-h-56 cursor-pointer place-items-center rounded-lg border border-dashed p-6 text-center transition",
                isDragging ? "border-teal-500 bg-teal-50" : "border-slate-300 bg-slate-50 hover:border-slate-400",
              )}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                pickFile(event.dataTransfer.files[0]);
              }}
            >
              <input
                ref={inputRef}
                hidden
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => pickFile(event.target.files?.[0])}
              />
              <div className="space-y-4">
                <div className="mx-auto grid size-14 place-items-center rounded-lg bg-white text-teal-700 shadow-sm ring-1 ring-slate-200">
                  <UploadCloud className="size-7" />
                </div>
                <div>
                  <p className="font-medium">{file ? file.name : "上传 PRD PDF"}</p>
                  <p className="mt-1 text-sm text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "拖入文件或点击选择"}</p>
                </div>
              </div>
            </div>

            {isClientReady ? (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <KeyRound className="size-4 text-teal-700" />
                    API Key
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs text-slate-500 ring-1 ring-slate-200">
                    {providerLabels[provider]}
                  </span>
                </div>
                <div className="mt-3">
                  <CustomSelect
                    label="供应商"
                    options={providerOptions.map((item) => ({
                      value: item,
                      label: providerLabels[item],
                      badge: item === "velotric" ? "公司" : undefined,
                      description:
                        item === "velotric"
                          ? "走公司 GPT 号池网关"
                          : item === "aliyun"
                            ? "阿里云百炼兼容接口"
                            : item === "openai"
                              ? "OpenAI 官方 API"
                              : "DeepSeek 官方 API",
                    }))}
                    value={provider}
                    onChange={(value) => selectProvider(normalizeProvider(value))}
                  />
                </div>
                <div className="relative mt-3">
                  <input
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-11 text-sm outline-none transition focus:border-teal-500"
                    type={showApiKey ? "text" : "password"}
                    placeholder="sk-..."
                    value={apiKey}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => writeStoredValue(apiKeyStorageKey(provider), event.target.value)}
                  />
                  <button
                    aria-label={showApiKey ? "隐藏密钥" : "显示密钥"}
                    className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                    type="button"
                    onClick={() => setShowApiKey((current) => !current)}
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span>{apiKey.trim() ? "密钥已保存在本机浏览器" : "密钥未保存"}</span>
                  <button
                    className="rounded-md px-2 py-1 font-medium text-slate-600 transition hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:text-slate-300"
                    disabled={!apiKey.trim()}
                    type="button"
                    onClick={clearSavedApiKey}
                  >
                    清除密钥
                  </button>
                </div>
                {provider === "aliyun" ? (
                  <AliyunModelConfig
                    model={model}
                    thinkingMode={thinkingMode}
                    onModelChange={(value) => writeStoredValue(modelStorageKey(provider), value)}
                    onThinkingModeChange={(value) => writeStoredValue(thinkingModeStorageKey(provider), value)}
                  />
                ) : provider === "deepseek" ? (
                  <DeepSeekModelConfig
                    model={model}
                    onModelChange={(value) => writeStoredValue(modelStorageKey(provider), value)}
                  />
                ) : provider === "velotric" ? (
                  <>
                    <VelotricGatewayConfig
                      baseURL={baseURL}
                      model={model}
                      onBaseURLChange={(value) => writeStoredValue(baseURLStorageKey(provider), value)}
                      onModelChange={(value) => writeStoredValue(modelStorageKey(provider), value)}
                    />
                    <ReasoningEffortConfig
                      reasoningEffort={reasoningEffort}
                      onReasoningEffortChange={(value) => writeStoredValue(reasoningEffortStorageKey(provider), value)}
                    />
                  </>
                ) : (
                  <>
                    <OpenAIModelConfig
                      model={model}
                      onModelChange={(value) => writeStoredValue(modelStorageKey(provider), value)}
                    />
                    <ReasoningEffortConfig
                      reasoningEffort={reasoningEffort}
                      onReasoningEffortChange={(value) => writeStoredValue(reasoningEffortStorageKey(provider), value)}
                    />
                  </>
                )}
              </div>
            ) : (
              <ApiKeyConfigSkeleton />
            )}

            <button
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!isClientReady}
              onClick={generate}
            >
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {isLoading ? "正在 AI 生成，查看过程" : "生成测试用例"}
            </button>

            {error ? (
              <div className="mt-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <DemoExperienceCard active={isDemoResult} onLoad={loadDemoCase} />

          <RunHistoryEntryCard count={runHistory.length} />

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">模块</h2>
              <span className="text-sm text-slate-500">{result?.cases.length ?? 0} 条</span>
            </div>
            <div className="mt-4 grid gap-2">
              <button
                className={clsx(
                  "flex h-10 w-full max-w-full items-center justify-between rounded-lg px-3 text-sm transition",
                  activeModule === "全部" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100",
                )}
                onClick={() => setActiveModule("全部")}
              >
                <span>全部</span>
                <span className="shrink-0">{result?.cases.length ?? 0}</span>
              </button>
              {moduleNames.map((moduleName) => (
                <button
                  key={moduleName}
                  className={clsx(
                    "flex min-h-10 w-full max-w-full items-center justify-between gap-3 overflow-hidden rounded-lg px-3 py-2 text-left text-sm transition",
                    activeModule === moduleName ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100",
                  )}
                  onClick={() => setActiveModule(moduleName)}
                >
                  <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">{moduleName}</span>
                  <span className="shrink-0">{moduleCounts[moduleName]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">类型</h2>
              <span className="max-w-40 truncate text-sm text-slate-500">{activeModule}</span>
            </div>
            <div className="mt-4 grid gap-2">
              <button
                className={clsx(
                  "flex h-10 items-center justify-between rounded-lg px-3 text-sm transition",
                  activeCategory === "全部" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100",
                )}
                onClick={() => setActiveCategory("全部")}
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
                      "flex h-10 w-full max-w-full items-center justify-between rounded-lg px-3 text-sm transition",
                      activeCategory === category ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100",
                    )}
                    onClick={() => setActiveCategory(category)}
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
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-normal">测试用例</h2>
                <p className="mt-1 break-words text-sm text-slate-500">{result?.summary ?? "等待 PRD 解析"}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white sm:w-64"
                    placeholder="搜索"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  disabled={!result || isExportingExcel}
                  onClick={exportExcel}
                >
                  {isExportingExcel ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  Excel
                </button>
              </div>
            </div>

            {result?.warnings.length ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {result.warnings.join(" ")}
              </div>
            ) : null}
          </div>

          <RunStatsPanel result={result} />

          <CoverageBlueprintPanel activeModule={activeModule} result={result} />

          {groupedCases.length > 0 ? (
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
                      <CaseCard key={`${group.moduleName}-${item.id}-${caseIndex}`} item={item} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid min-h-96 place-items-center rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="max-w-md">
                <div className="mx-auto grid size-14 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                  <FileText className="size-7" />
                </div>
                <p className="mt-4 font-medium text-slate-700">暂无用例</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">可以先加载内嵌示例，快速体验模块筛选、类型筛选、搜索和导出效果。</p>
                <button
                  className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                  type="button"
                  onClick={loadDemoCase}
                >
                  <PlayCircle className="size-4" />
                  体验演示案例
                </button>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function CaseCard({ item }: { item: TestCase }) {
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

      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
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
