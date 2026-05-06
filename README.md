# my-kb — AI 驱动的个人知识库

> [English](./README.en.md) | 简体中文

> 通过聊天、网页链接、RSS 订阅和文件上传收集信息。大语言模型（LLM）自动将原始内容加工成结构化的知识笔记，并以 Markdown 文件形式持久化存储在本地文件系统中。

## 核心工作流

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  入库    │ ──→ │  收件箱  │ ──→ │  队列    │ ──→ │  笔记    │
│(网页/RSS/│     │ (人工    │     │ (LLM     │     │(结构化   │
│PDF/文本) │     │  审核)   │     │  处理)   │     │ Markdown)│
└──────────┘     └──────────┘     └──────────┘     └──────────┘
       │                                                    │
       └────────────────── 聊天 ←───────────────────────────┘
```

- **入库（Ingest）**：网页链接、RSS 订阅、PDF/TXT/MD 文件、纯文本——均可附加**用户提示**，引导 LLM 的提取重点
- **收件箱审核**：待处理内容经用户确认（或自动批准）后进入加工流程
- **LLM 加工**：调用配置的 Anthropic Messages API 兼容端点，自动提取标签、摘要、关键事实、时间线、关联、问答等结构化信息
- **设置**：通过设置面板在运行时动态配置 LLM 凭据、模型、RSS 轮询间隔和关联刷新计划——无需重启服务器
- **知识笔记**：以 Markdown + YAML Frontmatter 形式存储在本地文件系统；笔记状态（`seed`/`growing`/`evergreen`/`stale`/`archived`）根据你的熟悉度自动演进
- **搜索**：笔记面板支持服务端全文搜索；基于 ripgrep，匹配标题/摘要/标签
- **聊天**：流式 AI 对话，支持 RAG 检索 +**用户记忆**——搜索知识库，将相关知识*和*你的个人画像/偏好注入系统提示词；当知识不足时，LLM 可调用 `web_fetch` 工具实时抓取网页补充回答
- **实时推送**：类型化的 SSE 事件将所有笔记/任务/收件箱变更即时推送到所有已连接客户端，并通过 Toast 通知反馈操作结果

## 技术栈

![Next.js](https://img.shields.io/badge/Next.js-16.2-000?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss)
![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright)
![Vitest](https://img.shields.io/badge/Vitest-Unit-6E9F18?logo=vitest)

- **框架**：Next.js 16 App Router + React 19
- **语言**：TypeScript 5（严格模式）
- **样式**：Tailwind CSS + 自定义 CSS 变量（深色主题）
- **AI 流式**：`ai` SDK + Anthropic Messages API
- **网页抓取**：TinyFish（主） + Camoufox + trafilatura（兜底）；按类型隔离的 Worker 防止任务互相阻塞
- **RSS**：`feedsmith` + 增量更新（`lastPubDate` 水位线），异步队列抓取
- **搜索**：jieba 中文分词倒排索引 + Zone 加权评分用于聊天 RAG；笔记面板搜索使用 ripgrep 全文回退；5 分钟 TTL 内存缓存
- **存储**：纯文件系统（`knowledge/` 目录），原子写入
- **测试**：Vitest（307+ 单元测试）+ Playwright（50+ E2E 测试）
- **实时通信**：类型化 SSE 事件总线（`note`/`task`/`inbox`），支持自动重连、Toast 通知和连接状态指示器

## 快速开始

### 1. 克隆与安装

```bash
git clone https://github.com/ayokaa/my-kb.git
cd my-kb
npm install

# 创建 Python 虚拟环境并安装网页抓取依赖
uv venv && uv pip install -r requirements.txt

# 下载 Camoufox 浏览器二进制（首次使用必须执行）
python3 -m camoufox fetch
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
# 编辑 .env.local，填入你的 LLM API 密钥
```

必填项：
- `ANTHROPIC_API_KEY` — LLM API 密钥（用于笔记生成和聊天）

可选项：
- `ANTHROPIC_BASE_URL` — LLM API 基地址，默认 `https://api.minimaxi.com/anthropic`
- `LLM_MODEL` — 默认 `claude-3-5-sonnet-20241022`
- `RSS_CHECK_INTERVAL_MINUTES` — 默认 `60`
- `RELINK_CRON_EXPRESSION` — 默认 `0 3 * * *`（每天凌晨 3 点）
- `TINYFISH_API_KEY` — TinyFish 搜索 API 密钥（用于 chat agent 的 `web_search` 工具和 `web_fetch` 主抓取）
- `SEARCH_API_KEY` — Serper（Google）搜索 API 密钥（`web_search` 兜底）

> 以上所有配置均可通过**设置**面板在运行时修改。环境变量仅作为默认值；通过 UI 保存的设置会覆盖环境变量。

### 3. 启动开发服务器

```bash
npm run dev
```

打开 http://localhost:3000

### 4. 运行测试

```bash
# 单元测试（Vitest）
npm run test

# 单元测试 + 覆盖率报告
npm run test:coverage

# E2E 测试（Playwright）
npm run test:e2e

# 全部测试
npm run test:all
```

## 项目结构

```
my-kb/
├── app/                    # Next.js App Router
│   ├── api/                # API 路由
│   ├── layout.tsx          # 根布局（启动 RSS 定时任务 + 关联刷新定时任务）
│   └── page.tsx            # 主页面（服务端组件，标签页切换器）
├── components/             # React UI
│   ├── Sidebar.tsx             # 左侧导航栏
│   ├── ChatPanel.tsx           # 聊天布局壳
│   ├── ChatSession.tsx         # 单会话聊天组件
│   ├── InboxPanel.tsx          # 收件箱审核
│   ├── IngestPanel.tsx         # 知识入库面板（文本/链接/文件/RSS）
│   ├── LogsPanel.tsx           # 日志查看面板（实时推送 + 过滤）
│   ├── MemoryPanel.tsx         # 用户记忆面板
│   ├── NotesPanel.tsx          # 笔记浏览与搜索（服务端组件）
│   ├── NotesPanelClient.tsx    # 笔记详情与交互（客户端组件 + SSE）
│   ├── RSSPanel.tsx            # RSS 订阅管理
│   ├── SettingsPanel.tsx       # 运行时设置面板
│   ├── TasksPanel.tsx          # 任务队列状态面板
│   ├── TabShell.tsx            # 标签页容器（CSS 隐藏以保留状态）
│   ├── ThemeProvider.tsx       # 主题上下文
│   └── __tests__/              # 组件测试
├── hooks/                  # 自定义 React Hooks
│   ├── useConversationManager.ts  # 会话 CRUD + 持久化 + keep-alive 状态
│   ├── useKeyboardShortcuts.ts    # 快捷键处理（Ctrl+Enter）
│   ├── useMemoryFlush.ts          # 延迟记忆更新 API 调用
│   ├── useSSE.ts                  # 通用 SSE Hook（类型化事件 + 自动重连）
│   └── __tests__/                 # Hook 测试
├── lib/                    # 核心业务逻辑
│   ├── types.ts            # 类型定义
│   ├── storage.ts          # 文件系统存储（原子写入、CRUD、索引管理）
│   ├── parsers.ts          # Markdown 解析/序列化 + 收件箱解析
│   ├── queue.ts            # 任务队列（按类型隔离的 Worker + JSON 持久化）
│   ├── memory.ts           # 用户记忆建模（画像、笔记熟悉度、偏好）
│   ├── settings.ts         # 运行时配置（YAML 持久化、环境变量回退）
│   ├── llm.ts              # 集中式异步 LLM 客户端工厂
│   ├── utils.ts            # 共享工具函数（formatDate、serializeMessages）
│   ├── events.ts           # 类型化 SSE 事件总线（emitNoteEvent / emitTaskEvent / emitInboxEvent）
│   ├── logger.ts           # 结构化日志（pino + 内存缓冲 + 文件轮转 + SSE 广播）
│   ├── cognition/          # LLM 调用（入库加工 + 关联刷新）
│   ├── ingestion/          # 内容抓取（网页/RSS/PDF）
│   ├── search/             # 倒排索引、评分引擎、评估框架、缓存
│   ├── rss/                # RSS 订阅管理 + 定时任务
│   └── relink/             # 后台关联刷新定时任务
├── e2e/                    # Playwright E2E 测试
├── knowledge/              # 数据存储（.gitignore，仅本地）
│   ├── notes/              # 结构化笔记
│   ├── inbox/              # 待审核条目
│   ├── archive/
│   │   └── inbox/          # 已拒绝或已处理的收件箱文件
│   ├── conversations/      # 聊天记录 (*.md)
│   ├── meta/               # 元数据（搜索索引、队列、RSS 订阅、设置、用户记忆）
│   └── attachments/        # 上传的原始文件
├── knowledge-test/         # E2E 测试数据隔离（.gitignore，仅本地）
├── docs/                   # 文档
│   ├── API.md              # REST API 参考
│   └── ARCHITECTURE.md     # 系统设计与数据流
├── CHANGELOG.md
├── AGENTS.md               # AI 助手编码规范
└── LICENSE
```

## 数据存储

所有数据均以 Markdown / YAML / JSON 文件形式存储在 `knowledge/` 目录中，无需数据库：

- **笔记**：`knowledge/notes/{id}.md` — YAML Frontmatter + Markdown 正文
- **收件箱**：`knowledge/inbox/{timestamp}-{slug}.md`
- **元数据**：`knowledge/meta/` — 倒排索引、RSS 订阅列表、任务队列状态、运行时设置、用户记忆

`knowledge/`、`knowledge-test/` 和 `.env*.local` 均已被 `.gitignore` 排除，确保个人数据不会进入版本控制。

### 测试数据隔离

E2E 测试使用独立的 `knowledge-test/` 目录（通过 `playwright.config.ts` 中的 `KNOWLEDGE_ROOT=knowledge-test` 设置）。这可以防止测试操作污染真实的 `knowledge/` 数据。`e2e/fixtures.ts` 中的 `resetTestData()` 辅助函数会在每个测试前清空 `knowledge-test/`。

## 关键设计决策

| 决策 | 理由 |
|------|------|
| **文件系统存储** | 笔记即文档；Markdown 是原生格式。Git 天然提供版本管理。 |
| **Camoufox 兜底** | 现代网站多为客户端渲染；TinyFish 处理大多数情况，Camoufox 处理 TinyFish 失败或 JS 渲染复杂的页面。 |
| **TinyFish 主抓取 + Serper 兜底搜索** | `web_search` 工具使用 TinyFish 作为主提供者，失败时降级到 Serper（Google）；`web_fetch` 使用 TinyFish 主抓取，失败时降级到 Camoufox。 |
| **内存队列 + JSON 持久化** | 负载较小（单用户，每天几十个任务）。避免 Redis 运维开销。按类型隔离的 Worker 防止入库任务阻塞 RSS 或关联刷新任务。 |
| **RSS 增量更新** | 以 `lastPubDate` 作为水位线，避免重复抓取。首次检查仅获取最近 5 条。 |
| **收件箱审核环节** | LLM 调用需要成本，且可能产生噪声。人工审批可防止污染知识库。 |
| **倒排索引 + ripgrep 回退** | jieba 词典分词支持中文；索引 7 个元数据字段（正文排除以节省空间）。结构化结果低于阈值时触发 `rg` 全文扫描。索引以 `search-index.json` 持久化，笔记保存/删除时增量更新。 |
| **用户记忆** | 对话不是无状态的。自动提取的用户画像、笔记熟悉度和偏好会被注入聊天提示词，实现个性化回答。状态演进让知识库无需人工策展即可自然维护。 |

## 文档

- [`AGENTS.md`](./AGENTS.md) — AI 助手编码规范
- [`docs/API.md`](./docs/API.md) — REST API 参考
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 系统架构与数据流
- [`CHANGELOG.md`](./CHANGELOG.md) — 变更历史

## 许可证

[MIT](./LICENSE)
