# TestMind

AI-powered PRD test case generator. Upload a PRD PDF, choose an AI provider, and generate module-first test cases covering functional, boundary, exception, permission, and performance scenarios.

## Features

- PDF PRD upload and text extraction
- Multi-provider model support: DeepSeek, Alibaba Cloud Model Studio/DashScope, OpenAI
- Multi-stage generation: module discovery, per-module case generation, coverage repair, final merge
- Module-first result browsing with category filters
- Streaming generation progress modal
- JSON and CSV export
- Local fallback generation when no API key is provided

## Getting Started

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000.

## Environment Variables

Copy `.env.example` to `.env.local` if you want to configure server-side API keys:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
DASHSCOPE_API_KEY=
DASHSCOPE_MODEL=qwen-plus
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

You can also enter an API key directly in the web UI for local use.
