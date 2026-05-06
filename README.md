# TestMind

> 面向 PRD 的 AI 测试用例生成工具。上传需求文档 PDF，选择大模型供应商，即可按功能模块生成覆盖功能、边界、异常、权限、性能的测试用例。

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-38bdf8?logo=tailwindcss)
![AI](https://img.shields.io/badge/AI-DeepSeek%20%7C%20DashScope%20%7C%20OpenAI-10b981)

## 项目简介

TestMind 是一个 Web 版 AI 测试用例生成工具，适合测试、产品、研发团队在需求评审、测试设计和回归准备阶段使用。

它的核心目标不是简单“总结 PRD”，而是尽量按照真实测试设计思路工作：

- 先识别 PRD 中的业务模块、子模块、角色、流程、字段规则、状态变化和风险点。
- 再生成“覆盖蓝图”，按 PRD 复杂度、测试点数量、风险等级和适用测试类型估算应该生成多少用例。
- 再按模块逐步生成测试用例，避免一次性生成超长 JSON 导致内容截断或格式损坏。
- 对每个模块做覆盖补偿，尤其关注“功能类逆向用例”和蓝图缺口。
- 最终由后端合并、去重、重新编号和统计，避免模型自己编造总数。

## 功能特性

| 能力 | 说明 |
| --- | --- |
| PDF 上传 | 支持上传 PRD PDF，并提取文本内容用于生成 |
| 多模型供应商 | 支持 DeepSeek、阿里云百炼 / DashScope、OpenAI |
| 网页填写 API Key | 可直接在页面输入 API Key，本地使用更方便 |
| 内嵌演示案例 | 无需上传 PDF、无需填写 API Key，一键加载示例 PRD 的测试用例 |
| 自适应覆盖蓝图 | 根据 PRD 复杂度、模块风险和适用测试类型决定用例数量 |
| 多阶段生成 | 覆盖蓝图 -> 分模块生成 -> 缺口补偿 -> 合并统计 |
| 模块化浏览 | 左侧按功能模块展示，右侧按模块分组查看测试用例 |
| 类型筛选 | 支持功能、边界、异常、权限、性能分类筛选 |
| 实时进度弹窗 | 生成时展示阶段日志、模型调用状态和实时输出片段 |
| 导出结果 | 支持导出 JSON 和 CSV |
| 本地兜底 | 没有 API Key 时可用本地规则生成演示结果 |

## 生成策略

TestMind 当前采用“覆盖蓝图 + 分阶段生成”策略。

```mermaid
flowchart LR
  A["上传 PRD PDF"] --> B["解析 PDF 文本"]
  B --> C["阶段 1：生成覆盖蓝图"]
  C --> D["阶段 2：逐模块生成用例"]
  D --> E["质量检查：按蓝图补缺口"]
  E --> F["阶段 3：合并、去重、编号、统计"]
  F --> G["页面展示与导出"]
```

### 阶段 1：生成覆盖蓝图

模型会先识别和评估：

- 一级模块、子模块、页面、接口、流程、任务
- 用户角色、业务对象、字段规则、参数范围
- 状态机、业务规则、审批 / 流转
- 通知、报表、导入导出、第三方集成
- 权限、安全、审计、异常、性能相关能力
- 整体 PRD 复杂度：极简 / 简单 / 中等 / 复杂 / 大型
- 每个模块的风险等级、适用测试类型和建议用例数量

### 阶段 2：逐模块生成

每个模块单独调用模型生成测试用例，减少一次性输出过长导致的丢失、截断和 JSON 解析失败。

用例数量不再按固定下限硬凑，而是由覆盖蓝图决定：

- 极简模块可以只生成少量关键用例。
- 简单模块优先覆盖显式功能和主要失败路径。
- 复杂模块会按字段、状态、权限、异常、性能等风险展开。
- 不适用的类型不会强行生成，例如没有角色或登录态的模块不会硬凑权限用例。

### 阶段 3：后端真实统计

最终结果由后端负责：

- 合并所有模块结果
- 去重
- 重新编号
- 统计真实用例数量
- 生成可信 summary

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | Next.js App Router、React、TypeScript、Tailwind CSS、lucide-react |
| 后端 | Next.js Route Handler、Node.js Runtime |
| PDF 解析 | pdf-parse |
| AI SDK | OpenAI SDK 兼容 DeepSeek / DashScope / OpenAI |
| JSON 修复 | jsonrepair |
| 导出 | 浏览器端 JSON / CSV 下载 |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务

```bash
npm run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

### 3. 构建生产版本

```bash
npm run build
npm run start
```

## 模型配置

你有两种方式使用 API Key。

### 方式一：网页临时填写

打开页面后，在左侧 API Key 区域选择供应商并填写 Key。

这种方式适合本地调试和快速演示。Key 不会写入项目文件，也不会提交到仓库。

### 方式二：服务端环境变量

复制 `.env.example` 为 `.env.local`：

```bash
cp .env.example .env.local
```

然后按需填写：

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash

DASHSCOPE_API_KEY=
DASHSCOPE_MODEL=qwen-plus
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

> 注意：阿里云这里需要填写的是百炼 / DashScope API Key，不是阿里云账号 AccessKey ID / Secret。

## 使用流程

### 快速体验演示

如果只是想先看效果，可以直接点击页面左侧的“一键体验演示案例”。

内嵌示例会直接加载一份“会员任务中心”PRD 的测试用例结果，方便体验：

- 模块分组展示
- 功能 / 边界 / 异常 / 权限 / 性能筛选
- 用例搜索
- JSON / CSV 导出

这个流程不需要上传 PDF，也不需要填写 API Key。

### 使用真实 PRD 生成

1. 打开页面。
2. 选择模型供应商：DeepSeek、阿里云百炼或 OpenAI。
3. 填写 API Key，或使用 `.env.local` 中的服务端 Key。
4. 上传 PRD PDF。
5. 点击“生成测试用例”。
6. 在弹窗中查看生成过程：
   - 是否读取到 API Key
   - 是否调用模型
   - PDF 解析字符数
   - 当前生成到哪个模块
   - 模型实时输出片段
7. 生成完成后按模块查看测试用例。
8. 根据需要导出 JSON 或 CSV。

## 输出字段

每条测试用例包含：

| 字段 | 说明 |
| --- | --- |
| id | 用例编号 |
| category | 用例类型：功能 / 边界 / 异常 / 权限 / 性能 |
| title | 用例标题 |
| priority | 优先级：P0 / P1 / P2 |
| module | 所属功能模块 |
| preconditions | 前置条件 |
| steps | 操作步骤 |
| expectedResult | 预期结果 |

## 质量策略

为了避免只生成正向用例或盲目硬凑数量，TestMind 增加了模块级质量检查：

- 功能用例必须是数量最多的分类。
- 每个涉及操作、提交、状态变更、字段校验、权限校验、奖励 / 资金 / 隐私 / 数据影响的测试点，尽量覆盖正向和主要逆向功能路径。
- 如果某个模块的功能逆向、边界、异常、权限或性能用例低于覆盖蓝图，后端会触发补充生成。
- 补充方向是通用的，不绑定某个行业：
  - 身份 / 访问问题
  - 表单 / 字段问题
  - 流程 / 状态问题
  - 配置 / 规则问题
  - 数据 / 展示问题
  - 集成 / 依赖问题
  - 安全 / 合规问题

## 目录结构

```text
.
├── src
│   ├── app
│   │   ├── api
│   │   │   └── generate
│   │   │       ├── route.ts          # 普通生成接口
│   │   │       └── stream/route.ts   # 流式多阶段生成接口
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx                  # 主页面
│   ├── lib
│   │   └── test-case-generator.ts    # 本地兜底生成逻辑
│   └── types
│       └── test-case.ts              # 测试用例类型定义
├── .env.example
├── package.json
└── README.md
```

## 安全说明

- `.env` 和 `.env.local` 已被 `.gitignore` 忽略，不应提交 API Key。
- 网页输入的 API Key 仅随本次请求发送到本地后端。
- 如果 API Key 曾经公开出现在聊天、截图或日志里，请立即去对应平台重置。
- 上传 PDF 会在本地服务中解析文本，当前项目未实现用户系统、权限隔离或持久化存储。

## 常见问题

### 为什么生成时弹窗里只显示最近一部分模型输出？

为了避免浏览器渲染超长文本变慢，页面只展示最近 16,000 字符，但会显示模型实际累计接收字符数。

### 为什么不用一次性生成所有用例？

一次性生成超长 JSON 容易出现截断、少逗号、少括号或统计不一致。当前采用多阶段逐模块生成，更稳定，也更容易做覆盖补偿。

### 没有 API Key 能使用吗？

可以。页面内置了“一键体验演示案例”，不需要 API Key；如果上传真实 PRD 但没有 API Key，则会使用本地规则生成兜底结果，质量和覆盖度不如大模型生成。

## English Summary

TestMind is an AI-powered PRD test case generator. Upload a PRD PDF, choose an AI provider, and generate module-first test cases covering functional, boundary, exception, permission, and performance scenarios.

### Highlights

- PDF PRD upload and text extraction
- Multi-provider support: DeepSeek, Alibaba Cloud Model Studio / DashScope, OpenAI
- Multi-stage generation: module discovery, per-module generation, negative coverage repair, final merge
- Built-in demo case for instant hands-on experience without uploading a PDF or entering an API key
- Streaming progress modal
- Module-first browsing and category filtering
- JSON / CSV export

### Quick Start

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

Server-side API keys can be configured in `.env.local`, or entered directly in the web UI for local use.
