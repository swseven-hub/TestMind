"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileQuestion,
  FileText,
  GitPullRequest,
  History,
  KeyRound,
  ListChecks,
  Loader2,
  Lock,
  Minimize2,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Plus,
  ServerCog,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Unlock,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { demoGenerateResponse, demoPrdHighlights } from "@/lib/demo-test-cases";
import { downloadExcel } from "@/lib/download-excel";
import { generationProfileConfigs, generationProfiles, normalizeGenerationProfile } from "@/lib/generation-profile";
import {
  normalizeProvider,
  normalizeThinkingMode,
  providerBaseURLs,
  providerLabels,
  providerModels,
  reasoningEffortLabels,
  thinkingModeLabels,
  type Provider,
  normalizeReasoningEffort,
} from "@/lib/model-config";
import {
  formatDuration,
  formatRunTime,
  formatTokens,
  isAnalysisRunHistoryRecord,
  refreshRunHistory,
  storageChangeEvent,
  subscribeStorage,
  useRunHistory,
  type RunHistoryRecord,
} from "@/lib/run-history";
import { normalizeTestAgent } from "@/lib/test-agent";
import type {
  AgentAnalysisItem,
  AgentAnalysisResponse,
  Complexity,
  CoverageBlueprint,
  CoverageModule,
  GenerateResponse,
  RequirementUncertainty,
  RiskLevel,
  TestAgentAnalysisType,
  TestAgentType,
  TestCategory,
  TestDataRequirement,
  TestDesignTechnique,
  TestEnvironmentRequirement,
} from "@/types/test-case";

const categories: TestCategory[] = ["功能", "边界", "异常", "权限", "性能"];
const designTechniqueOptions: TestDesignTechnique[] = ["等价类", "边界值", "判定表", "状态迁移", "流程分支", "权限矩阵", "组合覆盖", "接口契约", "幂等", "并发", "回滚"];
const complexityOptions: Complexity[] = ["minimal", "simple", "medium", "complex", "large"];
const riskOptions: RiskLevel[] = ["low", "medium", "high", "critical"];
const environmentTypeOptions: TestEnvironmentRequirement["type"][] = ["账号", "角色", "配置", "状态", "依赖服务", "第三方", "数据", "其他"];
const uncertaintyTypeOptions: RequirementUncertainty["type"][] = ["无法确定的规则", "需要产品确认的问题", "基于假设生成"];
const analysisFileAccept = ".pdf,.txt,.log,.md,.json,.jsonl,.csv,.tsv,.yaml,.yml,.xml,.har,.diff,.patch,.sql,.proto,.ts,.tsx,.js,.jsx,.java,.kt,.py,.go,.swift,.c,.cpp,.h";

const categoryStyles: Record<TestCategory, string> = {
  功能: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  边界: "bg-amber-50 text-amber-700 ring-amber-200",
  异常: "bg-rose-50 text-rose-700 ring-rose-200",
  权限: "bg-sky-50 text-sky-700 ring-sky-200",
  性能: "bg-violet-50 text-violet-700 ring-violet-200",
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
  generationProfile: "testmind.caseGenerator.profile.v1",
  provider: "testmind.provider",
  theme: "testmind.theme.v1",
  leftRailCollapsed: "testmind.ui.leftRailCollapsed.v1",
};

const currentCaseReportStorageKey = "testmind.currentCaseReport.v1";
const currentAgentAnalysisStorageKey = "testmind.currentAgentAnalysis.v1";

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
    label: "需求分析智能体",
    shortLabel: "需求",
    description: "上传 PRD PDF，按模块提取功能点、测试点和测试注意事项。",
    icon: Brain,
    actionLabel: "分析 PRD PDF",
    placeholder: "",
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
  {
    value: "change-impact",
    label: "变更影响智能体",
    shortLabel: "变更",
    description: "分析 git diff / PR，判断影响范围、接口风险和回归重点。",
    icon: GitPullRequest,
    actionLabel: "分析变更影响",
    placeholder: "粘贴 git diff、PR 描述、提交记录，或变更文件列表。可附上历史缺陷/事故摘要。",
  },
  {
    value: "debug-assistant",
    label: "Bug 根因智能体",
    shortLabel: "Debug",
    description: "分析日志、堆栈、请求和 diff，定位疑似根因与修复方向。",
    icon: Terminal,
    actionLabel: "分析 Bug 根因",
    placeholder: "粘贴 stacktrace、error log、request、response、traceId、git diff、commit 记录或复现步骤。",
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

function writeCurrentCaseReport(result: GenerateResponse) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(currentCaseReportStorageKey, JSON.stringify(result));
  } catch {
    // Large reports may exceed the browser storage quota; the SQLite record remains the primary detail source.
  }
}

function writeCurrentAgentAnalysis(result: AgentAnalysisResponse) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(currentAgentAnalysisStorageKey, JSON.stringify(result));
  } catch {
    // Analysis reports are kept in page state if sessionStorage quota is unavailable.
  }
}

function getCaseDetailHref(result: GenerateResponse) {
  if (result.source === "demo") return "/cases/demo";
  if (result.historyId) return `/cases/${encodeURIComponent(result.historyId)}`;
  return "/cases/current";
}

function getAnalysisDetailHref(result: AgentAnalysisResponse) {
  if (result.historyId) return `/analysis/${encodeURIComponent(result.historyId)}`;
  return `/analysis/${encodeURIComponent(result.agent)}`;
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

function useStoredGenerationProfile() {
  return normalizeGenerationProfile(useStoredValue(storageKeys.generationProfile, "standard"));
}

function isAnalysisAgent(agent: TestAgentType): agent is TestAgentAnalysisType {
  return agent !== "case-generator";
}

function agentInputKind(agent: TestAgentType) {
  return agent === "requirement-review" || agent === "case-generator" ? "PDF" : "文本";
}

const runHistoryStatusLabels = {
  running: "运行中",
  success: "成功",
  failed: "失败",
  cancelled: "已停止",
};

const runHistoryStatusStyles = {
  running: "bg-sky-50 text-sky-700 ring-sky-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  cancelled: "bg-amber-50 text-amber-700 ring-amber-200",
};

function getRunHistoryHref(record: RunHistoryRecord) {
  if (isAnalysisRunHistoryRecord(record)) return `/analysis/${encodeURIComponent(record.id)}`;
  return `/cases/${encodeURIComponent(record.id)}`;
}

function getRunHistoryTitle(record: RunHistoryRecord) {
  if (isAnalysisRunHistoryRecord(record)) return record.analysisResult.title || record.fileName;
  return record.fileName;
}

function getRunHistoryCountLabel(record: RunHistoryRecord) {
  if (isAnalysisRunHistoryRecord(record)) return `${record.caseCount} 项分析`;
  return `${record.caseCount} 条测试点`;
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

type ProgressStatus = "idle" | "running" | "success" | "error" | "cancelled";

type ProgressLog = {
  id: string;
  type: "stage" | "thinking" | "error" | "cancelled";
  message: string;
  detail?: string;
};

type GenerateStreamEvent =
  | { type: "stage"; message: string; detail?: string }
  | { type: "thinking"; message: string; detail?: string }
  | { type: "chunk"; content: string }
  | { type: "result"; data: GenerateResponse }
  | { type: "error"; message: string; detail?: string }
  | { type: "done" };

type AgentAnalysisStreamEvent =
  | { type: "stage"; message: string; detail?: string }
  | { type: "thinking"; message: string; detail?: string }
  | { type: "chunk"; content: string }
  | { type: "result"; data: AgentAnalysisResponse }
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
  title = "AI 生成过程",
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
  title?: string;
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
    running: "运行中",
    success: "已完成",
    error: "失败",
    cancelled: "已停止",
  };
  const idleContentSeconds = Math.max(0, Math.round(idleContentMs / 1000));
  const idleEventSeconds = Math.max(0, Math.round(idleEventMs / 1000));
  const completionMessage = title.includes("分析") ? "AI 分析已完成，结果已整理在页面中。" : "AI 生成已完成，报告概览已更新。";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-slate-950 text-white">
              {status === "running" ? <Loader2 className="size-5 animate-spin" /> : <Terminal className="size-5" />}
            </div>
            <div>
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {statusText[status]} · 已运行 {formatDuration(elapsedMs)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status === "success" ? (
              <div className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 shadow-sm">
                <CheckCircle2 className="size-4" />
                {completionMessage}
              </div>
            ) : null}
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

function formatCoverageModuleName(module: CoverageModule) {
  if (!module.parent || module.name.includes(module.parent)) return module.name;
  return `${module.parent} / ${module.name}`;
}

function clampStrategyCount(value: number) {
  return Math.min(160, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}

function readCount(value: string) {
  const parsed = Number.parseInt(value, 10);
  return clampStrategyCount(Number.isFinite(parsed) ? parsed : 0);
}

function sumCoverageTargets(targets: Partial<Record<TestCategory, number>> | undefined) {
  return categories.reduce((sum, category) => sum + clampStrategyCount(targets?.[category] ?? 0), 0);
}

function splitListValue(value: string) {
  return value
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinListValue(values: string[] | undefined) {
  return (values ?? []).join("、");
}

function buildNewTestData(index: number): TestDataRequirement {
  return {
    id: `TD-NEW-${String(index + 1).padStart(2, "0")}`,
    name: "新测试数据",
    scope: "适用模块",
    values: [],
    setup: "预置测试数据",
    cleanup: "清理测试数据",
  };
}

function buildNewEnvironment(index: number): TestEnvironmentRequirement {
  return {
    id: `ENV-NEW-${String(index + 1).padStart(2, "0")}`,
    name: "新环境依赖",
    type: "其他",
    description: "待补充依赖说明",
    dependencies: [],
    setup: "确认依赖可用",
    cleanup: "恢复环境配置",
  };
}

function buildNewUncertainty(index: number): RequirementUncertainty {
  return {
    id: `UNC-NEW-${String(index + 1).padStart(2, "0")}`,
    type: "需要产品确认的问题",
    title: "待确认规则",
    detail: "PRD 暂未说明该规则。",
    impact: "影响测试用例预期和边界覆盖。",
    question: "请确认该规则的准确口径。",
  };
}

function normalizeStrategyModule(module: CoverageModule): CoverageModule {
  const targetCaseCount = Math.max(1, sumCoverageTargets(module.categoryTargets) || module.targetCaseCount || module.testPoints.reduce((sum, point) => sum + (point.expectedCaseCount || sumCoverageTargets(point.coverage)), 0));
  return {
    ...module,
    targetCaseCount,
    categoryTargets: Object.fromEntries(categories.map((category) => [category, clampStrategyCount(module.categoryTargets?.[category] ?? 0)])) as Record<TestCategory, number>,
    designTechniques: module.designTechniques ?? [],
    testData: module.testData ?? [],
    environment: module.environment ?? [],
    uncertainties: module.uncertainties ?? [],
    testPoints: module.testPoints.map((point) => ({
      ...point,
      expectedCaseCount: Math.max(1, point.expectedCaseCount || sumCoverageTargets(point.coverage)),
      coverage: Object.fromEntries(categories.map((category) => [category, clampStrategyCount(point.coverage?.[category] ?? 0)])) as Record<TestCategory, number>,
      designTechniques: point.designTechniques ?? [],
    })),
  };
}

function recalculateStrategy(blueprint: CoverageBlueprint): CoverageBlueprint {
  const modules = blueprint.modules.map(normalizeStrategyModule);
  return {
    ...blueprint,
    generationProfile: normalizeGenerationProfile(blueprint.generationProfile),
    uncertainties: blueprint.uncertainties ?? [],
    modules,
    plannedCaseCount: modules.reduce((sum, module) => sum + module.targetCaseCount, 0),
  };
}

function toggleTechnique(current: TestDesignTechnique[] | undefined, technique: TestDesignTechnique) {
  const source = current ?? [];
  return source.includes(technique) ? source.filter((item) => item !== technique) : [...source, technique];
}

function buildNewTestPoint(index: number): CoverageModule["testPoints"][number] {
  return {
    id: `TP-NEW-${String(index + 1).padStart(2, "0")}`,
    name: "新测试点",
    evidence: "待补充 PRD 依据",
    requirementId: "",
    requirementSection: "",
    sourceQuote: "",
    fields: [],
    states: [],
    roles: [],
    flows: [],
    rules: [],
    designTechniques: ["等价类"],
    riskLevel: "medium",
    riskFactors: [],
    coverage: { 功能: 1 },
    expectedCaseCount: 1,
  };
}

function buildNewModule(index: number): CoverageModule {
  return {
    name: `新模块 ${index + 1}`,
    description: "待补充模块职责",
    complexity: "simple",
    riskLevel: "medium",
    isCore: false,
    testPoints: [buildNewTestPoint(0)],
    riskPoints: [],
    testData: [],
    environment: [],
    uncertainties: [],
    designTechniques: ["等价类"],
    categoryTargets: { 功能: 1 },
    skippedCategories: [],
    coverageNotes: [],
    targetCaseCount: 1,
  };
}

function StrategyEditorPanel({
  disabled,
  fileName,
  strategy,
  onChange,
  onClear,
  onGenerate,
  onRegenerate,
}: {
  disabled: boolean;
  fileName?: string;
  strategy: CoverageBlueprint | null;
  onChange: (strategy: CoverageBlueprint) => void;
  onClear: () => void;
  onGenerate: () => void;
  onRegenerate: () => void;
}) {
  if (!strategy) return null;

  const updateStrategy = (updater: (current: CoverageBlueprint) => CoverageBlueprint) => {
    onChange(recalculateStrategy(updater(strategy)));
  };
  const updateModule = (moduleIndex: number, updater: (module: CoverageModule) => CoverageModule) => {
    updateStrategy((current) => ({
      ...current,
      modules: current.modules.map((module, index) => (index === moduleIndex ? updater(module) : module)),
    }));
  };
  const updatePoint = (moduleIndex: number, pointIndex: number, updater: (point: CoverageModule["testPoints"][number]) => CoverageModule["testPoints"][number]) => {
    updateModule(moduleIndex, (module) => {
      const testPoints = module.testPoints.map((point, index) => (index === pointIndex ? updater(point) : point));
      const categoryTargets = Object.fromEntries(categories.map((category) => [category, testPoints.reduce((sum, point) => sum + clampStrategyCount(point.coverage?.[category] ?? 0), 0)])) as Record<TestCategory, number>;
      return { ...module, testPoints, categoryTargets, targetCaseCount: sumCoverageTargets(categoryTargets) };
    });
  };
  const updateStrategyUncertainty = (uncertaintyIndex: number, updater: (uncertainty: RequirementUncertainty) => RequirementUncertainty) => {
    updateStrategy((current) => ({
      ...current,
      uncertainties: (current.uncertainties ?? []).map((uncertainty, index) => (index === uncertaintyIndex ? updater(uncertainty) : uncertainty)),
    }));
  };
  const updateModuleTestData = (moduleIndex: number, dataIndex: number, updater: (data: TestDataRequirement) => TestDataRequirement) => {
    updateModule(moduleIndex, (module) => ({
      ...module,
      testData: (module.testData ?? []).map((data, index) => (index === dataIndex ? updater(data) : data)),
    }));
  };
  const updateModuleEnvironment = (moduleIndex: number, environmentIndex: number, updater: (environment: TestEnvironmentRequirement) => TestEnvironmentRequirement) => {
    updateModule(moduleIndex, (module) => ({
      ...module,
      environment: (module.environment ?? []).map((environment, index) => (index === environmentIndex ? updater(environment) : environment)),
    }));
  };
  const updateModuleUncertainty = (moduleIndex: number, uncertaintyIndex: number, updater: (uncertainty: RequirementUncertainty) => RequirementUncertainty) => {
    updateModule(moduleIndex, (module) => ({
      ...module,
      uncertainties: (module.uncertainties ?? []).map((uncertainty, index) => (index === uncertaintyIndex ? updater(uncertainty) : uncertainty)),
    }));
  };
  const profileConfig = generationProfileConfigs[normalizeGenerationProfile(strategy.generationProfile)];

  return (
    <section className="rounded-lg border border-teal-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
            <ListChecks className="size-4" />
            可编辑测试策略
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-normal">
            {complexityLabels[strategy.documentComplexity]} PRD · 计划 {strategy.plannedCaseCount} 条
          </h2>
          <p className="mt-1 break-words text-sm leading-6 text-slate-500">{fileName ? `${fileName} · ` : ""}{strategy.coverageRationale}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            disabled={disabled}
            type="button"
            onClick={onRegenerate}
          >
            <Sparkles className="size-4" />
            重新生成策略
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={disabled || !strategy.modules.length}
            type="button"
            onClick={onGenerate}
          >
            <PlayCircle className="size-4" />
            按策略生成
          </button>
          <button
            aria-label="清空测试策略"
            className="grid size-10 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            disabled={disabled}
            title="清空策略"
            type="button"
            onClick={onClear}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-slate-950 px-2.5 py-1 font-medium text-white">{profileConfig.label}模式</span>
        <span className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-700 ring-1 ring-teal-200">{strategy.modules.length} 个模块</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 ring-1 ring-amber-200">
          {(strategy.uncertainties?.length ?? 0) + strategy.modules.reduce((sum, module) => sum + (module.uncertainties?.length ?? 0), 0)} 个不确定项
        </span>
        <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">确认后生成用例</span>
      </div>

      {(strategy.uncertainties?.length ?? 0) ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <FileQuestion className="size-4" />
            全局不确定项
          </div>
          <div className="mt-3 grid gap-2">
            {(strategy.uncertainties ?? []).map((uncertainty, uncertaintyIndex) => (
              <div key={`${uncertainty.id}-${uncertaintyIndex}`} className="rounded-lg bg-white p-3 ring-1 ring-amber-100">
                <div className="grid gap-2 lg:grid-cols-[150px_1fr_auto]">
                  <select
                    className="h-9 rounded-md border border-amber-200 bg-white px-2 text-sm outline-none focus:border-amber-500"
                    value={uncertainty.type}
                    onChange={(event) => updateStrategyUncertainty(uncertaintyIndex, (item) => ({ ...item, type: event.target.value as RequirementUncertainty["type"] }))}
                  >
                    {uncertaintyTypeOptions.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <input
                    className="h-9 rounded-md border border-amber-200 bg-white px-2 text-sm outline-none focus:border-amber-500"
                    value={uncertainty.title}
                    onChange={(event) => updateStrategyUncertainty(uncertaintyIndex, (item) => ({ ...item, title: event.target.value }))}
                  />
                  <button
                    aria-label={`删除 ${uncertainty.title}`}
                    className="grid size-9 place-items-center rounded-lg bg-white text-rose-500 ring-1 ring-rose-100 transition hover:bg-rose-50"
                    type="button"
                    onClick={() => updateStrategy((current) => ({ ...current, uncertainties: (current.uncertainties ?? []).filter((_, index) => index !== uncertaintyIndex) }))}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 grid gap-2 lg:grid-cols-3">
                  <textarea
                    className="min-h-16 rounded-md border border-amber-200 bg-white px-2 py-2 text-sm leading-6 outline-none focus:border-amber-500"
                    value={uncertainty.detail}
                    onChange={(event) => updateStrategyUncertainty(uncertaintyIndex, (item) => ({ ...item, detail: event.target.value }))}
                  />
                  <textarea
                    className="min-h-16 rounded-md border border-amber-200 bg-white px-2 py-2 text-sm leading-6 outline-none focus:border-amber-500"
                    value={uncertainty.impact}
                    onChange={(event) => updateStrategyUncertainty(uncertaintyIndex, (item) => ({ ...item, impact: event.target.value }))}
                  />
                  <textarea
                    className="min-h-16 rounded-md border border-amber-200 bg-white px-2 py-2 text-sm leading-6 outline-none focus:border-amber-500"
                    value={uncertainty.question ?? ""}
                    onChange={(event) => updateStrategyUncertainty(uncertaintyIndex, (item) => ({ ...item, question: event.target.value }))}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <button
        className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-amber-50 hover:text-amber-800"
        type="button"
        onClick={() => updateStrategy((current) => ({ ...current, uncertainties: [...(current.uncertainties ?? []), buildNewUncertainty(current.uncertainties?.length ?? 0)] }))}
      >
        <Plus className="size-4" />
        添加全局不确定项
      </button>

      <div className="mt-5 space-y-4">
        {strategy.modules.map((module, moduleIndex) => {
          const moduleName = formatCoverageModuleName(module);
          return (
            <details key={`${moduleName}-${moduleIndex}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4" open={moduleIndex === 0}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-slate-900">{moduleName}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {complexityLabels[module.complexity]} · {riskLabels[module.riskLevel]} · {module.testPoints.length} 个测试点 · {module.targetCaseCount} 条
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {categories.map((category) => {
                    const count = module.categoryTargets?.[category] ?? 0;
                    if (!count) return null;
                    return (
                      <span key={category} className={clsx("rounded-full px-2 py-0.5 text-xs ring-1", categoryStyles[category])}>
                        {category} {count}
                      </span>
                    );
                  })}
                  {module.locked ? <Lock className="size-4 text-teal-700" /> : null}
                </div>
              </summary>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">模块名称</span>
                  <input
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                    value={module.name}
                    onChange={(event) => updateModule(moduleIndex, (item) => ({ ...item, name: event.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">父级模块</span>
                  <input
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                    value={module.parent ?? ""}
                    onChange={(event) => updateModule(moduleIndex, (item) => ({ ...item, parent: event.target.value }))}
                  />
                </label>
                <label className="block lg:col-span-2">
                  <span className="text-xs font-medium text-slate-500">模块职责</span>
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-teal-500"
                    value={module.description ?? ""}
                    onChange={(event) => updateModule(moduleIndex, (item) => ({ ...item, description: event.target.value }))}
                  />
                </label>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                <div>
                  <p className="text-xs font-medium text-slate-500">复杂度</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {complexityOptions.map((option) => (
                      <button
                        key={option}
                        className={clsx("h-8 rounded-md px-2.5 text-xs font-medium ring-1 transition", module.complexity === option ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-teal-50 hover:text-teal-800")}
                        type="button"
                        onClick={() => updateModule(moduleIndex, (item) => ({ ...item, complexity: option }))}
                      >
                        {complexityLabels[option]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">风险等级</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {riskOptions.map((option) => (
                      <button
                        key={option}
                        className={clsx("h-8 rounded-md px-2.5 text-xs font-medium ring-1 transition", module.riskLevel === option ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-teal-50 hover:text-teal-800")}
                        type="button"
                        onClick={() => updateModule(moduleIndex, (item) => ({ ...item, riskLevel: option }))}
                      >
                        {riskLabels[option]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <button
                    className={clsx("grid size-9 place-items-center rounded-lg ring-1 transition", module.locked ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50")}
                    title={module.locked ? "已锁定" : "未锁定"}
                    type="button"
                    onClick={() => updateModule(moduleIndex, (item) => ({ ...item, locked: !item.locked }))}
                  >
                    {module.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
                  </button>
                  <button
                    aria-label={`删除 ${moduleName}`}
                    className="grid size-9 place-items-center rounded-lg bg-white text-rose-500 ring-1 ring-rose-100 transition hover:bg-rose-50"
                    type="button"
                    onClick={() => updateStrategy((current) => ({ ...current, modules: current.modules.filter((_, index) => index !== moduleIndex) }))}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium text-slate-500">测试设计方法</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {designTechniqueOptions.map((technique) => (
                    <button
                      key={technique}
                      className={clsx("h-8 rounded-md px-2.5 text-xs font-medium ring-1 transition", module.designTechniques?.includes(technique) ? "bg-teal-700 text-white ring-teal-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-teal-50 hover:text-teal-800")}
                      type="button"
                      onClick={() => updateModule(moduleIndex, (item) => ({ ...item, designTechniques: toggleTechnique(item.designTechniques, technique) }))}
                    >
                      {technique}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                {categories.map((category) => (
                  <label key={category} className="block rounded-lg bg-white p-2 ring-1 ring-slate-200">
                    <span className="text-xs font-medium text-slate-500">{category}</span>
                    <input
                      className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-teal-500"
                      min={0}
                      type="number"
                      value={module.categoryTargets?.[category] ?? 0}
                      onChange={(event) =>
                        updateModule(moduleIndex, (item) => {
                          const categoryTargets = { ...item.categoryTargets, [category]: readCount(event.target.value) };
                          return { ...item, categoryTargets, targetCaseCount: Math.max(1, sumCoverageTargets(categoryTargets)) };
                        })
                      }
                    />
                  </label>
                ))}
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-3">
                <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
                      <Database className="size-3.5" />
                      测试数据
                    </p>
                    <button
                      aria-label="添加测试数据"
                      className="grid size-7 place-items-center rounded-md text-teal-700 transition hover:bg-teal-50"
                      type="button"
                      onClick={() => updateModule(moduleIndex, (item) => ({ ...item, testData: [...(item.testData ?? []), buildNewTestData(item.testData?.length ?? 0)] }))}
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {(module.testData ?? []).map((data, dataIndex) => (
                      <div key={`${data.id}-${dataIndex}`} className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-100">
                        <div className="grid gap-2 sm:grid-cols-[92px_1fr_auto]">
                          <input
                            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-teal-500"
                            value={data.id}
                            onChange={(event) => updateModuleTestData(moduleIndex, dataIndex, (item) => ({ ...item, id: event.target.value }))}
                          />
                          <input
                            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-teal-500"
                            value={data.name}
                            onChange={(event) => updateModuleTestData(moduleIndex, dataIndex, (item) => ({ ...item, name: event.target.value }))}
                          />
                          <button
                            aria-label={`删除 ${data.name}`}
                            className="grid size-8 place-items-center rounded-md text-rose-500 transition hover:bg-rose-50"
                            type="button"
                            onClick={() => updateModule(moduleIndex, (item) => ({ ...item, testData: (item.testData ?? []).filter((_, index) => index !== dataIndex) }))}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <input
                          className="mt-2 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-teal-500"
                          placeholder="适用范围"
                          value={data.scope}
                          onChange={(event) => updateModuleTestData(moduleIndex, dataIndex, (item) => ({ ...item, scope: event.target.value }))}
                        />
                        <input
                          className="mt-2 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-teal-500"
                          placeholder="取值，用顿号分隔"
                          value={joinListValue(data.values)}
                          onChange={(event) => updateModuleTestData(moduleIndex, dataIndex, (item) => ({ ...item, values: splitListValue(event.target.value) }))}
                        />
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <textarea
                            className="min-h-14 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 outline-none focus:border-teal-500"
                            placeholder="准备动作"
                            value={data.setup}
                            onChange={(event) => updateModuleTestData(moduleIndex, dataIndex, (item) => ({ ...item, setup: event.target.value }))}
                          />
                          <textarea
                            className="min-h-14 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 outline-none focus:border-teal-500"
                            placeholder="清理动作"
                            value={data.cleanup}
                            onChange={(event) => updateModuleTestData(moduleIndex, dataIndex, (item) => ({ ...item, cleanup: event.target.value }))}
                          />
                        </div>
                      </div>
                    ))}
                    {!(module.testData?.length) ? <p className="text-xs leading-5 text-slate-400">未配置特殊测试数据。</p> : null}
                  </div>
                </div>

                <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
                      <ServerCog className="size-3.5" />
                      环境依赖
                    </p>
                    <button
                      aria-label="添加环境依赖"
                      className="grid size-7 place-items-center rounded-md text-teal-700 transition hover:bg-teal-50"
                      type="button"
                      onClick={() => updateModule(moduleIndex, (item) => ({ ...item, environment: [...(item.environment ?? []), buildNewEnvironment(item.environment?.length ?? 0)] }))}
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {(module.environment ?? []).map((environment, environmentIndex) => (
                      <div key={`${environment.id}-${environmentIndex}`} className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-100">
                        <div className="grid gap-2 sm:grid-cols-[92px_1fr_auto]">
                          <input
                            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-teal-500"
                            value={environment.id}
                            onChange={(event) => updateModuleEnvironment(moduleIndex, environmentIndex, (item) => ({ ...item, id: event.target.value }))}
                          />
                          <input
                            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-teal-500"
                            value={environment.name}
                            onChange={(event) => updateModuleEnvironment(moduleIndex, environmentIndex, (item) => ({ ...item, name: event.target.value }))}
                          />
                          <button
                            aria-label={`删除 ${environment.name}`}
                            className="grid size-8 place-items-center rounded-md text-rose-500 transition hover:bg-rose-50"
                            type="button"
                            onClick={() => updateModule(moduleIndex, (item) => ({ ...item, environment: (item.environment ?? []).filter((_, index) => index !== environmentIndex) }))}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <select
                          className="mt-2 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-teal-500"
                          value={environment.type}
                          onChange={(event) => updateModuleEnvironment(moduleIndex, environmentIndex, (item) => ({ ...item, type: event.target.value as TestEnvironmentRequirement["type"] }))}
                        >
                          {environmentTypeOptions.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <textarea
                          className="mt-2 min-h-14 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 outline-none focus:border-teal-500"
                          placeholder="依赖说明"
                          value={environment.description}
                          onChange={(event) => updateModuleEnvironment(moduleIndex, environmentIndex, (item) => ({ ...item, description: event.target.value }))}
                        />
                        <input
                          className="mt-2 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:border-teal-500"
                          placeholder="依赖项，用顿号分隔"
                          value={joinListValue(environment.dependencies)}
                          onChange={(event) => updateModuleEnvironment(moduleIndex, environmentIndex, (item) => ({ ...item, dependencies: splitListValue(event.target.value) }))}
                        />
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <textarea
                            className="min-h-14 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 outline-none focus:border-teal-500"
                            placeholder="准备动作"
                            value={environment.setup}
                            onChange={(event) => updateModuleEnvironment(moduleIndex, environmentIndex, (item) => ({ ...item, setup: event.target.value }))}
                          />
                          <textarea
                            className="min-h-14 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 outline-none focus:border-teal-500"
                            placeholder="清理动作"
                            value={environment.cleanup}
                            onChange={(event) => updateModuleEnvironment(moduleIndex, environmentIndex, (item) => ({ ...item, cleanup: event.target.value }))}
                          />
                        </div>
                      </div>
                    ))}
                    {!(module.environment?.length) ? <p className="text-xs leading-5 text-slate-400">未配置特殊环境依赖。</p> : null}
                  </div>
                </div>

                <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
                      <FileQuestion className="size-3.5" />
                      不确定项
                    </p>
                    <button
                      aria-label="添加不确定项"
                      className="grid size-7 place-items-center rounded-md text-teal-700 transition hover:bg-teal-50"
                      type="button"
                      onClick={() => updateModule(moduleIndex, (item) => ({ ...item, uncertainties: [...(item.uncertainties ?? []), buildNewUncertainty(item.uncertainties?.length ?? 0)] }))}
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {(module.uncertainties ?? []).map((uncertainty, uncertaintyIndex) => (
                      <div key={`${uncertainty.id}-${uncertaintyIndex}`} className="rounded-lg bg-amber-50 p-2 ring-1 ring-amber-100">
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <select
                            className="h-8 rounded-md border border-amber-200 bg-white px-2 text-xs outline-none focus:border-amber-500"
                            value={uncertainty.type}
                            onChange={(event) => updateModuleUncertainty(moduleIndex, uncertaintyIndex, (item) => ({ ...item, type: event.target.value as RequirementUncertainty["type"] }))}
                          >
                            {uncertaintyTypeOptions.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                          <button
                            aria-label={`删除 ${uncertainty.title}`}
                            className="grid size-8 place-items-center rounded-md text-rose-500 transition hover:bg-rose-50"
                            type="button"
                            onClick={() => updateModule(moduleIndex, (item) => ({ ...item, uncertainties: (item.uncertainties ?? []).filter((_, index) => index !== uncertaintyIndex) }))}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <input
                          className="mt-2 h-8 w-full rounded-md border border-amber-200 bg-white px-2 text-xs outline-none focus:border-amber-500"
                          value={uncertainty.title}
                          onChange={(event) => updateModuleUncertainty(moduleIndex, uncertaintyIndex, (item) => ({ ...item, title: event.target.value }))}
                        />
                        <textarea
                          className="mt-2 min-h-14 w-full rounded-md border border-amber-200 bg-white px-2 py-1.5 text-xs leading-5 outline-none focus:border-amber-500"
                          placeholder="规则缺口或假设"
                          value={uncertainty.detail}
                          onChange={(event) => updateModuleUncertainty(moduleIndex, uncertaintyIndex, (item) => ({ ...item, detail: event.target.value }))}
                        />
                        <textarea
                          className="mt-2 min-h-14 w-full rounded-md border border-amber-200 bg-white px-2 py-1.5 text-xs leading-5 outline-none focus:border-amber-500"
                          placeholder="影响与待确认问题"
                          value={[uncertainty.impact, uncertainty.question].filter(Boolean).join("\n")}
                          onChange={(event) => {
                            const [impact = "", ...questionParts] = event.target.value.split("\n");
                            updateModuleUncertainty(moduleIndex, uncertaintyIndex, (item) => ({ ...item, impact, question: questionParts.join("\n") }));
                          }}
                        />
                      </div>
                    ))}
                    {!(module.uncertainties?.length) ? <p className="text-xs leading-5 text-slate-400">暂无模块级待确认问题。</p> : null}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {module.testPoints.map((point, pointIndex) => (
                  <div key={`${point.id}-${pointIndex}`} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-2">
                        <label className="block">
                          <span className="text-xs font-medium text-slate-500">测试点</span>
                          <input
                            className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-teal-500"
                            value={point.name}
                            onChange={(event) => updatePoint(moduleIndex, pointIndex, (item) => ({ ...item, name: event.target.value }))}
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-500">章节 / 需求编号</span>
                          <input
                            className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-teal-500"
                            value={[point.requirementSection, point.requirementId].filter(Boolean).join(" / ")}
                            onChange={(event) => {
                              const [section = "", requirementId = ""] = event.target.value.split("/").map((item) => item.trim());
                              updatePoint(moduleIndex, pointIndex, (item) => ({ ...item, requirementSection: section, requirementId }));
                            }}
                          />
                        </label>
                        <label className="block lg:col-span-2">
                          <span className="text-xs font-medium text-slate-500">PRD 依据</span>
                          <textarea
                            className="mt-1 min-h-16 w-full rounded-md border border-slate-200 px-2 py-2 text-sm leading-6 outline-none focus:border-teal-500"
                            value={point.evidence}
                            onChange={(event) => updatePoint(moduleIndex, pointIndex, (item) => ({ ...item, evidence: event.target.value, sourceQuote: item.sourceQuote || event.target.value }))}
                          />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className={clsx("grid size-9 place-items-center rounded-lg ring-1 transition", point.locked ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100")}
                          title={point.locked ? "已锁定" : "未锁定"}
                          type="button"
                          onClick={() => updatePoint(moduleIndex, pointIndex, (item) => ({ ...item, locked: !item.locked }))}
                        >
                          {point.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
                        </button>
                        <button
                          aria-label={`删除 ${point.name}`}
                          className="grid size-9 place-items-center rounded-lg bg-rose-50 text-rose-600 ring-1 ring-rose-100 transition hover:bg-rose-100"
                          type="button"
                          onClick={() => updateModule(moduleIndex, (item) => ({ ...item, testPoints: item.testPoints.filter((_, index) => index !== pointIndex) }))}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {riskOptions.map((option) => (
                        <button
                          key={option}
                          className={clsx("h-7 rounded-md px-2 text-xs ring-1 transition", point.riskLevel === option ? "bg-slate-950 text-white ring-slate-950" : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-teal-50")}
                          type="button"
                          onClick={() => updatePoint(moduleIndex, pointIndex, (item) => ({ ...item, riskLevel: option }))}
                        >
                          {riskLabels[option]}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {designTechniqueOptions.map((technique) => (
                        <button
                          key={technique}
                          className={clsx("h-7 rounded-md px-2 text-xs ring-1 transition", point.designTechniques?.includes(technique) ? "bg-teal-700 text-white ring-teal-700" : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-teal-50")}
                          type="button"
                          onClick={() => updatePoint(moduleIndex, pointIndex, (item) => ({ ...item, designTechniques: toggleTechnique(item.designTechniques, technique) }))}
                        >
                          {technique}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-5">
                      {categories.map((category) => (
                        <label key={category} className="block rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
                          <span className="text-xs font-medium text-slate-500">{category}</span>
                          <input
                            className="mt-1 h-8 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-teal-500"
                            min={0}
                            type="number"
                            value={point.coverage?.[category] ?? 0}
                            onChange={(event) =>
                              updatePoint(moduleIndex, pointIndex, (item) => {
                                const coverage = { ...item.coverage, [category]: readCount(event.target.value) };
                                return { ...item, coverage, expectedCaseCount: Math.max(1, sumCoverageTargets(coverage)) };
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button
                className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-teal-50 hover:text-teal-800"
                type="button"
                onClick={() => updateModule(moduleIndex, (item) => ({ ...item, testPoints: [...item.testPoints, buildNewTestPoint(item.testPoints.length)] }))}
              >
                <Plus className="size-4" />
                添加测试点
              </button>
            </details>
          );
        })}
      </div>

      <button
        className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-teal-50 hover:text-teal-800"
        type="button"
        onClick={() => updateStrategy((current) => ({ ...current, modules: [...current.modules, buildNewModule(current.modules.length)] }))}
      >
        <Plus className="size-4" />
        添加模块
      </button>
    </section>
  );
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
        <div className="flex flex-wrap gap-2">
          {blueprint.generationProfile ? (
            <span className="rounded-full bg-slate-950 px-3 py-1 text-sm text-white">{generationProfileConfigs[normalizeGenerationProfile(blueprint.generationProfile)].label}模式</span>
          ) : null}
          <span className="rounded-full bg-slate-50 px-3 py-1 text-sm text-slate-600 ring-1 ring-slate-200">{blueprint.modules.length} 个模块</span>
        </div>
      </div>

      {blueprint.uncertainties?.length ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <FileQuestion className="size-4" />
            全局不确定项
          </div>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {blueprint.uncertainties.map((uncertainty) => (
              <div key={uncertainty.id} className="rounded-lg bg-white p-3 text-sm ring-1 ring-amber-100">
                <p className="font-medium text-slate-800">{uncertainty.title}</p>
                <p className="mt-1 text-xs text-amber-700">{uncertainty.type}</p>
                <p className="mt-2 leading-6 text-slate-600">{uncertainty.detail}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{uncertainty.question || uncertainty.impact}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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

              {module.designTechniques?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {module.designTechniques.map((technique) => (
                    <span key={technique} className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
                      {technique}
                    </span>
                  ))}
                </div>
              ) : null}

              {(module.coverageNotes?.length ?? 0) || (module.skippedCategories?.length ?? 0) ? (
                <div className="mt-3 space-y-1 text-sm leading-6 text-slate-500">
                  {(module.coverageNotes ?? []).map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                  {(module.skippedCategories ?? []).map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              ) : null}

              {module.testData?.length || module.environment?.length || module.uncertainties?.length ? (
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  {module.testData?.length ? (
                    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                      <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
                        <Database className="size-3.5" />
                        测试数据
                      </p>
                      <div className="mt-2 space-y-2">
                        {module.testData.map((data) => (
                          <p key={data.id} className="text-xs leading-5 text-slate-600">
                            <span className="font-medium text-slate-800">{data.id}｜{data.name}</span>：{[data.scope, joinListValue(data.values), data.setup].filter(Boolean).join("；")}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {module.environment?.length ? (
                    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                      <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
                        <ServerCog className="size-3.5" />
                        环境依赖
                      </p>
                      <div className="mt-2 space-y-2">
                        {module.environment.map((environment) => (
                          <p key={environment.id} className="text-xs leading-5 text-slate-600">
                            <span className="font-medium text-slate-800">{environment.id}｜{environment.name}</span>：{[environment.type, environment.description, joinListValue(environment.dependencies)].filter(Boolean).join("；")}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {module.uncertainties?.length ? (
                    <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                      <p className="flex items-center gap-2 text-xs font-medium text-amber-700">
                        <FileQuestion className="size-3.5" />
                        不确定项
                      </p>
                      <div className="mt-2 space-y-2">
                        {module.uncertainties.map((uncertainty) => (
                          <p key={uncertainty.id} className="text-xs leading-5 text-amber-800">
                            <span className="font-medium">{uncertainty.id}｜{uncertainty.title}</span>：{uncertainty.question || uncertainty.detail}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
                {module.testPoints.map((point) => (
                  <div key={point.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800">{point.name}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{point.evidence}</p>
                        {point.requirementSection || point.requirementId || point.sourceQuote ? (
                          <p className="mt-1 text-xs leading-5 text-slate-400">
                            {[point.requirementSection ? `章节：${point.requirementSection}` : "", point.requirementId ? `需求：${point.requirementId}` : "", point.sourceQuote ? `原文：${point.sourceQuote}` : ""].filter(Boolean).join(" ｜ ")}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                        {riskLabels[point.riskLevel]} · {point.expectedCaseCount} 条
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(point.designTechniques ?? []).map((technique) => (
                        <span key={technique} className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
                          {technique}
                        </span>
                      ))}
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

function PdfUploadDropzone({
  compact = false,
  emptyLabel,
  file,
  isDragging,
  onClick,
  onDragChange,
  onPick,
}: {
  compact?: boolean;
  emptyLabel: string;
  file: File | null;
  isDragging: boolean;
  onClick: () => void;
  onDragChange: (value: boolean) => void;
  onPick: (file?: File) => void;
}) {
  return (
    <div
      className={clsx(
        "group cursor-pointer rounded-lg border border-dashed transition",
        compact ? "mt-3 flex min-h-20 items-center justify-between gap-3 p-3 text-left" : "mt-4 grid min-h-44 place-items-center p-5 text-center",
        isDragging ? "border-teal-500 bg-teal-50" : "border-slate-300 bg-slate-50/80 hover:border-teal-400 hover:bg-teal-50/30",
      )}
      onClick={onClick}
      onDragOver={(event) => {
        event.preventDefault();
        onDragChange(true);
      }}
      onDragLeave={() => onDragChange(false)}
      onDrop={(event) => {
        event.preventDefault();
        onDragChange(false);
        onPick(event.dataTransfer.files[0]);
      }}
    >
      <div className={clsx("min-w-0", compact ? "flex flex-1 items-center gap-3" : "space-y-4")}>
        <div className={clsx("grid shrink-0 place-items-center rounded-lg bg-white text-teal-700 shadow-sm ring-1 ring-slate-200 transition group-hover:-translate-y-0.5", compact ? "size-10" : "mx-auto size-12")}>
          <UploadCloud className={compact ? "size-5" : "size-6"} />
        </div>
        <div className="min-w-0">
          <p className={clsx("break-words font-semibold", compact && "truncate")}>{file ? file.name : emptyLabel}</p>
          <p className="mt-0.5 text-sm text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "拖入文件或点击选择"}</p>
        </div>
      </div>
      {compact ? <span className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200">选择文件</span> : null}
    </div>
  );
}

function formatLocalFileSize(file: File) {
  if (file.size >= 1024 * 1024) return `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(file.size / 1024))} KB`;
}

function AnalysisFilePicker({
  description,
  files,
  onClear,
  onOpen,
  onRemove,
  title,
}: {
  description: string;
  files: File[];
  onClear: () => void;
  onOpen: () => void;
  onRemove: (index: number) => void;
  title: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <button
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-2.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-teal-50 hover:text-teal-800 hover:ring-teal-200"
          type="button"
          onClick={onOpen}
        >
          <UploadCloud className="size-3.5" />
          上传
        </button>
      </div>

      {files.length ? (
        <div className="mt-3 grid gap-2">
          {files.map((file, index) => (
            <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="flex w-full min-w-0 max-w-full items-center justify-between gap-2 overflow-hidden rounded-lg bg-white px-2.5 py-2 text-xs ring-1 ring-slate-200">
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block truncate font-medium text-slate-700">{file.name}</span>
                <span className="mt-0.5 block text-slate-400">{formatLocalFileSize(file)}</span>
              </span>
              <button
                aria-label={`移除 ${file.name}`}
                className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                type="button"
                onClick={() => onRemove(index)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <button className="justify-self-start rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-white hover:text-slate-900" type="button" onClick={onClear}>
            清空文件
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AgentRail({
  value,
  onChange,
  collapsed,
  onToggle,
}: {
  value: TestAgentType;
  onChange: (value: TestAgentType) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <nav className="flex h-full min-h-0 flex-col bg-white">
      <div className={clsx("flex h-14 shrink-0 items-center border-b border-slate-200 px-3", collapsed ? "justify-center" : "justify-between gap-3")}>
        {collapsed ? null : (
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">智能体</h2>
            <p className="truncate text-xs text-slate-500">切换工作流</p>
          </div>
        )}
        <button
          aria-label={collapsed ? "展开智能体侧栏" : "收起智能体侧栏"}
          className={clsx(
            "grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900",
            collapsed && "bg-slate-950 text-white hover:bg-slate-800 hover:text-white",
          )}
          title={collapsed ? "展开左栏" : "收起左栏"}
          type="button"
          onClick={onToggle}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <div className={clsx("grid flex-1 content-start gap-1 overflow-y-auto", collapsed ? "p-2" : "p-3")}>
        {agentOptions.map((item) => {
          const Icon = item.icon;
          const active = value === item.value;
          return (
            <button
              key={item.value}
              aria-label={item.label}
              className={clsx(
                "group flex w-full items-center gap-3 rounded-lg text-left transition",
                collapsed ? "justify-center px-0 py-2.5" : "px-3 py-3",
                active ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-teal-50 hover:text-teal-800",
              )}
              title={item.label}
              type="button"
              onClick={() => onChange(item.value)}
            >
              <span
                className={clsx(
                  "grid size-9 shrink-0 place-items-center rounded-lg",
                  active ? "bg-white/10 text-white" : "bg-slate-50 text-teal-700 ring-1 ring-slate-200 group-hover:bg-white",
                )}
              >
                <Icon className="size-4" />
              </span>
              {collapsed ? null : (
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="break-words text-sm font-semibold">{item.shortLabel}</span>
                    <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", active ? "bg-white/10 text-slate-200 ring-white/15" : "bg-white text-slate-500 ring-slate-200")}>
                      {agentInputKind(item.value)}
                    </span>
                  </span>
                  <span className={clsx("mt-1 line-clamp-2 block text-xs leading-5", active ? "text-slate-300" : "text-slate-500")}>{item.description}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function AgentRunHistoryPanel({ activeAgent, records }: { activeAgent: TestAgentType; records: RunHistoryRecord[] }) {
  const agent = agentOptions.find((item) => item.value === activeAgent) ?? agentOptions[1];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
            <History className="size-4" />
            运行记录
          </div>
          <h2 className="mt-1 text-base font-semibold text-slate-900">{agent.label}</h2>
          <p className="mt-1 text-sm text-slate-500">当前智能体已保存 {records.length} 次运行记录</p>
        </div>
        <span className="self-start rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 sm:self-auto">
          {agent.shortLabel} / {agentInputKind(activeAgent)}
        </span>
      </div>

      {records.length ? (
        <div className="mt-4 grid max-h-72 gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
          {records.map((record) => (
            <Link
              key={record.id}
              className="block min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-teal-200 hover:bg-teal-50"
              href={getRunHistoryHref(record)}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{getRunHistoryTitle(record)}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {formatRunTime(record.createdAt)} · {providerLabels[record.provider]} · {getRunHistoryCountLabel(record)}
                  </p>
                </div>
                <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1", runHistoryStatusStyles[record.status])}>
                  {runHistoryStatusLabels[record.status]}
                </span>
              </div>
              <p className="mt-2 truncate text-xs text-slate-400">
                {record.model}
                {record.thinkingMode ? ` · ${thinkingModeLabels[record.thinkingMode]}` : ""}
                {record.durationMs !== undefined ? ` · ${formatDuration(record.durationMs)}` : ""}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
          <p className="text-sm font-medium text-slate-700">暂无当前智能体的运行记录</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">运行完成后会自动出现在这里。</p>
        </div>
      )}
    </section>
  );
}

function CaseRunHistoryButton({ count }: { count: number }) {
  return (
    <Link
      className="flex h-full min-h-32 min-w-0 flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-200 hover:bg-teal-50"
      href="/history"
      title={count ? `查看 ${count} 次用例生成记录` : "查看用例运行记录"}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium text-teal-700">
          <History className="size-4" />
          运行记录
        </span>
        <span className="mt-2 block text-base font-semibold text-slate-900">用例生成智能体</span>
      </span>
      <span className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">
        <History className="size-4" />
        运行记录
        {count ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white">{count}</span> : null}
      </span>
    </Link>
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
  actionSlot,
  activeAgent,
  error,
  historySlot,
  isRunning,
  result,
}: {
  actionSlot?: ReactNode;
  activeAgent: TestAgentType;
  error: string;
  historySlot?: ReactNode;
  isRunning: boolean;
  result: AgentAnalysisResponse | null;
}) {
  const agent = agentOptions.find((item) => item.value === activeAgent) ?? agentOptions[1];
  const Icon = agent.icon;
  const itemCount = result?.sections.reduce((sum, section) => sum + section.items.length, 0) ?? 0;
  const p0Count = result?.sections.reduce((sum, section) => sum + section.items.filter((item) => item.priority === "P0").length, 0) ?? 0;
  const isRequirementAnalysis = activeAgent === "requirement-review";

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className={clsx("grid gap-4", actionSlot ? "xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start" : "xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center")}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
              <Icon className="size-4" />
              {agent.label}
            </div>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">{result?.title ?? "等待智能体分析"}</h2>
            <p className="mt-1 break-words text-sm leading-6 text-slate-500">{result?.summary ?? agent.description}</p>
          </div>
          {actionSlot ? (
            <div className="min-w-0">{actionSlot}</div>
          ) : (
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
          )}
        </div>

        {error && !actionSlot ? (
          <div className="mt-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      {historySlot}

      {isRunning ? (
        <div className="grid min-h-[220px] place-items-center rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div>
            <Loader2 className="mx-auto size-8 animate-spin text-teal-700" />
            <p className="mt-4 font-semibold text-slate-800">智能体分析中</p>
            <p className="mt-1 text-sm text-slate-500">{activeAgent === "debug-assistant" ? "正在整理根因、模块和修复建议。" : "正在整理风险、清单和下一步动作。"}</p>
          </div>
        </div>
      ) : result && isRequirementAnalysis ? (
        <>
          {result.warnings.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {result.warnings.join(" ")}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "模块", value: `${result.sections.length} 个`, desc: result.sections.slice(0, 3).map((section) => section.title).join("、") || "待分析" },
              { label: "测试点", value: `${itemCount} 条`, desc: "详细内容在二级页面查看" },
              { label: "P0 关注", value: `${p0Count} 条`, desc: "核心流程、权限、数据或高影响风险" },
              { label: "清单", value: `${result.checklist.length} 项`, desc: "跨模块执行注意事项" },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-400">{item.label}</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{item.value}</p>
                <p className="mt-1 break-words text-xs leading-5 text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <h3 className="font-semibold">模块概览</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">首页只保留报告摘要；全部模块测试点放到详情页集中查看。</p>
                </div>
                <Link
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                  href={getAnalysisDetailHref(result)}
                >
                  <ListChecks className="size-4" />
                  查看全部测试点
                </Link>
              </div>
              <div className="mt-4 grid gap-2">
                {result.sections.slice(0, 6).map((section) => (
                  <div key={section.title} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="break-words text-sm font-semibold text-slate-800">{section.title}</p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">{section.items.length} 条</span>
                    </div>
                    {section.description ? <p className="mt-1 break-words text-xs leading-5 text-slate-500">{section.description}</p> : null}
                  </div>
                ))}
                {result.sections.length > 6 ? (
                  <p className="text-xs text-slate-400">还有 {result.sections.length - 6} 个模块，请进入详情页查看。</p>
                ) : null}
              </div>
            </section>
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold">执行注意</h3>
              <div className="mt-3 grid gap-2">
                {result.checklist.slice(0, 5).map((item, index) => (
                  <div key={`${item}-${index}`} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-700" />
                    <span className="break-words">{item}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
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
        <div className="grid min-h-[240px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
          <div className="w-full max-w-lg">
            <div className="mx-auto grid size-11 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-200">
              <Icon className="size-5" />
            </div>
            <p className="mt-3 font-semibold text-slate-800">结果区等待分析</p>
            <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-slate-500">上传材料并运行后，这里会展示概览和分析结果。</p>
          </div>
        </div>
      )}
    </>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const reviewInputRef = useRef<HTMLInputElement>(null);
  const agentMaterialInputRef = useRef<HTMLInputElement>(null);
  const agentReferenceInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reviewFile, setReviewFile] = useState<File | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [strategyDraft, setStrategyDraft] = useState<CoverageBlueprint | null>(null);
  const [activeModule, setActiveModule] = useState("全部");
  const [isDragging, setIsDragging] = useState(false);
  const [isReviewDragging, setIsReviewDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [agentInput, setAgentInput] = useState("");
  const [agentMaterialFiles, setAgentMaterialFiles] = useState<File[]>([]);
  const [agentReferenceFiles, setAgentReferenceFiles] = useState<File[]>([]);
  const [agentResult, setAgentResult] = useState<AgentAnalysisResponse | null>(null);
  const isClientReady = useClientReady();
  const activeAgent = useStoredAgent();
  const generationProfile = useStoredGenerationProfile();
  const provider = useStoredProvider();
  const apiKey = useStoredValue(apiKeyStorageKey(provider), "");
  const model = useStoredValue(modelStorageKey(provider), providerModels[provider]);
  const baseURL = useStoredValue(baseURLStorageKey(provider), providerBaseURLs[provider] ?? "");
  const thinkingMode = normalizeThinkingMode(useStoredValue(thinkingModeStorageKey(provider), "fast"));
  const reasoningEffort = normalizeReasoningEffort(useStoredValue(reasoningEffortStorageKey(provider), "medium"));
  const runHistory = useRunHistory();
  const themeMode = useThemeMode();
  const leftRailCollapsed = useStoredBoolean(storageKeys.leftRailCollapsed, false);
  const [demoDetailsOpen, setDemoDetailsOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressStatus, setProgressStatus] = useState<ProgressStatus>("idle");
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [streamPreview, setStreamPreview] = useState("");
  const [receivedChars, setReceivedChars] = useState(0);
  const [progressError, setProgressError] = useState("");
  const [progressTitle, setProgressTitle] = useState("AI 生成过程");
  const [progressFloatingTitle, setProgressFloatingTitle] = useState("AI 正在生成");
  const [runStartedAt, setRunStartedAt] = useState(0);
  const [runCompletedAt, setRunCompletedAt] = useState(0);
  const [lastContentAt, setLastContentAt] = useState(0);
  const [lastEventAt, setLastEventAt] = useState(0);
  const now = useTicker(isLoading || isAgentRunning || progressOpen);
  const isDemoResult = result?.source === "demo";
  const currentAgentOption = agentOptions.find((item) => item.value === activeAgent) ?? agentOptions[1];
  const analysisMode = isAnalysisAgent(activeAgent);
  const reviewMode = activeAgent === "requirement-review";
  const sourceLabel = result?.source === "ai" ? "AI 生成" : isDemoResult ? "演示案例" : "待生成";
  const elapsedMs = runStartedAt ? (runCompletedAt || now || runStartedAt) - runStartedAt : 0;
  const idleContentMs = lastContentAt ? now - lastContentAt : elapsedMs;
  const idleEventMs = lastEventAt ? now - lastEventAt : elapsedMs;
  const workspaceGridClass = leftRailCollapsed ? "grid-cols-[72px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]";
  const currentAgentHistory = useMemo(() => runHistory.filter((record) => record.agent === activeAgent), [activeAgent, runHistory]);

  useEffect(() => {
    if (leftRailCollapsed || typeof window === "undefined") return;
    const collapseAt = 1180;
    const collapseWhenNarrow = () => {
      if (window.innerWidth < collapseAt) writeStoredBoolean(storageKeys.leftRailCollapsed, true);
    };
    collapseWhenNarrow();
    window.addEventListener("resize", collapseWhenNarrow);
    return () => window.removeEventListener("resize", collapseWhenNarrow);
  }, [leftRailCollapsed]);

  const moduleCounts = useMemo(() => {
    const data: Record<string, number> = {};
    for (const item of result?.cases ?? []) data[item.module] = (data[item.module] ?? 0) + 1;
    return data;
  }, [result]);

  const moduleNames = useMemo(
    () => Object.keys(moduleCounts).sort((a, b) => moduleCounts[b] - moduleCounts[a] || a.localeCompare(b, "zh-CN")),
    [moduleCounts],
  );
  const caseDetailHref = result ? getCaseDetailHref(result) : "/cases/current";

  function toggleStoredBoolean(key: string, current: boolean) {
    writeStoredBoolean(key, !current);
  }

  function pickFile(nextFile?: File) {
    if (!nextFile) return;
    setError("");
    setResult(null);
    setStrategyDraft(null);
    setActiveModule("全部");
    setFile(nextFile);
  }

  function pickReviewFile(nextFile?: File) {
    if (!nextFile) return;
    setAgentError("");
    setAgentResult(null);
    setReviewFile(nextFile);
  }

  function addAgentFiles(fileList: FileList | null, kind: "material" | "reference") {
    const incoming = Array.from(fileList ?? []);
    if (!incoming.length) return;
    setAgentError("");
    setAgentResult(null);

    const update = (current: File[]) => {
      const merged = [...current];
      for (const file of incoming) {
        const exists = merged.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
        if (!exists) merged.push(file);
      }
      return merged.slice(0, 8);
    };

    if (kind === "material") {
      setAgentMaterialFiles(update);
      if (agentMaterialInputRef.current) agentMaterialInputRef.current.value = "";
    } else {
      setAgentReferenceFiles(update);
      if (agentReferenceInputRef.current) agentReferenceInputRef.current.value = "";
    }
  }

  function removeAgentFile(kind: "material" | "reference", index: number) {
    setAgentError("");
    setAgentResult(null);
    if (kind === "material") {
      setAgentMaterialFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
    } else {
      setAgentReferenceFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
    }
  }

  function selectAgent(nextAgent: TestAgentType) {
    writeStoredValue(storageKeys.activeAgent, nextAgent);
    setError("");
    setAgentError("");
    if (nextAgent !== activeAgent && isAnalysisAgent(nextAgent)) {
      setAgentResult(null);
      setAgentMaterialFiles([]);
      setAgentReferenceFiles([]);
    }
  }

  function startProgress(title: string, floatingTitle: string, firstLog: ProgressLog) {
    const startedAt = getNowMs();
    setRunStartedAt(startedAt);
    setRunCompletedAt(0);
    setLastContentAt(0);
    setLastEventAt(startedAt);
    setProgressOpen(true);
    setProgressStatus("running");
    setProgressError("");
    setProgressTitle(title);
    setProgressFloatingTitle(floatingTitle);
    setStreamPreview("");
    setReceivedChars(0);
    setProgressLogs([firstLog]);
  }

  function getAnalysisInputLabel() {
    if (activeAgent === "change-impact") return "git diff / PR 材料";
    if (activeAgent === "debug-assistant") return "Bug 现场材料";
    return "发布材料";
  }

  function getAnalysisInputError() {
    if (activeAgent === "change-impact") return "请输入或上传 git diff / PR 材料。";
    if (activeAgent === "debug-assistant") return "请输入或上传日志、堆栈、请求或依据文档。";
    return "请输入或上传发布材料。";
  }

  function getAgentRunningCopy() {
    if (activeAgent === "requirement-review") {
      return { title: "准备开始需求分析", floating: "AI 正在分析需求" };
    }
    if (activeAgent === "change-impact") {
      return { title: "准备开始变更影响分析", floating: "AI 正在分析变更" };
    }
    if (activeAgent === "debug-assistant") {
      return { title: "准备开始 Bug 根因分析", floating: "AI 正在分析根因" };
    }
    return { title: "准备开始发布风险分析", floating: "AI 正在分析" };
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

    if (activeAgent === "requirement-review") {
      if (!reviewFile) {
        setAgentError("请上传 PRD PDF。");
        return;
      }
    } else {
      const input = activeAgent === "debug-assistant" ? "" : agentInput.trim();
      const hasUploadedMaterials = agentMaterialFiles.length > 0 || agentReferenceFiles.length > 0;
      if (input.length < 20 && !hasUploadedMaterials) {
        setAgentError(getAnalysisInputError());
        return;
      }
    }

    setIsAgentRunning(true);
    setAgentError("");
    const runningCopy = getAgentRunningCopy();
    startProgress("AI 分析过程", runningCopy.floating, {
      id: "agent-start",
      type: "stage",
      message: runningCopy.title,
      detail: `${providerLabels[provider]} / ${model.trim() || providerModels[provider]}${
        provider === "aliyun" ? ` / ${thinkingModeLabels[thinkingMode]}` : provider === "openai" || provider === "velotric" ? ` / 推理${reasoningEffortLabels[reasoningEffort]}` : ""
      }`,
    });
    try {
      let response: Response;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      if (activeAgent === "requirement-review") {
        const formData = new FormData();
        formData.append("agent", activeAgent);
        formData.append("file", reviewFile as File);
        formData.append("provider", provider);
        formData.append("model", model.trim() || providerModels[provider]);
        formData.append("thinkingMode", thinkingMode);
        formData.append("reasoningEffort", reasoningEffort);
        if (apiKey.trim()) formData.append("apiKey", apiKey.trim());
        if (provider === "velotric") formData.append("baseURL", baseURL.trim() || providerBaseURLs.velotric || "");

        response = await fetch("/api/agents/analyze/stream", {
          method: "POST",
          body: formData,
          signal: abortController.signal,
        });
      } else {
        const input = activeAgent === "debug-assistant" ? "" : agentInput.trim();
        const formData = new FormData();
        formData.append("agent", activeAgent);
        formData.append("input", input);
        formData.append("provider", provider);
        formData.append("model", model.trim() || providerModels[provider]);
        formData.append("thinkingMode", thinkingMode);
        formData.append("reasoningEffort", reasoningEffort);
        if (apiKey.trim()) formData.append("apiKey", apiKey.trim());
        if (provider === "velotric") formData.append("baseURL", baseURL.trim() || providerBaseURLs.velotric || "");
        for (const uploadedFile of agentMaterialFiles) formData.append("files", uploadedFile);
        for (const uploadedFile of agentReferenceFiles) formData.append("referenceFiles", uploadedFile);

        response = await fetch("/api/agents/analyze/stream", {
          method: "POST",
          body: formData,
          signal: abortController.signal,
        });
      }

      if (!response.ok || !response.body) {
        throw new Error("智能体分析服务没有返回可读取的进度流。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: AgentAnalysisResponse | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AgentAnalysisStreamEvent;
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
            writeCurrentAgentAnalysis(event.data);
            setAgentResult(event.data);
          }
          if (event.type === "error") {
            appendProgressLog("error", event.message, event.detail);
            setProgressError(event.detail ? `${event.message} ${event.detail}` : event.message);
            throw new Error(event.message);
          }
        }
      }

      if (!finalResult) throw new Error("智能体分析结束但没有收到分析结果。");

      await refreshRunHistory();
      setProgressStatus("success");
      setRunCompletedAt(getNowMs());
    } catch (caught) {
      const isAbort = caught instanceof Error && caught.name === "AbortError";
      const message = isAbort ? "已停止本次分析。" : caught instanceof Error ? caught.message : "智能体分析失败，请稍后重试。";
      setAgentError(isAbort ? "" : message);
      setProgressStatus(isAbort ? "cancelled" : "error");
      setProgressError((current) => current || message);
      setRunCompletedAt(getNowMs());
    } finally {
      abortControllerRef.current = null;
      setIsAgentRunning(false);
    }
  }

  function loadDemoCase() {
    setError("");
    setFile(null);
    setStrategyDraft(null);
    writeCurrentCaseReport(demoGenerateResponse);
    setResult(demoGenerateResponse);
    setActiveModule("全部");
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

  function buildGenerateFormData(mode: "strategy" | "cases", strategy?: CoverageBlueprint) {
    const formData = new FormData();
    if (file) formData.append("file", file);
    formData.append("mode", mode);
    formData.append("provider", provider);
    formData.append("model", model.trim() || providerModels[provider]);
    formData.append("generationProfile", strategy?.generationProfile ?? generationProfile);
    formData.append("thinkingMode", thinkingMode);
    formData.append("reasoningEffort", reasoningEffort);
    if (provider === "velotric") {
      formData.append("baseURL", baseURL.trim() || providerBaseURLs.velotric || "");
    }
    const trimmedApiKey = apiKey.trim();
    if (trimmedApiKey) {
      formData.append("apiKey", trimmedApiKey);
    }
    if (strategy) {
      formData.append("coverageBlueprint", JSON.stringify(recalculateStrategy({ ...strategy, generationProfile: strategy.generationProfile ?? generationProfile })));
    }
    return formData;
  }

  async function readGenerateStream(formData: FormData, emptyMessage: string) {
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
        const event = JSON.parse(line) as GenerateStreamEvent;
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
        }
        if (event.type === "error") {
          appendProgressLog("error", event.message, event.detail);
          setProgressError(event.detail ? `${event.message} ${event.detail}` : event.message);
          throw new Error(event.message);
        }
      }
    }

    if (!finalResult) throw new Error(emptyMessage);
    return finalResult;
  }

  function validateCaseGenerationInput() {
    if (isLoading) {
      setProgressOpen(true);
      return false;
    }

    if (!isClientReady) {
      setError("正在读取本机保存的模型配置，请稍后再试。");
      return false;
    }

    if (!file) {
      setError("请选择 PRD PDF。");
      return false;
    }

    return true;
  }

  function startCaseProgress(title: string, floatingTitle: string, message: string) {
    startProgress(title, floatingTitle, {
      id: "start",
      type: "stage",
      message,
      detail: `${providerLabels[provider]} / ${model.trim() || providerModels[provider]} / ${generationProfileConfigs[generationProfile].label}模式${
        provider === "aliyun" ? ` / ${thinkingModeLabels[thinkingMode]}` : provider === "openai" || provider === "velotric" ? ` / 推理${reasoningEffortLabels[reasoningEffort]}` : ""
      }`,
    });
  }

  async function generateStrategy() {
    if (!validateCaseGenerationInput()) return;

    setIsLoading(true);
    setError("");
    setResult(null);
    startCaseProgress("AI 测试策略生成过程", "AI 正在生成策略", "准备生成测试策略");

    try {
      const finalResult = await readGenerateStream(buildGenerateFormData("strategy"), "策略生成结束但没有收到覆盖蓝图。");
      if (finalResult.coverageBlueprint && !finalResult.cases.length) {
        setStrategyDraft(recalculateStrategy(finalResult.coverageBlueprint));
        setResult(null);
      } else {
        writeCurrentCaseReport(finalResult);
        setResult(finalResult);
        setStrategyDraft(finalResult.coverageBlueprint ? recalculateStrategy(finalResult.coverageBlueprint) : null);
        await refreshRunHistory();
      }
      setProgressStatus("success");
      setRunCompletedAt(getNowMs());
      setActiveModule("全部");
      window.setTimeout(() => setProgressOpen(false), 900);
    } catch (caught) {
      const isAbort = caught instanceof Error && caught.name === "AbortError";
      const message = isAbort ? "已停止本次策略生成。" : caught instanceof Error ? caught.message : "策略生成失败";
      if (isAbort) {
        setError("");
        setProgressStatus("cancelled");
        setProgressError("已停止本次策略生成。");
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

  async function generateCasesFromStrategy() {
    if (!validateCaseGenerationInput()) return;
    if (!strategyDraft) {
      await generateStrategy();
      return;
    }

    setIsLoading(true);
    setError("");
    startCaseProgress("AI 生成过程", "AI 正在生成", "准备按测试策略生成用例");

    try {
      const finalResult = await readGenerateStream(buildGenerateFormData("cases", strategyDraft), "生成结束但没有收到测试用例结果。");
      writeCurrentCaseReport(finalResult);
      setResult(finalResult);
      setStrategyDraft(finalResult.coverageBlueprint ? recalculateStrategy(finalResult.coverageBlueprint) : strategyDraft);
      await refreshRunHistory();
      setProgressStatus("success");
      setRunCompletedAt(getNowMs());
      setActiveModule("全部");
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

  async function generate() {
    if (strategyDraft) {
      await generateCasesFromStrategy();
      return;
    }
    await generateStrategy();
  }

  function stopGeneration() {
    if ((!isLoading && !isAgentRunning) || !abortControllerRef.current) return;
    abortControllerRef.current.abort();
    setProgressStatus("cancelled");
    setProgressError(isAgentRunning ? "正在停止本次分析。" : "正在停止本次生成，停止前的运行日志会保存到历史记录。");
    setRunCompletedAt(getNowMs());
    appendProgressLog(
      "cancelled",
      isAgentRunning ? "已请求停止分析" : "已请求停止生成",
      isAgentRunning ? "正在中断分析模型流式请求。" : "正在中断模型流式请求，后端会记录停止前的阶段和已生成内容。",
    );
  }

  function appendProgressLog(type: ProgressLog["type"], message: string, detail?: string) {
    setProgressLogs((current) => {
      const nextLog = {
        id: `${Date.now()}-${Math.random()}`,
        type,
        message,
        detail,
      };

      if (message === "AI 正在持续生成" || message === "AI 正在持续分析" || message === "模型正在思考") {
        const existingIndex = current.findIndex((item) => item.message === message);
        if (existingIndex >= 0) {
          return current.map((item, index) => (index === existingIndex ? { ...item, detail } : item));
        }
      }

      return [...current, nextLog].slice(-40);
    });
  }

  function renderExecutionPanel(embedded = false) {
    return (
      <div className={clsx(embedded ? "rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200" : "rounded-lg border border-slate-200 bg-white p-3 shadow-sm")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">执行面板</h2>
            <p className="mt-0.5 text-xs text-slate-500">{currentAgentOption.label}</p>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">{agentInputKind(activeAgent)}</span>
        </div>

        {reviewMode ? (
          <PdfUploadDropzone
            compact
            emptyLabel="上传 PRD PDF"
            file={reviewFile}
            isDragging={isReviewDragging}
            onClick={() => reviewInputRef.current?.click()}
            onDragChange={setIsReviewDragging}
            onPick={pickReviewFile}
          />
        ) : !analysisMode ? (
          <>
            <PdfUploadDropzone
              compact
              emptyLabel="上传 PRD PDF"
              file={file}
              isDragging={isDragging}
              onClick={() => inputRef.current?.click()}
              onDragChange={setIsDragging}
              onPick={pickFile}
            />
            <div className="mt-3 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  <SlidersHorizontal className="size-3.5" />
                  生成模式
                </p>
                <span className="text-xs text-slate-400">目标粒度</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-2">
                {generationProfiles.map((profile) => {
                  const config = generationProfileConfigs[profile];
                  const selected = generationProfile === profile;
                  return (
                    <button
                      key={profile}
                      className={clsx(
                        "min-h-9 rounded-md px-2 py-1.5 text-left text-xs ring-1 transition",
                        selected ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-teal-50 hover:text-teal-800",
                      )}
                      title={config.description}
                      type="button"
                      onClick={() => {
                        writeStoredValue(storageKeys.generationProfile, profile);
                        setStrategyDraft((current) => (current ? recalculateStrategy({ ...current, generationProfile: profile }) : current));
                      }}
                    >
                      <span className="block font-semibold">{config.shortLabel}</span>
                      <span className={clsx("mt-0.5 block leading-4", selected ? "text-slate-300" : "text-slate-400")}>{config.maxPlannedCases} 条内</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="mt-3 space-y-2">
            {activeAgent !== "debug-assistant" ? (
              <label className="block">
                <span className="text-xs font-medium text-slate-500">{getAnalysisInputLabel()}</span>
                <textarea
                  className="mt-1 min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-teal-500"
                  placeholder={currentAgentOption.placeholder}
                  value={agentInput}
                  onChange={(event) => {
                    setAgentInput(event.target.value);
                    setAgentError("");
                  }}
                />
              </label>
            ) : null}
            <AnalysisFilePicker
              description={activeAgent === "debug-assistant" ? "上传 .log、HAR、JSON、diff、patch、PDF 等现场材料。" : "上传发布说明、PR diff、变更列表或接口文档。"}
              files={agentMaterialFiles}
              title="主材料文件"
              onClear={() => setAgentMaterialFiles([])}
              onOpen={() => agentMaterialInputRef.current?.click()}
              onRemove={(index) => removeAgentFile("material", index)}
            />
            <AnalysisFilePicker
              description="上传协议、接口规范、字段字典、内部规则等依据文档，AI 会一起参考。"
              files={agentReferenceFiles}
              title="依据文档"
              onClear={() => setAgentReferenceFiles([])}
              onOpen={() => agentReferenceInputRef.current?.click()}
              onRemove={(index) => removeAgentFile("reference", index)}
            />
          </div>
        )}

        <button
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!isClientReady || (analysisMode && isAgentRunning)}
          onClick={analysisMode ? runAgentAnalysis : generate}
        >
          {isLoading || isAgentRunning ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {analysisMode
            ? isAgentRunning
              ? "智能体分析中"
              : currentAgentOption.actionLabel
            : isLoading
              ? strategyDraft
                ? "正在按策略生成，查看过程"
                : "正在生成策略，查看过程"
              : strategyDraft
                ? "按策略生成用例"
                : "生成测试策略"}
        </button>

        {(analysisMode ? agentError : error) ? (
          <div className="mt-3 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{analysisMode ? agentError : error}</span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#f6f8fb] text-slate-950">
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
        title={progressTitle}
        totalChars={receivedChars}
      />

      {(isLoading || isAgentRunning) && !progressOpen ? (
        <button
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-3 rounded-lg bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-white shadow-xl ring-1 ring-white/10 transition hover:bg-slate-800"
          type="button"
          onClick={() => setProgressOpen(true)}
        >
          <Loader2 className="size-4 animate-spin" />
          <span>
            <span className="block">{progressFloatingTitle}</span>
            <span className="mt-0.5 block text-xs font-normal text-slate-300">已运行 {formatDuration(elapsedMs)}，点击查看过程</span>
          </span>
        </button>
      ) : null}

      <div className="flex h-full min-h-0 w-full flex-col">
      <section className="shrink-0 border-b border-slate-200/80 bg-white/90 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur">
        <div className="flex h-[72px] items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-950 text-white shadow-sm ring-1 ring-slate-900/10">
              <Bot className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">TestMind</h1>
              <p className="truncate text-sm text-slate-500">AI 测试智能体工作台</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isLoading || isAgentRunning ? (
              <button
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-100"
                type="button"
                onClick={() => setProgressOpen(true)}
              >
                <Loader2 className="size-4 animate-spin" />
                <span className="hidden sm:inline">已运行 {formatDuration(elapsedMs)}</span>
              </button>
            ) : null}
            <Link
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              href="/settings"
              title="配置供应商、密钥和模型"
            >
              <Settings className="size-4" />
              <span className="hidden sm:inline">设置</span>
            </Link>
            <ThemeToggle value={themeMode} onChange={(value) => writeStoredValue(storageKeys.theme, value)} />
          </div>
        </div>
      </section>

      <input
        ref={inputRef}
        hidden
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => pickFile(event.target.files?.[0])}
      />
      <input
        ref={reviewInputRef}
        hidden
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => pickReviewFile(event.target.files?.[0])}
      />
      <input
        ref={agentMaterialInputRef}
        hidden
        multiple
        type="file"
        accept={analysisFileAccept}
        onChange={(event) => addAgentFiles(event.target.files, "material")}
      />
      <input
        ref={agentReferenceInputRef}
        hidden
        multiple
        type="file"
        accept={analysisFileAccept}
        onChange={(event) => addAgentFiles(event.target.files, "reference")}
      />

      <section className={clsx("grid min-h-0 flex-1 transition-[grid-template-columns]", workspaceGridClass)}>
        <aside className="min-w-0 border-r border-slate-200 bg-white">
          <AgentRail
            collapsed={leftRailCollapsed}
            value={activeAgent}
            onChange={selectAgent}
            onToggle={() => toggleStoredBoolean(storageKeys.leftRailCollapsed, leftRailCollapsed)}
          />
        </aside>

        <section id="case-results" className="min-w-0 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
          {analysisMode ? (
            <AgentAnalysisWorkspace
              actionSlot={renderExecutionPanel(true)}
              activeAgent={activeAgent}
              error={agentError}
              historySlot={<AgentRunHistoryPanel activeAgent={activeAgent} records={currentAgentHistory} />}
              isRunning={isAgentRunning}
              result={agentResult}
            />
          ) : (
            <>
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-stretch">
                {renderExecutionPanel()}
                <CaseRunHistoryButton count={currentAgentHistory.length} />
              </div>
              <StrategyEditorPanel
                disabled={isLoading}
                fileName={file?.name}
                strategy={strategyDraft}
                onChange={setStrategyDraft}
                onClear={() => setStrategyDraft(null)}
                onGenerate={generateCasesFromStrategy}
                onRegenerate={generateStrategy}
              />
              {result ? (
                <>
                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
                          <FileText className="size-4" />
                          生成报告
                        </div>
                        <h2 className="mt-2 text-2xl font-semibold tracking-normal">测试设计概览</h2>
                        <p className="mt-1 break-words text-sm leading-6 text-slate-500">{result.summary}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                            {result.cases.length} 条测试点
                          </span>
                          <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                            {moduleNames.length} 个模块
                          </span>
                          <span className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-700 ring-1 ring-teal-200">
                            {sourceLabel}
                          </span>
                          {result.coverageBlueprint?.generationProfile ? (
                            <span className="rounded-full bg-slate-950 px-2.5 py-1 font-medium text-white">
                              {generationProfileConfigs[normalizeGenerationProfile(result.coverageBlueprint.generationProfile)].label}模式
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <DemoExperiencePopover active={isDemoResult} open={demoDetailsOpen} onLoad={loadDemoCase} onOpenChange={setDemoDetailsOpen} />
                        <Link
                          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                          href={caseDetailHref}
                        >
                          <ListChecks className="size-4" />
                          查看全部测试点
                        </Link>
                        <button
                          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                          disabled={isExportingExcel}
                          onClick={exportExcel}
                        >
                          {isExportingExcel ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                          Excel
                        </button>
                      </div>
                    </div>

                    {result.warnings.length ? (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {result.warnings.join(" ")}
                      </div>
                    ) : null}
                  </div>

                  <RunStatsPanel result={result} />

                  {result.qualityReport ? (
                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
                            <CheckCircle2 className="size-4" />
                            质量审查
                          </div>
                          <h2 className="mt-2 text-xl font-semibold tracking-normal">{result.qualityReport.score} 分</h2>
                          <p className="mt-1 text-sm leading-6 text-slate-500">{result.qualityReport.summary}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                            <p className="text-xs text-slate-400">修订</p>
                            <p className="mt-1 font-semibold text-slate-800">{result.qualityReport.revisedCaseCount} 条</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                            <p className="text-xs text-slate-400">问题</p>
                            <p className="mt-1 font-semibold text-slate-800">{result.qualityReport.findingCount} 个</p>
                          </div>
                        </div>
                      </div>
                      {result.qualityReport.metrics?.length ? (
                        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          {result.qualityReport.metrics.map((metric) => (
                            <div key={metric.id} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-medium text-slate-500">{metric.label}</p>
                                <p className="text-sm font-semibold text-slate-900">{metric.score}</p>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                                <div className="h-full rounded-full bg-teal-600" style={{ width: `${metric.score}%` }} />
                              </div>
                              <p className="mt-2 text-xs leading-5 text-slate-500">{metric.detail}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {result.qualityReport.semanticDuplicateCount !== undefined || result.qualityReport.uncertaintyCount !== undefined ? (
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          {result.qualityReport.semanticDuplicateCount !== undefined ? (
                            <span className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                              语义合并 {result.qualityReport.semanticDuplicateCount} 条
                            </span>
                          ) : null}
                          {result.qualityReport.uncertaintyCount !== undefined ? (
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 ring-1 ring-amber-200">
                              不确定项 {result.qualityReport.uncertaintyCount} 个
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {result.qualityReport.findings.length ? (
                        <div className="mt-4 grid gap-2 lg:grid-cols-2">
                          {result.qualityReport.findings.slice(0, 4).map((finding, index) => (
                            <div key={`${finding.issueType}-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium ring-1", finding.severity === "high" ? "bg-rose-50 text-rose-700 ring-rose-200" : finding.severity === "medium" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-slate-100 text-slate-600 ring-slate-200")}>
                                  {finding.issueType}
                                </span>
                                {finding.title ? <span className="text-xs text-slate-400">{finding.title}</span> : null}
                              </div>
                              <p className="mt-2 leading-6 text-slate-700">{finding.detail}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: "模块", value: `${moduleNames.length} 个`, desc: moduleNames.slice(0, 3).join("、") || "未识别" },
                      { label: "测试点", value: `${result.cases.length} 条`, desc: result.coverageBlueprint ? `蓝图计划 ${result.coverageBlueprint.plannedCaseCount} 条` : "本地规则生成" },
                      { label: "覆盖类型", value: `${categories.filter((category) => result.cases.some((item) => item.category === category)).length} 类`, desc: categories.filter((category) => result.cases.some((item) => item.category === category)).join("、") || "待生成" },
                      { label: "导出", value: "Excel", desc: "详情页可分页查看全部测试点" },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-medium text-slate-400">{item.label}</p>
                        <p className="mt-2 text-xl font-semibold text-slate-900">{item.value}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-slate-500">{item.desc}</p>
                      </div>
                    ))}
                  </div>

                  <CoverageBlueprintPanel activeModule={activeModule} result={result} />
                </>
              ) : !strategyDraft ? (
                <div className="grid min-h-[240px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
                  <div className="w-full max-w-2xl">
                    <div className="mx-auto grid size-11 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-200">
                      <FileText className="size-5" />
                    </div>
                    <p className="mt-3 font-semibold text-slate-800">还没有生成测试用例</p>
                    <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
                      在执行面板上传 PRD 后开始生成；也可以先加载演示案例，快速查看报告概览、覆盖蓝图和详情页效果。
                    </p>
                    <div className="mt-4 grid gap-3 text-left sm:grid-cols-3">
                      {[
                        { icon: UploadCloud, title: "上传 PRD", desc: file ? "已选择文档" : "支持 PDF 文本层" },
                        { icon: KeyRound, title: "全局模型", desc: "在设置页统一维护" },
                        { icon: Sparkles, title: "生成报告", desc: "详情页查看测试点" },
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
                      className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                      type="button"
                      onClick={loadDemoCase}
                    >
                      <PlayCircle className="size-4" />
                      体验演示案例
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </section>
      </div>
    </main>
  );
}
