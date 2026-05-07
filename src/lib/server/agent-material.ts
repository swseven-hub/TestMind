import { PDFParse } from "pdf-parse";

const maxSingleFileBytes = 20 * 1024 * 1024;
const maxTotalFileBytes = 60 * 1024 * 1024;
const maxSectionChars = 60_000;
const maxReferenceSectionChars = 45_000;
const maxCombinedChars = 120_000;

const textExtensions = new Set([
  "txt",
  "log",
  "md",
  "markdown",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "yaml",
  "yml",
  "xml",
  "har",
  "diff",
  "patch",
  "sql",
  "ini",
  "conf",
  "config",
  "properties",
  "proto",
  "ts",
  "tsx",
  "js",
  "jsx",
  "java",
  "kt",
  "py",
  "go",
  "swift",
  "c",
  "cpp",
  "h",
]);

export type AgentMaterialInput = {
  manualInput: string;
  materialFiles: File[];
  referenceFiles: File[];
};

export type PreparedAgentMaterial = {
  input: string;
  warnings: string[];
  fileSummaries: string[];
};

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function fileExtension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isTextFile(file: File) {
  const extension = fileExtension(file);
  return file.type.startsWith("text/") || textExtensions.has(extension);
}

async function extractPdfText(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const parser = new PDFParse({ data });

  try {
    const parsed = await parser.getText();
    return cleanText(parsed.text);
  } finally {
    await parser.destroy();
  }
}

async function extractFileText(file: File) {
  if (file.size > maxSingleFileBytes) {
    throw new Error(`${file.name} 超过 20MB，单个分析文件不能超过 20MB。`);
  }

  if (isPdfFile(file)) return extractPdfText(file);
  if (isTextFile(file)) return cleanText(await file.text());

  throw new Error(`${file.name} 暂不支持解析。请上传 PDF、日志、Markdown、JSON、HAR、diff、patch 或常见文本文件。`);
}

function isSignalLine(line: string) {
  return /(?:error|exception|traceback|caused by|failed|failure|timeout|panic|fatal|warn|500|4\d\d|5\d\d|traceId|requestId|spanId|diff --git|@@|^\+|^-|commit|GET |POST |PUT |PATCH |DELETE |\/api|status|request|response|payload|header|token|sql|select|insert|update|delete|bluetooth|ble|gatt|uuid|characteristic|service|opcode|蓝牙|协议|特征值|服务|指令|错误|异常|失败|超时|崩溃|接口|入参|出参|状态码|请求|响应|日志|堆栈|提交|版本)/i.test(
    line,
  );
}

function takeChars(lines: string[], limit: number) {
  const result: string[] = [];
  let used = 0;
  for (const line of lines) {
    const next = line.length + 1;
    if (used + next > limit) break;
    result.push(line);
    used += next;
  }
  return result.join("\n");
}

function compactText(text: string, limit: number) {
  const source = cleanText(text);
  if (source.length <= limit) return { text: source, truncated: false };

  const lines = source.split("\n").map((line) => line.trimEnd());
  const headLimit = Math.floor(limit * 0.3);
  const signalLimit = Math.floor(limit * 0.45);
  const tailLimit = Math.max(1_000, limit - headLimit - signalLimit - 260);
  const head = source.slice(0, headLimit);
  const tail = source.slice(Math.max(0, source.length - tailLimit));
  const seen = new Set<string>();
  const signals = lines.filter((line) => {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized) || !isSignalLine(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  return {
    text: [
      head,
      "\n\n【中间内容过长，以下保留关键错误/接口/diff/协议片段】",
      takeChars(signals, signalLimit),
      "\n\n【材料结尾】",
      tail,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, limit),
    truncated: true,
  };
}

function buildSection(title: string, body: string, limit: number) {
  const compacted = compactText(body, limit);
  return {
    text: `【${title}${compacted.truncated ? "（已压缩）" : ""}】\n${compacted.text}`,
    truncated: compacted.truncated,
  };
}

function formatFileSize(file: File) {
  return `${(file.size / 1024 / 1024).toFixed(2)} MB`;
}

export async function prepareAgentMaterial({ manualInput, materialFiles, referenceFiles }: AgentMaterialInput): Promise<PreparedAgentMaterial> {
  const warnings: string[] = [];
  const fileSummaries: string[] = [];
  const files = [...materialFiles, ...referenceFiles];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > maxTotalFileBytes) throw new Error("上传文件总大小不能超过 60MB。");

  const materialSections: string[] = [];
  const referenceSections: string[] = [];
  const manualText = cleanText(manualInput);

  if (manualText) {
    const section = buildSection("手动输入材料", manualText, maxSectionChars);
    if (section.truncated) warnings.push("手动输入内容过长，已自动保留开头、关键片段和结尾。");
    materialSections.push(section.text);
  }

  for (const file of materialFiles) {
    const text = await extractFileText(file);
    if (text.length < 10) {
      warnings.push(`${file.name} 未提取到足够文本，已跳过。`);
      continue;
    }
    const section = buildSection(`主材料文件：${file.name}`, text, maxSectionChars);
    if (section.truncated) warnings.push(`${file.name} 内容过长，已自动压缩。`);
    materialSections.push(section.text);
    fileSummaries.push(`主材料 ${file.name} / ${formatFileSize(file)} / ${text.length.toLocaleString("zh-CN")} 字符`);
  }

  for (const file of referenceFiles) {
    const text = await extractFileText(file);
    if (text.length < 10) {
      warnings.push(`${file.name} 未提取到足够文本，已跳过。`);
      continue;
    }
    const section = buildSection(`依据文档：${file.name}`, text, maxReferenceSectionChars);
    if (section.truncated) warnings.push(`${file.name} 内容过长，已自动压缩。`);
    referenceSections.push(section.text);
    fileSummaries.push(`依据文档 ${file.name} / ${formatFileSize(file)} / ${text.length.toLocaleString("zh-CN")} 字符`);
  }

  const index = fileSummaries.length ? `【上传文件索引】\n${fileSummaries.map((item) => `- ${item}`).join("\n")}` : "";
  const combined = [index, referenceSections.join("\n\n"), materialSections.join("\n\n")].filter(Boolean).join("\n\n");
  const finalInput = compactText(combined, maxCombinedChars);
  if (finalInput.truncated) warnings.push("整体材料过长，已按日志/接口/diff/协议关键词自动压缩后提交给智能体。");

  return {
    input: finalInput.text,
    warnings,
    fileSummaries,
  };
}
