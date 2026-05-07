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
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileText,
  History,
  KeyRound,
  ListChecks,
  Loader2,
  Minimize2,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PlayCircle,
  Search,
  Shield,
  Sparkles,
  Square,
  Sun,
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
import { normalizeTestAgent } from "@/lib/test-agent";
import { getTemplateCaseFields } from "@/lib/testcase-template";
import type {
  AgentAnalysisItem,
  AgentAnalysisResponse,
  Complexity,
  CoverageModule,
  GenerateResponse,
  RiskLevel,
  TestAgentAnalysisType,
  TestAgentType,
  TestCase,
  TestCategory,
} from "@/types/test-case";

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
  activeAgent: "testmind.agent.active.v1",
  provider: "testmind.provider",
  theme: "testmind.theme.v1",
  leftRailCollapsed: "testmind.ui.leftRailCollapsed.v1",
  rightRailCollapsed: "testmind.ui.rightRailCollapsed.v1",
  modelPanelOpen: "testmind.ui.modelPanelOpen.v1",
  modulePanelOpen: "testmind.ui.modulePanelOpen.v1",
  categoryPanelOpen: "testmind.ui.categoryPanelOpen.v1",
};

const providerOptions: Provider[] = ["deepseek", "aliyun", "openai", "velotric"];

type ThemeMode = "light" | "dark" | "system";

const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "亮色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
  { value: "system", label: "系统", icon: Monitor },
];

const agentOptions: Array<{
  value: TestAgentType;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof FileText;
  actionLabel: string;
  placeholder: string;
}> = [
  {
    value: "requirement-review",
    label: "需求评审智能体",
    shortLabel: "评审",
    description: "提炼疑点、边界、异常、权限和测试风险。",
    icon: Brain,
    actionLabel: "开始需求评审",
    placeholder: "粘贴 PRD 片段、需求说明、评审纪要或产品变更描述。",
  },
  {
    value: "case-generator",
    label: "用例生成智能体",
    shortLabel: "用例",
    description: "解析 PRD PDF，生成覆盖蓝图和可导出的测试用例。",
    icon: FileText,
    actionLabel: "生成测试用例",
    placeholder: "",
  },
  {
    value: "release-risk",
    label: "发布风险智能体",
    shortLabel: "发布",
    description: "整理回归范围、冒烟清单、上线检查和风险项。",
    icon: Zap,
    actionLabel: "分析发布风险",
    placeholder: "粘贴发布说明、需求变更、Bug 列表、接口变更或 Git diff。",
  },
];

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

function useStoredAgent() {
  return normalizeTestAgent(useStoredValue(storageKeys.activeAgent, "case-generator"));
}

function isAnalysisAgent(agent: TestAgentType): agent is TestAgentAnalysisType {
  return agent !== "case-generator";
}

function writeStoredBoolean(key: string, value: boolean) {
  writeStoredValue(key, value ? "1" : "0");
}

function useStoredBoolean(key: string, fallback: boolean) {
  return useStoredValue(key, fallback ? "1" : "0") === "1";
}

function normalizeThemeMode(value: string): ThemeMode {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

function useThemeMode() {
  const themeMode = normalizeThemeMode(useStoredValue(storageKeys.theme, "system"));

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = themeMode === "dark" || (themeMode === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  return themeMode;
}

function subscribeClientReady(callback: () => void) {
  if (typeof window === "undefined") return () => {};

  const timeoutId = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timeoutId);
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
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <KeyRound className="size-4 text-teal-700" />
          密钥与模型
        </div>
        <span className="h-6 w-20 animate-pulse rounded-full bg-slate-100" />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-slate-50 p-1 ring-1 ring-slate-200">
        <span className="h-8 animate-pulse rounded-md bg-white" />
        <span className="h-8 animate-pulse rounded-md bg-white" />
        <span className="h-8 animate-pulse rounded-md bg-white" />
        <span className="h-8 animate-pulse rounded-md bg-white" />
      </div>
      <div className="mt-3 h-10 animate-pulse rounded-lg bg-slate-50 ring-1 ring-slate-200" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="h-5 w-28 animate-pulse rounded-md bg-slate-50" />
        <span className="h-5 w-14 animate-pulse rounded-md bg-slate-50" />
      </div>
      <div className="mt-3 h-10 animate-pulse rounded-lg bg-slate-50 ring-1 ring-slate-200" />
    </div>
  );
}

function DemoExperiencePopover({ active, open, onLoad, onOpenChange }: { active: boolean; open: boolean; onLoad: () => void; onOpenChange: (value: boolean) => void }) {
  const moduleCount = new Set(demoGenerateResponse.cases.map((item) => item.module)).size;
  const [isHovering, setIsHovering] = useState(false);

  return (
    <div
      className="group relative"
      onMouseEnter={() => {
        setIsHovering(true);
        onOpenChange(true);
      }}
      onMouseLeave={() => {
        setIsHovering(false);
        onOpenChange(false);
      }}
    >
      <button
        aria-expanded={open}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-100"
        type="button"
        onClick={() => onOpenChange(open && !isHovering ? false : true)}
      >
        <BookOpen className="size-4" />
        演示案例
        <span className="rounded-full bg-white px-1.5 py-0.5 text-xs text-teal-700 ring-1 ring-teal-200">{demoGenerateResponse.cases.length}</span>
      </button>

      <div
        className={clsx(
          "absolute right-0 top-full z-30 mt-2 w-[min(360px,calc(100vw-2rem))] rounded-lg border border-teal-200 bg-white p-4 text-left shadow-xl",
          open ? "block" : "hidden",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
              <BookOpen className="size-4" />
              快速体验
            </div>
            <h2 className="mt-2 text-base font-semibold tracking-normal">内嵌示例 PRD</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">不用上传 PDF 和 API Key，直接查看完整生成效果。</p>
          </div>
          <span className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
            {demoGenerateResponse.cases.length} 条
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 border-y border-teal-200/70 py-3 text-sm">
          <div>
            <p className="text-xs text-teal-700/70">模块</p>
            <p className="mt-1 font-semibold text-slate-800">{moduleCount} 个</p>
          </div>
          <div className="border-l border-teal-200/70 pl-4">
            <p className="text-xs text-teal-700/70">覆盖类型</p>
            <p className="mt-1 font-semibold text-slate-800">5 类</p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {demoPrdHighlights.slice(0, 3).map((item) => (
            <div key={item} className="grid grid-cols-[20px_1fr] gap-2 text-sm leading-6 text-slate-700">
              <ListChecks className="mt-1 size-4 text-teal-600" />
              <span>{item}</span>
            </div>
          ))}
        </div>

        <button
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          type="button"
          onClick={() => {
            onLoad();
            onOpenChange(false);
          }}
        >
          <PlayCircle className="size-4" />
          {active ? "重新加载演示案例" : "一键体验演示案例"}
        </button>
      </div>
    </div>
  );
}

function ThemeToggle({ value, onChange }: { value: ThemeMode; onChange: (value: ThemeMode) => void }) {
  return (
    <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      {themeOptions.map((item) => {
        const Icon = item.icon;
        const active = value === item.value;
        return (
          <button
            key={item.value}
            aria-label={`切换到${item.label}模式`}
            className={clsx(
              "grid size-8 place-items-center rounded-md text-slate-500 transition",
              active ? "bg-slate-950 text-white" : "hover:bg-slate-50 hover:text-slate-800",
            )}
            title={item.label}
            type="button"
            onClick={() => onChange(item.value)}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
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

      <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {selected.name}
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-100">{selected.badge}</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{selected.description} 适合：{selected.suitableFor}</p>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          参考单价：输入 ¥{selected.pricing.inputPerMTokens}/百万 Token，输出 ¥{outputPrice}/百万 Token，以阿里云账单为准。
        </p>
      </div>

      <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
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

      <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {selected.name}
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-100">{selected.badge}</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{selected.description} 适合：{selected.suitableFor}</p>
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

      <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {selected.name}
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-100">{selected.badge}</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{selected.description} 适合：{selected.suitableFor}</p>
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
    <div className="mt-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
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

      <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {selected.name}
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-100">{selected.badge}</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{selected.description} 适合：{selected.suitableFor}</p>
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

function AgentSwitcher({ value, onChange }: { value: TestAgentType; onChange: (value: TestAgentType) => void }) {
  return (
    <div className="grid gap-2">
      {agentOptions.map((item) => {
        const Icon = item.icon;
        const active = value === item.value;
        return (
          <button
            key={item.value}
            className={clsx(
              "flex min-h-16 w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition ring-1",
              active ? "bg-slate-950 text-white ring-slate-950" : "bg-slate-50 text-slate-700 ring-slate-200 hover:bg-teal-50 hover:text-teal-800 hover:ring-teal-200",
            )}
            type="button"
            onClick={() => onChange(item.value)}
          >
            <span className={clsx("grid size-9 shrink-0 place-items-center rounded-lg", active ? "bg-white/10 text-white" : "bg-white text-teal-700 ring-1 ring-slate-200")}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{item.label}</span>
              <span className={clsx("mt-1 block text-xs leading-5", active ? "text-slate-300" : "text-slate-500")}>{item.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function priorityBadgeClass(priority?: string) {
  if (priority === "P0") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (priority === "P1") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-slate-50 text-slate-600 ring-slate-200";
}

function AgentItem({ item }: { item: AgentAnalysisItem }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        {item.priority ? <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium ring-1", priorityBadgeClass(item.priority))}>{item.priority}</span> : null}
        {item.category ? <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">{item.category}</span> : null}
      </div>
      <h3 className="mt-2 break-words text-sm font-semibold text-slate-900">{item.title}</h3>
      <p className="mt-1 break-words text-sm leading-6 text-slate-600">{item.detail}</p>
      {item.evidence ? <p className="mt-2 break-words text-xs leading-5 text-slate-400">依据：{item.evidence}</p> : null}
      {item.suggestion ? <p className="mt-2 break-words text-xs leading-5 text-teal-700">建议：{item.suggestion}</p> : null}
    </div>
  );
}

function AgentAnalysisWorkspace({
  activeAgent,
  error,
  isRunning,
  result,
}: {
  activeAgent: TestAgentType;
  error: string;
  isRunning: boolean;
  result: AgentAnalysisResponse | null;
}) {
  const agent = agentOptions.find((item) => item.value === activeAgent) ?? agentOptions[1];
  const Icon = agent.icon;

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
              <Icon className="size-4" />
              {agent.label}
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal">{result?.title ?? "等待智能体分析"}</h2>
            <p className="mt-1 break-words text-sm leading-6 text-slate-500">{result?.summary ?? agent.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-700 ring-1 ring-teal-200">
              {result?.source === "ai" ? "AI 分析" : result?.source === "fallback" ? "本地规则" : "待运行"}
            </span>
            {result?.stats ? (
              <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                {providerLabels[result.stats.provider]} / {formatDuration(result.stats.durationMs)}
              </span>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mt-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      {isRunning ? (
        <div className="grid min-h-[360px] place-items-center rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div>
            <Loader2 className="mx-auto size-8 animate-spin text-teal-700" />
            <p className="mt-4 font-semibold text-slate-800">智能体分析中</p>
            <p className="mt-1 text-sm text-slate-500">正在整理风险、清单和下一步动作。</p>
          </div>
        </div>
      ) : result ? (
        <>
          {result.warnings.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {result.warnings.join(" ")}
            </div>
          ) : null}

          <div className="grid gap-4">
            {result.sections.map((section, sectionIndex) => (
              <section key={`${section.title}-${sectionIndex}`} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-1">
                  <h3 className="text-lg font-semibold tracking-normal">{section.title}</h3>
                  {section.description ? <p className="text-sm leading-6 text-slate-500">{section.description}</p> : null}
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {section.items.map((item, itemIndex) => (
                    <AgentItem key={`${section.title}-${item.title}-${itemIndex}`} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
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
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
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
        <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <div className="w-full max-w-xl">
            <div className="mx-auto grid size-14 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-200">
              <Icon className="size-7" />
            </div>
            <p className="mt-4 text-lg font-semibold text-slate-800">{agent.label}</p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{agent.description}</p>
          </div>
        </div>
      )}
    </>
  );
}

function AgentSidePanel({
  activeAgent,
  onAgentChange,
  result,
}: {
  activeAgent: TestAgentType;
  onAgentChange: (value: TestAgentType) => void;
  result: AgentAnalysisResponse | null;
}) {
  const agent = agentOptions.find((item) => item.value === activeAgent) ?? agentOptions[1];
  const sectionCount = result?.sections.length ?? 0;
  const itemCount = result?.sections.reduce((sum, section) => sum + section.items.length, 0) ?? 0;

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">工作台</h2>
        <p className="mt-0.5 text-xs text-slate-500">当前：{agent.shortLabel}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <AgentSwitcher value={activeAgent} onChange={onAgentChange} />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold">结果</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-400">分组</p>
            <p className="mt-1 font-semibold text-slate-800">{sectionCount}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-400">条目</p>
            <p className="mt-1 font-semibold text-slate-800">{itemCount}</p>
          </div>
        </div>
        {result?.nextActions.length ? (
          <div className="mt-3 space-y-2">
            {result.nextActions.slice(0, 5).map((item, index) => (
              <p key={`${item}-${index}`} className="break-words rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600 ring-1 ring-slate-200">
                {item}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

function moduleSectionId(moduleName: string) {
  let hash = 0;
  for (const char of moduleName) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `case-module-${hash.toString(36)}`;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingScrollModuleRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [activeModule, setActiveModule] = useState("全部");
  const [activeCategory, setActiveCategory] = useState<TestCategory | "全部">("全部");
  const [query, setQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [agentInput, setAgentInput] = useState("");
  const [agentResult, setAgentResult] = useState<AgentAnalysisResponse | null>(null);
  const isClientReady = useClientReady();
  const activeAgent = useStoredAgent();
  const provider = useStoredProvider();
  const apiKey = useStoredValue(apiKeyStorageKey(provider), "");
  const model = useStoredValue(modelStorageKey(provider), providerModels[provider]);
  const baseURL = useStoredValue(baseURLStorageKey(provider), providerBaseURLs[provider] ?? "");
  const thinkingMode = normalizeThinkingMode(useStoredValue(thinkingModeStorageKey(provider), "fast"));
  const reasoningEffort = normalizeReasoningEffort(useStoredValue(reasoningEffortStorageKey(provider), "medium"));
  const runHistory = useRunHistory();
  const [showApiKey, setShowApiKey] = useState(false);
  const themeMode = useThemeMode();
  const leftRailCollapsed = useStoredBoolean(storageKeys.leftRailCollapsed, false);
  const rightRailCollapsed = useStoredBoolean(storageKeys.rightRailCollapsed, false);
  const modelPanelOpen = useStoredBoolean(storageKeys.modelPanelOpen, false);
  const modulePanelOpen = useStoredBoolean(storageKeys.modulePanelOpen, true);
  const categoryPanelOpen = useStoredBoolean(storageKeys.categoryPanelOpen, true);
  const [demoDetailsOpen, setDemoDetailsOpen] = useState(false);
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
  const currentAgentOption = agentOptions.find((item) => item.value === activeAgent) ?? agentOptions[1];
  const analysisMode = isAnalysisAgent(activeAgent);
  const sourceLabel = result?.source === "ai" ? "AI 生成" : isDemoResult ? "演示案例" : "待生成";
  const elapsedMs = runStartedAt ? (runCompletedAt || now || runStartedAt) - runStartedAt : 0;
  const idleContentMs = lastContentAt ? now - lastContentAt : elapsedMs;
  const idleEventMs = lastEventAt ? now - lastEventAt : elapsedMs;
  const modelSummary = provider === "aliyun" ? thinkingModeLabels[thinkingMode] : `推理${reasoningEffortLabels[reasoningEffort]}`;
  const workspaceGridClass = leftRailCollapsed
    ? rightRailCollapsed
      ? "lg:grid-cols-[72px_minmax(0,1fr)_72px]"
      : "lg:grid-cols-[72px_minmax(0,1fr)_280px]"
    : rightRailCollapsed
      ? "lg:grid-cols-[370px_minmax(0,1fr)_72px]"
      : "lg:grid-cols-[370px_minmax(0,1fr)_280px]";

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

  useEffect(() => {
    const moduleName = pendingScrollModuleRef.current;
    if (!moduleName) return;

    pendingScrollModuleRef.current = null;
    window.setTimeout(() => {
      const target = moduleName === "全部" ? document.getElementById("case-results") : document.getElementById(moduleSectionId(moduleName));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, [groupedCases]);

  function scrollToCases(moduleName = activeModule) {
    window.setTimeout(() => {
      const target = moduleName === "全部" ? document.getElementById("case-results") : document.getElementById(moduleSectionId(moduleName));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function selectModule(moduleName: string) {
    pendingScrollModuleRef.current = moduleName;
    setActiveModule(moduleName);
    if (moduleName === activeModule) scrollToCases(moduleName);
  }

  function toggleStoredBoolean(key: string, current: boolean) {
    writeStoredBoolean(key, !current);
  }

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

  function selectAgent(nextAgent: TestAgentType) {
    writeStoredValue(storageKeys.activeAgent, nextAgent);
    setError("");
    setAgentError("");
    if (nextAgent !== activeAgent && isAnalysisAgent(nextAgent)) setAgentResult(null);
  }

  async function runAgentAnalysis() {
    if (!isAnalysisAgent(activeAgent)) {
      await generate();
      return;
    }

    if (isAgentRunning) return;

    if (!isClientReady) {
      setAgentError("正在读取本机保存的模型配置，请稍后再试。");
      return;
    }

    const input = agentInput.trim();
    if (input.length < 20) {
      setAgentError("请输入至少 20 个字符的分析材料。");
      return;
    }

    setIsAgentRunning(true);
    setAgentError("");
    try {
      const response = await fetch("/api/agents/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: activeAgent,
          input,
          provider,
          model: model.trim() || providerModels[provider],
          apiKey: apiKey.trim(),
          thinkingMode,
          reasoningEffort,
          ...(provider === "velotric" ? { baseURL: baseURL.trim() || providerBaseURLs.velotric || "" } : {}),
        }),
      });

      const payload = (await response.json().catch(() => null)) as AgentAnalysisResponse | { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload && "message" in payload && payload.message ? payload.message : "智能体分析失败，请稍后重试。");
      }

      setAgentResult(payload as AgentAnalysisResponse);
    } catch (caught) {
      setAgentError(caught instanceof Error ? caught.message : "智能体分析失败，请稍后重试。");
    } finally {
      setIsAgentRunning(false);
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
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950">
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

      <section className="border-b border-slate-200/80 bg-white/90 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-5 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-slate-950 text-white shadow-sm ring-1 ring-slate-900/10">
              <Bot className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">TestMind</h1>
              <p className="text-sm text-slate-500">AI 测试智能体工作台</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isLoading ? (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-100"
                type="button"
                onClick={() => setProgressOpen(true)}
              >
                <Loader2 className="size-4 animate-spin" />
                已运行 {formatDuration(elapsedMs)}
              </button>
            ) : null}
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              href="/history"
              title={runHistory.length ? `数据库已保存 ${runHistory.length} 次生成结果` : "查看运行记录"}
            >
              <History className="size-4" />
              运行记录
            </Link>
            <button
              aria-label={leftRailCollapsed ? "展开左侧生成配置" : "收起左侧生成配置"}
              className="grid size-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
              title={leftRailCollapsed ? "展开左栏" : "收起左栏"}
              type="button"
              onClick={() => toggleStoredBoolean(storageKeys.leftRailCollapsed, leftRailCollapsed)}
            >
              {leftRailCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
            <button
              aria-label={rightRailCollapsed ? "展开右侧目录栏" : "收起右侧目录栏"}
              className="grid size-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
              title={rightRailCollapsed ? "展开右栏" : "收起右栏"}
              type="button"
              onClick={() => toggleStoredBoolean(storageKeys.rightRailCollapsed, rightRailCollapsed)}
            >
              {rightRailCollapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
            </button>
            <ThemeToggle value={themeMode} onChange={(value) => writeStoredValue(storageKeys.theme, value)} />
          </div>
        </div>
      </section>

      <section className={clsx("mx-auto grid max-w-[1600px] grid-cols-1 gap-5 px-5 py-5 transition-[grid-template-columns] sm:px-8", workspaceGridClass)}>
        <aside className="min-w-0">
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
          {leftRailCollapsed ? (
            <div className="sticky top-5 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
              <div className="flex items-center justify-center gap-2 lg:flex-col">
                <button
                  aria-label="展开生成配置"
                  className="grid size-11 place-items-center rounded-lg bg-slate-950 text-white transition hover:bg-slate-800"
                  title="展开生成配置"
                  type="button"
                  onClick={() => writeStoredBoolean(storageKeys.leftRailCollapsed, false)}
                >
                  <PanelLeftOpen className="size-4" />
                </button>
                {agentOptions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.value}
                      aria-label={item.label}
                      className={clsx(
                        "grid size-11 place-items-center rounded-lg border transition",
                        activeAgent === item.value ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-slate-50 text-slate-600 hover:text-teal-700",
                      )}
                      title={item.label}
                      type="button"
                      onClick={() => selectAgent(item.value)}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
                {!analysisMode ? (
                  <button
                    aria-label="上传 PRD"
                    className={clsx(
                      "grid size-11 place-items-center rounded-lg border transition",
                      file ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-slate-50 text-slate-600 hover:text-teal-700",
                    )}
                    title={file ? file.name : "上传 PRD"}
                    type="button"
                    onClick={() => inputRef.current?.click()}
                  >
                    <UploadCloud className="size-4" />
                  </button>
                ) : null}
                <button
                  aria-label="展开密钥与模型"
                  className={clsx(
                    "grid size-11 place-items-center rounded-lg border transition",
                    apiKey.trim() ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-slate-50 text-slate-600 hover:text-teal-700",
                  )}
                  title={`${providerLabels[provider]} / ${model} / ${apiKey.trim() ? "密钥已就绪" : "密钥未保存"}`}
                  type="button"
                  onClick={() => {
                    writeStoredBoolean(storageKeys.leftRailCollapsed, false);
                    writeStoredBoolean(storageKeys.modelPanelOpen, true);
                  }}
                >
                  <KeyRound className="size-4" />
                </button>
                <button
                  aria-label={currentAgentOption.actionLabel}
                  className="grid size-11 place-items-center rounded-lg bg-teal-700 text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={!isClientReady || (analysisMode && isAgentRunning)}
                  title={analysisMode ? currentAgentOption.actionLabel : isLoading ? "查看生成过程" : "生成测试用例"}
                  type="button"
                  onClick={analysisMode ? runAgentAnalysis : generate}
                >
                  {isLoading || isAgentRunning ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                </button>
              </div>
            </div>
          ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">智能体配置</h2>
                <p className="mt-0.5 text-xs text-slate-500">{currentAgentOption.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                  {analysisMode ? "文本" : "PDF"}
                </span>
                <button
                  aria-label="收起生成配置"
                  className="grid size-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                  title="收起左栏"
                  type="button"
                  onClick={() => writeStoredBoolean(storageKeys.leftRailCollapsed, true)}
                >
                  <PanelLeftClose className="size-4" />
                </button>
              </div>
            </div>
            <AgentSwitcher value={activeAgent} onChange={selectAgent} />

            {!analysisMode ? (
              <div
                className={clsx(
                  "group mt-4 grid min-h-44 cursor-pointer place-items-center rounded-lg border border-dashed p-5 text-center transition",
                  isDragging ? "border-teal-500 bg-teal-50" : "border-slate-300 bg-slate-50/80 hover:border-teal-400 hover:bg-teal-50/30",
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
                <div className="space-y-4">
                  <div className="mx-auto grid size-12 place-items-center rounded-lg bg-white text-teal-700 shadow-sm ring-1 ring-slate-200 transition group-hover:-translate-y-0.5">
                    <UploadCloud className="size-6" />
                  </div>
                  <div>
                    <p className="break-words font-semibold">{file ? file.name : "上传 PRD PDF"}</p>
                    <p className="mt-1 text-sm text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "拖入文件或点击选择"}</p>
                  </div>
                </div>
              </div>
            ) : (
              <label className="mt-4 block">
                <span className="text-xs font-medium text-slate-500">分析材料</span>
                <textarea
                  className="mt-1 min-h-64 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 outline-none transition focus:border-teal-500 focus:bg-white"
                  placeholder={currentAgentOption.placeholder}
                  value={agentInput}
                  onChange={(event) => {
                    setAgentInput(event.target.value);
                    setAgentError("");
                  }}
                />
              </label>
            )}

            {isClientReady ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                <button
                  aria-expanded={modelPanelOpen}
                  className="flex w-full items-center justify-between gap-3 text-left"
                  type="button"
                  onClick={() => toggleStoredBoolean(storageKeys.modelPanelOpen, modelPanelOpen)}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <KeyRound className="size-4 text-teal-700" />
                      密钥与模型
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {providerLabels[provider]} / {model || providerModels[provider]} / {modelSummary} / {apiKey.trim() ? "密钥已就绪" : "密钥未保存"}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-slate-50 px-2 py-1 text-xs text-slate-500 ring-1 ring-slate-200">
                      {providerLabels[provider]}
                    </span>
                    <ChevronDown className={clsx("size-4 text-slate-500 transition", modelPanelOpen && "rotate-180")} />
                  </div>
                </button>
                {modelPanelOpen ? (
                  <>
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
                  </>
                ) : null}
              </div>
            ) : (
              <ApiKeyConfigSkeleton />
            )}

            <button
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!isClientReady || (analysisMode && isAgentRunning)}
              onClick={analysisMode ? runAgentAnalysis : generate}
            >
              {isLoading || isAgentRunning ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {analysisMode ? (isAgentRunning ? "智能体分析中" : currentAgentOption.actionLabel) : isLoading ? "正在 AI 生成，查看过程" : "生成测试用例"}
            </button>

            {(analysisMode ? agentError : error) ? (
              <div className="mt-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{analysisMode ? agentError : error}</span>
              </div>
            ) : null}
          </div>
          )}
        </aside>

        <section id="case-results" className="min-w-0 space-y-4">
          {analysisMode ? (
            <AgentAnalysisWorkspace activeAgent={activeAgent} error={agentError} isRunning={isAgentRunning} result={agentResult} />
          ) : (
            <>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-normal">测试用例</h2>
                <p className="mt-1 break-words text-sm text-slate-500">{result?.summary ?? "等待 PRD 解析"}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                    当前可见 {visibleCases.length} 条
                  </span>
                  <span className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-700 ring-1 ring-teal-200">
                    {sourceLabel}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DemoExperiencePopover active={isDemoResult} open={demoDetailsOpen} onLoad={loadDemoCase} onOpenChange={setDemoDetailsOpen} />
                <label className="relative block min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white"
                    placeholder="搜索"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <button
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
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
                <section id={moduleSectionId(group.moduleName)} key={`${group.moduleName}-${groupIndex}`} className="scroll-mt-24 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
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
            <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
              <div className="w-full max-w-2xl">
                <div className="mx-auto grid size-14 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-200">
                  <FileText className="size-7" />
                </div>
                <p className="mt-4 text-lg font-semibold text-slate-800">还没有生成测试用例</p>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
                  从左侧上传 PRD、确认模型配置后开始生成；也可以先加载演示案例，快速查看筛选、覆盖蓝图和 Excel 导出效果。
                </p>
                <div className="mt-6 grid gap-3 text-left sm:grid-cols-3">
                  {[
                    { icon: UploadCloud, title: "上传 PRD", desc: file ? "已选择文档" : "支持 PDF 文本层" },
                    { icon: KeyRound, title: "配置模型", desc: apiKey.trim() ? "密钥已就绪" : "可使用本地兜底" },
                    { icon: Sparkles, title: "生成用例", desc: "按模块覆盖缺口" },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.title} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                        <Icon className="size-4 text-teal-700" />
                        <p className="mt-2 text-sm font-semibold text-slate-800">{item.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.desc}</p>
                      </div>
                    );
                  })}
                </div>
                <button
                  className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                  type="button"
                  onClick={loadDemoCase}
                >
                  <PlayCircle className="size-4" />
                  体验演示案例
                </button>
              </div>
            </div>
          )}
            </>
          )}
        </section>
        <aside className="min-w-0">
          <div className="sticky top-5 space-y-3">
            {rightRailCollapsed ? (
              <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                <div className="flex items-center justify-center gap-2 lg:flex-col">
                  <button
                    aria-label="展开目录面板"
                    className="grid size-11 place-items-center rounded-lg bg-slate-950 text-white transition hover:bg-slate-800"
                    title="展开目录"
                    type="button"
                    onClick={() => writeStoredBoolean(storageKeys.rightRailCollapsed, false)}
                  >
                    <PanelRightOpen className="size-4" />
                  </button>
                  <button
                    aria-label="查看模块目录"
                    className="grid size-11 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:text-teal-700"
                    title={`模块 ${moduleNames.length} 个`}
                    type="button"
                    onClick={() => {
                      writeStoredBoolean(storageKeys.rightRailCollapsed, false);
                      writeStoredBoolean(storageKeys.modulePanelOpen, true);
                    }}
                  >
                    <ListChecks className="size-4" />
                  </button>
                  <button
                    aria-label="查看类型筛选"
                    className="grid size-11 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:text-teal-700"
                    title={`当前类型：${activeCategory}`}
                    type="button"
                    onClick={() => {
                      writeStoredBoolean(storageKeys.rightRailCollapsed, false);
                      writeStoredBoolean(storageKeys.categoryPanelOpen, true);
                    }}
                  >
                    <Shield className="size-4" />
                  </button>
                </div>
              </div>
            ) : analysisMode ? (
              <AgentSidePanel activeAgent={activeAgent} result={agentResult} onAgentChange={selectAgent} />
            ) : (
              <>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">目录</h2>
                      <p className="mt-0.5 text-xs text-slate-500">模块跳转与类型筛选</p>
                    </div>
                    <button
                      aria-label="收起目录面板"
                      className="grid size-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                      title="收起右栏"
                      type="button"
                      onClick={() => writeStoredBoolean(storageKeys.rightRailCollapsed, true)}
                    >
                      <PanelRightClose className="size-4" />
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <button
                    aria-expanded={modulePanelOpen}
                    className="flex w-full items-center justify-between gap-3 text-left"
                    type="button"
                    onClick={() => toggleStoredBoolean(storageKeys.modulePanelOpen, modulePanelOpen)}
                  >
                    <span>
                      <span className="block font-semibold">模块</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{result?.cases.length ?? 0} 条 · {moduleNames.length} 个模块</span>
                    </span>
                    <ChevronDown className={clsx("size-4 text-slate-500 transition", modulePanelOpen && "rotate-180")} />
                  </button>
                  {modulePanelOpen ? (
                    <div className="mt-3 grid max-h-[42vh] gap-1.5 overflow-y-auto pr-1">
                      <button
                        className={clsx(
                          "flex h-9 w-full max-w-full items-center justify-between rounded-lg px-3 text-sm transition",
                          activeModule === "全部" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                        )}
                        type="button"
                        onClick={() => selectModule("全部")}
                      >
                        <span>全部</span>
                        <span className="shrink-0">{result?.cases.length ?? 0}</span>
                      </button>
                      {moduleNames.map((moduleName) => (
                        <button
                          key={moduleName}
                          className={clsx(
                            "flex min-h-9 w-full max-w-full items-center justify-between gap-3 overflow-hidden rounded-lg px-3 py-2 text-left text-sm transition",
                            activeModule === moduleName ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                          )}
                          type="button"
                          onClick={() => selectModule(moduleName)}
                        >
                          <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">{moduleName}</span>
                          <span className="shrink-0">{moduleCounts[moduleName]}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <button
                    aria-expanded={categoryPanelOpen}
                    className="flex w-full items-center justify-between gap-3 text-left"
                    type="button"
                    onClick={() => toggleStoredBoolean(storageKeys.categoryPanelOpen, categoryPanelOpen)}
                  >
                    <span>
                      <span className="block font-semibold">类型</span>
                      <span className="mt-0.5 block max-w-48 truncate text-xs text-slate-500">{activeModule} / {activeCategory}</span>
                    </span>
                    <ChevronDown className={clsx("size-4 text-slate-500 transition", categoryPanelOpen && "rotate-180")} />
                  </button>
                  {categoryPanelOpen ? (
                    <div className="mt-3 grid gap-1.5">
                      <button
                        className={clsx(
                          "flex h-9 items-center justify-between rounded-lg px-3 text-sm transition",
                          activeCategory === "全部" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                        )}
                        type="button"
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
                              "flex h-9 w-full max-w-full items-center justify-between rounded-lg px-3 text-sm transition",
                              activeCategory === category ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800",
                            )}
                            type="button"
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
                  ) : null}
                </div>
              </>
            )}
          </div>
        </aside>
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
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
          <h3 className="mt-3 text-base font-semibold leading-snug text-slate-900">{item.title}</h3>
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

      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.2fr_1fr]">
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
