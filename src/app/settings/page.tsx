"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Monitor,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import clsx from "clsx";
import {
  aliyunModelOptions,
  deepseekModelOptions,
  getAliyunModelOption,
  getAliyunOutputPrice,
  getDeepSeekModelOption,
  getOpenAIModelOption,
  getVelotricModelOption,
  normalizeProvider,
  normalizeReasoningEffort,
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
} from "@/lib/model-config";
import { storageChangeEvent, subscribeStorage } from "@/lib/run-history";

type ThemeMode = "light" | "dark" | "system";

const providerOptions: Provider[] = ["deepseek", "aliyun", "openai", "velotric"];
const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "亮色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
  { value: "system", label: "系统", icon: Monitor },
];

const storageKeys = {
  provider: "testmind.provider",
  theme: "testmind.theme.v1",
};

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
    // Ignore localStorage failures in private browsing or restricted contexts.
  }
}

function useStoredValue(key: string, fallback: string) {
  return useSyncExternalStore(
    subscribeStorage,
    () => readStoredValue(key, fallback),
    () => fallback,
  );
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

function Field({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <div className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {description ? <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function PlatformSelect({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    function closeOnOutside(event: MouseEvent | TouchEvent) {
      if (event.target instanceof Node && rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("touchstart", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("touchstart", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={clsx(
          "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-left text-sm outline-none transition",
          open ? "border-teal-500 ring-2 ring-teal-500/10" : "border-slate-200 hover:border-slate-300",
        )}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 flex-1 break-words leading-5">{selected?.label ?? "请选择"}</span>
        <ChevronDown className={clsx("size-4 shrink-0 text-slate-500 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
          <div className="max-h-72 overflow-y-auto" role="listbox">
            {options.map((item) => {
              const active = item.value === value;
              return (
                <button
                  key={item.value}
                  aria-selected={active}
                  className={clsx(
                    "flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition",
                    active ? "bg-teal-50 text-teal-800" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950",
                  )}
                  role="option"
                  type="button"
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 break-words leading-5">{item.label}</span>
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

function ProviderDescription({ provider, model, thinkingMode, reasoningEffort }: { provider: Provider; model: string; thinkingMode: ThinkingMode; reasoningEffort: ReasoningEffort }) {
  if (provider === "aliyun") {
    const selected = getAliyunModelOption(model);
    return (
      <>
        {selected.description} 适合：{selected.suitableFor}
        <br />
        参考单价：输入 ¥{selected.pricing.inputPerMTokens}/百万 Token，输出 ¥{getAliyunOutputPrice(selected.id, thinkingMode)}/百万 Token。
      </>
    );
  }

  if (provider === "deepseek") {
    const selected = getDeepSeekModelOption(model);
    return (
      <>
        {selected.description} 适合：{selected.suitableFor}
        <br />
        参考单价：输入未命中 ¥{selected.pricing.inputCacheMissPerMTokens}/百万 Token，输出 ¥{selected.pricing.outputPerMTokens}/百万 Token。
      </>
    );
  }

  const selected = provider === "velotric" ? getVelotricModelOption(model) : getOpenAIModelOption(model);
  return (
    <>
      {selected.description} 适合：{selected.suitableFor}
      <br />
      推理等级：{reasoningEffortLabels[reasoningEffort]}。{selected.pricingNote}
    </>
  );
}

function modelOptionsForProvider(provider: Provider) {
  if (provider === "aliyun") return aliyunModelOptions.map((item) => ({ value: item.id, label: `${item.id} · ${item.badge}` }));
  if (provider === "deepseek") return deepseekModelOptions.map((item) => ({ value: item.id, label: `${item.id} · ${item.badge}` }));
  if (provider === "velotric") return velotricModelOptions.map((item) => ({ value: item.id, label: `${item.id} · ${item.badge}` }));
  return openaiModelOptions.map((item) => ({ value: item.id, label: `${item.id} · ${item.badge}` }));
}

export default function SettingsPage() {
  const provider = normalizeProvider(useStoredValue(storageKeys.provider, "deepseek"));
  const apiKey = useStoredValue(apiKeyStorageKey(provider), "");
  const model = useStoredValue(modelStorageKey(provider), providerModels[provider]);
  const baseURL = useStoredValue(baseURLStorageKey(provider), providerBaseURLs[provider] ?? "");
  const thinkingMode = normalizeThinkingMode(useStoredValue(thinkingModeStorageKey(provider), "fast"));
  const reasoningEffort = normalizeReasoningEffort(useStoredValue(reasoningEffortStorageKey(provider), "medium"));
  const themeMode = useThemeMode();
  const [showApiKey, setShowApiKey] = useState(false);

  function selectProvider(nextProvider: Provider) {
    writeStoredValue(storageKeys.provider, nextProvider);
    if (!readStoredValue(modelStorageKey(nextProvider), "")) writeStoredValue(modelStorageKey(nextProvider), providerModels[nextProvider]);
    if (!readStoredValue(thinkingModeStorageKey(nextProvider), "")) writeStoredValue(thinkingModeStorageKey(nextProvider), "fast");
    if (!readStoredValue(reasoningEffortStorageKey(nextProvider), "")) writeStoredValue(reasoningEffortStorageKey(nextProvider), "medium");
    if (providerBaseURLs[nextProvider] && !readStoredValue(baseURLStorageKey(nextProvider), "")) {
      writeStoredValue(baseURLStorageKey(nextProvider), providerBaseURLs[nextProvider] ?? "");
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <section className="border-b border-slate-200/80 bg-white/90 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-5 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-slate-950 text-white shadow-sm ring-1 ring-slate-900/10">
              <Settings className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">设置</h1>
              <p className="text-sm text-slate-500">供应商、密钥、模型和主题</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50" href="/">
              <ArrowLeft className="size-4" />
              返回工作台
            </Link>
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              {themeOptions.map((item) => {
                const Icon = item.icon;
                const active = themeMode === item.value;
                return (
                  <button
                    key={item.value}
                    aria-label={`切换到${item.label}模式`}
                    className={clsx("grid size-8 place-items-center rounded-md text-slate-500 transition", active ? "bg-slate-950 text-white" : "hover:bg-slate-50 hover:text-slate-800")}
                    title={item.label}
                    type="button"
                    onClick={() => writeStoredValue(storageKeys.theme, item.value)}
                  >
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1200px] gap-5 px-5 py-5 sm:px-8 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-950 text-white">
                <Bot className="size-4" />
              </span>
              <div>
                <h2 className="font-semibold">当前配置</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {providerLabels[provider]} / {model || providerModels[provider]}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <span className="text-slate-500">密钥</span>
                <span className={clsx("font-medium", apiKey.trim() ? "text-teal-700" : "text-slate-400")}>{apiKey.trim() ? "已保存" : "未保存"}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <span className="text-slate-500">推理</span>
                <span className="font-medium text-slate-700">{provider === "aliyun" ? thinkingModeLabels[thinkingMode] : reasoningEffortLabels[reasoningEffort]}</span>
              </div>
            </div>
          </div>
        </aside>

        <section className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
              <KeyRound className="size-4" />
              密钥与模型
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal">模型设置</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">配置会保存在本机浏览器，首页智能体运行时会自动读取。</p>

            <div className="mt-5 grid gap-4">
              <Field label="供应商" description="Velotric 号池需要公司 Key 和公司网关。">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {providerOptions.map((item) => {
                    const active = provider === item;
                    return (
                      <button
                        key={item}
                        className={clsx(
                          "flex min-h-16 items-start justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm transition ring-1",
                          active ? "bg-slate-950 text-white ring-slate-950" : "bg-slate-50 text-slate-700 ring-slate-200 hover:bg-teal-50 hover:text-teal-800 hover:ring-teal-200",
                        )}
                        type="button"
                        onClick={() => selectProvider(item)}
                      >
                        <span>
                          <span className="block font-semibold">{providerLabels[item]}</span>
                          <span className={clsx("mt-1 block text-xs", active ? "text-slate-300" : "text-slate-500")}>{item === "velotric" ? "公司网关" : item === "aliyun" ? "百炼兼容" : item === "openai" ? "官方 API" : "默认推荐"}</span>
                        </span>
                        {active ? <CheckCircle2 className="size-4 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="API Key" description={apiKey.trim() ? "密钥已保存在本机浏览器。" : "不填写时，分析类智能体会使用本地规则兜底；用例生成也会走本地兜底。"}>
                <div className="relative">
                  <input
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-11 text-sm outline-none transition focus:border-teal-500"
                    type={showApiKey ? "text" : "password"}
                    placeholder={provider === "velotric" ? "sk-velotric-..." : "sk-..."}
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
                <button
                  className="mt-2 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-300"
                  disabled={!apiKey.trim()}
                  type="button"
                  onClick={() => writeStoredValue(apiKeyStorageKey(provider), "")}
                >
                  清除密钥
                </button>
              </Field>

              {provider === "velotric" ? (
                <Field label="公司网关地址" description="Velotric 公司 Key 必须走公司 AI 网关。">
                  <input
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                    placeholder={providerBaseURLs.velotric}
                    value={baseURL}
                    spellCheck={false}
                    onChange={(event) => writeStoredValue(baseURLStorageKey(provider), event.target.value)}
                  />
                </Field>
              ) : null}

              <Field label="模型" description="首页所有智能体都会使用这里选择的模型。">
                <PlatformSelect
                  options={modelOptionsForProvider(provider)}
                  value={model || providerModels[provider]}
                  onChange={(value) => writeStoredValue(modelStorageKey(provider), value)}
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  <ProviderDescription provider={provider} model={model || providerModels[provider]} thinkingMode={thinkingMode} reasoningEffort={reasoningEffort} />
                </p>
              </Field>

              {provider === "aliyun" ? (
                <Field label="生成模式">
                  <div className="grid grid-cols-2 rounded-lg bg-slate-50 p-1 ring-1 ring-slate-200">
                    {(["fast", "quality"] as const).map((item) => (
                      <button
                        key={item}
                        className={clsx("min-h-9 rounded-md px-2 text-sm font-medium transition", thinkingMode === item ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white")}
                        type="button"
                        onClick={() => writeStoredValue(thinkingModeStorageKey(provider), item)}
                      >
                        {thinkingModeLabels[item]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{thinkingModeDescriptions[thinkingMode]}</p>
                </Field>
              ) : (
                <Field label="推理等级">
                  <PlatformSelect
                    options={reasoningEffortOptions.map((item) => ({ value: item, label: `${reasoningEffortLabels[item]} · ${reasoningEffortDescriptions[item]}` }))}
                    value={reasoningEffort}
                    onChange={(value) => writeStoredValue(reasoningEffortStorageKey(provider), value)}
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">{reasoningEffortDescriptions[reasoningEffort]}</p>
                </Field>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
