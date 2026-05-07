# TestMind Agent 说明

## 项目概览

TestMind 是一个本地运行的 Next.js AI 测试智能体工作台，用来支撑唯一测试在需求评审、用例生成、发布风险、变更影响和 Bug 根因分析中的高频工作。核心流程是：

1. 选择测试智能体。
2. 上传 PRD PDF，或粘贴/上传发布材料、git diff / PR、日志堆栈、请求现场等材料；分析类智能体还可以上传协议、接口规范、字段字典等依据文档。
3. 选择 AI 供应商、模型，以及可选的推理等级或生成模式。
4. 后端流式返回生成或分析进度：解析 PDF、生成覆盖蓝图、按模块生成用例，或输出结构化分析报告。
5. 前端支持查看 AI 过程、筛选/搜索测试用例、查看覆盖蓝图和运行统计、导出 Excel，或回看历史记录。

主要用户是产品、测试和研发团队。界面文案保持中文，表达要短、清晰、偏工具型。

## 技术栈与命令

- 框架：Next.js 16 App Router、React 19、TypeScript strict、Tailwind CSS v4。
- 运行库：`openai`、`pdf-parse`、`jsonrepair`、`exceljs`、`node:sqlite`、`lucide-react`、`clsx`。
- 路径别名：`@/*` 指向 `src/*`。
- 开发启动：`npm run dev`。
- 生产构建检查：`npm run build`。
- 代码检查：`npm run lint`。
- 默认本地地址：`http://127.0.0.1:3000` 或 `http://localhost:3000`。

`next.config.ts` 里有两个重要配置：`serverExternalPackages: ["pdf-parse"]` 和 `allowedDevOrigins: ["127.0.0.1"]`。除非明确知道运行时或浏览器影响，否则不要移除。

## 关键文件

- `src/app/page.tsx`：首页客户端 UI。负责智能体选择、材料上传、流式 NDJSON 消费、进度弹窗、演示数据、筛选、搜索、用例卡片、覆盖蓝图、统计和 Excel 导出。
- `src/app/settings/page.tsx`：设置页客户端 UI。负责供应商、API Key、模型、推理等级、Velotric 网关和主题配置。
- `src/app/history/page.tsx`：运行记录页。通过客户端 helper 读取 SQLite 记录，支持删除、清空、导出，以及失败/停止诊断展示。
- `src/app/api/generate/stream/route.ts`：首页实际使用的核心生成接口。Node runtime，`maxDuration = 300`，返回按行分隔的 JSON 流事件。
- `src/app/api/generate/route.ts`：旧版非流式生成接口。首页不走它，但改供应商或响应结构时要尽量保持兼容。
- `src/app/api/agents/analyze/stream/route.ts`：分析类智能体主接口，支持需求评审、发布风险、变更影响和 Bug 根因分析的过程流。
- `src/app/api/agents/analyze/route.ts`：分析类智能体非流式接口，主要用于兼容和接口冒烟。
- `src/app/api/export/excel/route.ts`：ExcelJS 导出接口，对齐测试用例导入模板。
- `src/app/api/run-history/route.ts`：运行历史 GET/POST/DELETE 接口，也负责旧 localStorage 记录迁移。
- `src/lib/model-config.ts`：供应商、模型默认值、标签、价格说明、生成模式、推理等级和费用估算。
- `src/lib/test-agent.ts`：测试智能体类型归一化、本地兜底分析、模型提示词和结构化报告归一化。
- `src/lib/server/agent-material.ts`：分析类智能体上传文件解析、长材料压缩、主材料和依据文档合并。
- `src/lib/testcase-template.ts`：Excel 模板表头、默认维护人、字段归一化、用例类型映射和行数据构造。
- `src/lib/server/run-history-db.ts`：SQLite 建表、迁移、保存、查询、删除和清空。
- `src/lib/test-case-generator.ts`：没有 API Key 时使用的本地兜底规则生成器。
- `src/lib/demo-test-cases.ts`：首页“快速体验”使用的内嵌演示结果。
- `src/types/test-case.ts`：测试用例、覆盖蓝图、运行统计、供应商和运行状态等核心类型。
- `docs/*.md` 和 `docs/*.pdf`：用于手工测试和文档说明的演示 PRD。

## 核心约定

- 供应商只能是 `deepseek`、`aliyun`、`openai`、`velotric`。
- 默认模型在 `providerModels` 中：DeepSeek 为 `deepseek-v4-flash`，阿里云百炼为 `qwen-plus`，OpenAI 为 `gpt-5.4-mini`，Velotric 为 `gpt-5.4`。
- 环境变量 Key：`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`、`VELOTRIC_API_KEY`；对应模型和 base URL 示例在 `.env.example`。
- Velotric 公司 Key 必须选择 Velotric 供应商，并走公司网关，默认通常是 `https://api-ai.velotric.net`。
- 测试类型是中文字符串字面量：`功能`、`边界`、`异常`、`权限`、`性能`。
- 优先级是 `P0`、`P1`、`P2`；执行方式当前固定为 `手动`。
- 智能体类型是 `requirement-review`、`case-generator`、`release-risk`、`change-impact`、`debug-assistant`。
- 分析类智能体是除 `case-generator` 外的所有类型，统一走 `/api/agents/analyze/stream`。
- 发布风险、变更影响和 Bug 根因支持 `files` 主材料上传和 `referenceFiles` 依据文档上传。支持 PDF、日志、Markdown、JSON、HAR、diff、patch、SQL、proto 和常见文本/代码文件；单文件不超过 20MB，总文件不超过 60MB。
- 分析材料过长时不要直接拒绝，应通过 `agent-material.ts` 保留开头、关键错误/接口/diff/协议片段和结尾，再传给智能体。
- `GenerateResponse` 是前后端结果契约，包含 `source`、`fileName`、`summary`、`cases`、`warnings`，以及可选的 `coverageBlueprint` 和 `stats`。
- `/api/generate/stream` 的流事件是一行一个 JSON 对象，类型包括 `stage`、`thinking`、`chunk`、`result`、`error`、`done`。
- `/api/agents/analyze/stream` 也使用一行一个 JSON 对象，类型包括 `stage`、`thinking`、`chunk`、`result`、`error`、`done`。
- Excel 导出最多 5000 条用例，工作表名是 `test_case`。默认维护人和关注人是 `杨思伟`。
- 运行历史保存在 `data/testmind.sqlite`，该文件被 git 忽略，不能提交。

## 生成链路

流式生成接口是事实上的主链路：

1. 校验 FormData：`file`、`provider`、`model`、`apiKey`、`thinkingMode`、`reasoningEffort`，以及仅 Velotric 使用的 `baseURL`。
2. 使用 `pdf-parse` 提取 PDF 文本；拒绝非 PDF、超过 15 MB、或可提取文本少于 30 字符的文件。
3. 如果没有 API Key，使用 `generateFallbackCases`，结果来源标记为 `fallback`。
4. 如果有 API Key，先通过 `generateModulePlan` 生成覆盖蓝图。
5. 对每个模块调用 `generateCasesForModule` 生成模块用例。
6. 使用 `getCoverageGaps` 检查缺口；如有缺口，调用 `generateCoverageRepairCasesForModule` 补充。
7. 归一化、去重、重新编号为 `TC-001` 格式，生成 summary/stats，估算阿里云或 DeepSeek 费用，并保存运行历史。
8. 失败或用户停止时，也会保存部分结果、失败阶段、序列化错误、最后一次事件和已生成用例。

DeepSeek 在 JSON 输出为空时最多重试 3 次，最后一次会改用普通流式输出再提取 JSON。Velotric 对临时流错误自动重试 1 次，并使用更保守的 token 上限。

## UI 与状态

- `page.tsx` 是客户端组件。供应商、模型、API Key、生成模式、推理等级和 Velotric base URL 都保存在浏览器 localStorage。
- 首页不再展开密钥与模型配置，只显示当前模型摘要和设置入口；模型、密钥、推理等级和 Velotric 网关统一维护在 `/settings`。
- Bug 根因智能体不显示“Bug 现场材料”文本框，主材料通过文件上传；发布风险和变更影响仍保留文本输入并支持文件上传。
- localStorage 更新通过 `storageChangeEvent` 和 `useSyncExternalStore` 同步；这套模式是为了避免 hydration 问题，改动时要谨慎。
- `useClientReady` 控制首页模型摘要和运行按钮：服务端先用默认配置，客户端 ready 后读取真实本地配置。
- 首页用 `ReadableStreamDefaultReader` 读取流式结果；进度弹窗只保留最近 16,000 个模型输出字符，同时单独统计累计字符数。
- 演示数据不调用后端，适合做 UI、筛选、搜索和导出冒烟测试。
- 历史记录客户端缓存在 `src/lib/run-history.ts`，通过 `/api/run-history` 刷新；旧的 `testmind.runHistory.v1` localStorage 记录会迁移到 SQLite。

## 修改指南

- 改动要尽量收敛。这个项目的主要逻辑集中在 `page.tsx` 和 `generate/stream/route.ts`，除非能直接降低风险，否则不要做大范围重构。
- 不要提交生成数据或用户数据：`.env`、`.env*.local`、`.next`、`node_modules`、`.DS_Store`、`data/*.sqlite*`。
- 不要手动编辑 `next-env.d.ts`，它由 Next 自动更新。
- 新增或修改供应商/模型时，要同步更新 `model-config.ts`、两个 generate route、首页配置控件、`.env.example`，以及面向用户的 README/AGENTS 说明。
- 修改测试用例字段时，要同步更新 `src/types/test-case.ts`、流式 route 的归一化逻辑、`testcase-template.ts`、Excel 导出、首页卡片、历史页卡片和提示词。
- 修改流式事件结构时，要同时更新后端 route 和 `page.tsx` 里的 `StreamEvent`。
- 保留中文 UI 文案和精确的 category/provider 字符串联合类型。这些字符串同时用于筛选、Excel、提示词和持久化历史。
- 图标优先复用已有 Lucide 图标。视觉风格保持当前这种密集、克制、偏工作台的工具界面，不要做成营销落地页。

## Git 提交与推送

- 每次完成用户交代的任务后，只要产生了仓库文件改动，就自动提交并推送到远程仓库。
- 远程仓库地址：`https://github.com/swseven-hub/TestMind`。如果 `origin` 不存在，应将它设置为该地址；如果已存在但地址不同，先向用户说明，不要直接覆盖。
- 提交前必须查看 `git status` 和 diff，只暂存本次任务相关文件；不要把无关的用户改动、密钥、SQLite 数据库、构建产物或 `.DS_Store` 一起提交。
- 提交前按改动类型运行必要校验，代码改动至少运行 `npm run lint`；如果校验失败，先修复或在最终说明中明确失败原因。
- 提交信息使用中文，并遵循 Conventional Commits 风格：`类型(范围): 简短中文说明`。常用类型包括 `feat`、`fix`、`docs`、`refactor`、`test`、`chore`。
- 示例：`docs(agents): 补充项目协作说明`、`fix(api-key): 修复配置区骨架屏不消失`。
- 推送默认使用当前分支到 `origin`。如果当前分支没有 upstream，使用 `git push -u origin 当前分支名`。
- 如果当前任务只是答疑、排查而没有文件改动，不需要创建空提交。

## 测试清单

- 代码改动后运行 `npm run lint`。
- 前端改动后运行 `npm run dev` 并在浏览器验证：
  - 首页模型设置入口能跳转 `/settings`。
  - 设置页能切换供应商、模型和推理等级，并能返回工作台。
  - Bug 根因智能体不显示文本框，上传主材料文件后能运行。
  - 快速体验能加载 36 条演示用例，筛选和搜索可用。
  - 演示结果或历史记录可以导出 Excel。
  - 历史页能加载、选择记录，删除和清空按钮行为正常。
- 后端或生成链路改动后，至少用 `docs/` 里的演示 PDF 测一次无 Key 兜底上传；只有在有有效 Key 时再测真实供应商。
- SQLite/历史记录改动后，验证 `/api/run-history` GET，并确认失败/停止记录仍能展示诊断信息。
- Excel 模板改动后，打开或检查生成的 workbook，确认表头、行数上限、多行步骤换行和 sheet 名正确。

## 常见坑

- 如果首页模型摘要或设置页配置不同步，优先检查 `storageChangeEvent`、`useSyncExternalStore`、hydration 和 Next dev-origin 警告。使用 `127.0.0.1` 时，`allowedDevOrigins` 需要包含 `127.0.0.1`。
- 如果公司 Key 返回 401，通常是选成了 OpenAI 而不是 Velotric，或没有走 Velotric 公司网关。
- 如果服务无法监听 3000 端口，可能是当前环境有沙盒限制；需要申请权限，或请用户在本机终端运行 `npm run dev`。
- 如果 PDF 提取文本少于 30 个字符，通常说明 PDF 没有文本层，需要 OCR 或换可复制文本来源。
- 项目直接使用 `node:sqlite` 的 `DatabaseSync`；如果历史记录相关功能异常，先确认 Node 版本是否支持。
- Velotric 出现 `stream error: INTERNAL_ERROR` 会被当作临时错误重试一次；如果持续失败，多半是网关、模型权限或上游稳定性问题。
