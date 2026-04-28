# AGENTS.md — My Knowledge Base (my-kb)

> 本文件面向 AI 编程助手。阅读者应对本项目一无所知，所有信息均基于实际代码，不做假设。

---

## 项目概述

**my-kb** 是一个基于 Next.js 的个人 AI 知识库应用。用户可以通过聊天、网页链接、RSS 订阅、文件上传等方式收集信息，系统利用大语言模型（LLM）将原始内容自动加工成结构化的知识笔记，并以 Markdown 文件形式持久化存储在本地文件系统中。

核心功能：
- **AI 对话（RAG + Tool Calling）**：基于已有知识的流式聊天助手，通过倒排索引检索相关知识并注入上下文；当知识不足时 LLM 可调用 `web_fetch` 工具实时抓取网页补充回答
- **知识入库（Ingest）**：支持文本、链接、PDF/TXT/MD 文件、RSS 订阅的自动抓取与入库
- **收件箱审核（Inbox）**：待处理内容经过人工确认后，由 LLM 生成结构化笔记
- **笔记管理（Notes）**：按状态（种子/生长中/常青/陈旧/归档）管理笔记，支持标签搜索；显示双向反向链接（反向链接）
- **RSS 订阅**：定时自动检查订阅源，将新文章写入收件箱（通过任务队列异步执行）
- **任务队列**：后台异步处理 inbox 到 note 的转换、RSS fetch、web fetch 和 relink。支持失败任务手动重试

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16.2.4 (App Router) + React 19 |
| 语言 | TypeScript 5 (strict mode, target: es2015) |
| 样式 | Tailwind CSS 3.4 + 自定义 CSS 变量（深色主题） |
| 字体 | Cormorant Garamond (衬线标题) + JetBrains Mono (等宽正文) |
| AI 流 | `ai` v3 的 legacy `OpenAIStream` / `StreamingTextResponse`（`@ai-sdk/openai` 已安装但暂未使用） |
| LLM | MiniMax API（默认模型 `MiniMax-M2.7`） |
| 测试 | Vitest 4（单元测试，jsdom 环境）+ Playwright（E2E，Chromium） |
| 抓取 | `camoufox`（Python，Firefox 反指纹浏览器）+ `@mozilla/readability` + `jsdom` |
| RSS | `feedsmith` |
| PDF | `pdf-parse` |
| 配置 | YAML 通过 `js-yaml` 读写 |
| 定时 | `node-cron` |

---

## 目录结构

```
my-kb/
├── app/                          # Next.js App Router
│   ├── api/                      # API 路由（每个目录对应一个端点）
│   │   ├── chat/                 # POST /api/chat — 流式 AI 对话（支持工具调用）
│   │   ├── conversations/        # GET/POST /api/conversations — 多会话管理
│   │   ├── inbox/                # GET /api/inbox, POST /api/inbox/archive, POST /api/inbox/process
│   │   ├── ingest/               # POST /api/ingest — 文本/链接手动入库
│   │   ├── notes/                # GET /api/notes — 列出所有笔记
│   │   │   └── [id]/             # GET /api/notes/{id} — 获取单个笔记
│   │   ├── rss/                  # RSS 相关接口
│   │   │   ├── subscriptions/    # GET/POST/DELETE 订阅源管理
│   │   │   ├── subscriptions/check/   # POST 手动检查更新
│   │   │   └── subscriptions/import-opml/  # POST 导入 OPML
│   │   ├── search/               # POST /api/search — 网络搜索（后端存在，暂无前端调用）
│   │   ├── settings/             # GET/POST /api/settings — 运行时配置
│   │   ├── tasks/                # GET/POST /api/tasks — 任务队列查询与重试
│   │   ├── logs/                 # GET /api/logs — 日志查询；stream/ — SSE 实时推送
│   │   └── upload/               # POST /api/upload — 文件上传
│   ├── globals.css               # 全局样式、CSS 变量、自定义组件类
│   ├── layout.tsx                # 根布局（启动 RSS cron + relink cron）
│   └── page.tsx                  # 主页面（标签页切换器）
├── components/                   # React 组件
│   ├── Sidebar.tsx               # 左侧导航栏
│   ├── ChatPanel.tsx             # 聊天面板（多会话 + Markdown 渲染）
│   ├── InboxPanel.tsx            # 收件箱审核
│   ├── IngestPanel.tsx           # 知识入库面板（文本/链接/文件/RSS）
│   ├── NotesPanel.tsx            # 笔记浏览与搜索（Server Component）
│   ├── NotesPanelClient.tsx      # 笔记详情与交互（Client Component）
│   ├── RSSPanel.tsx              # RSS 订阅管理
│   ├── SettingsPanel.tsx         # 运行时设置面板
│   ├── TasksPanel.tsx            # 任务队列状态面板
│   ├── LogsPanel.tsx             # 日志查看面板（实时推送 + 过滤）
│   └── TabShell.tsx              # 标签页容器（CSS hidden 保活状态）
├── lib/                          # 核心业务逻辑
│   ├── types.ts                  # TypeScript 类型定义
│   ├── storage.ts                # FileSystemStorage 实现
│   ├── parsers.ts                # Note 的 Markdown 解析与序列化
│   ├── queue.ts                  # 任务队列与 Worker（内存运行 + JSON 持久化）
│   ├── settings.ts               # 运行时配置（YAML 持久化）
│   ├── llm.ts                    # 集中式 LLM 客户端工厂
│   ├── events.ts                 # SSE 事件总线（服务端推送）
│   ├── logger.ts                 # 结构化日志（内存缓冲 + 文件持久化 + SSE 广播）
│   ├── cognition/
│   │   ├── ingest.ts             # LLM 调用：将 inbox 加工成 note
│   │   └── relink.ts             # LLM 调用：刷新笔记间关联
│   ├── ingestion/
│   │   ├── web.ts                # 网页内容抓取（Camoufox + Readability）
│   │   ├── rss.ts                # RSS/Atom/JSON Feed 解析
│   │   └── pdf.ts                # PDF 文本提取
│   ├── search/
│   │   ├── inverted-index.ts     # 倒排索引（分词、构建、增量更新）
│   │   ├── engine.ts             # 搜索评分、关联扩散、上下文组装
│   │   ├── cache.ts              # 搜索索引内存缓存（5s TTL + 并发去重）
│   │   └── eval.ts               # 检索质量量化评估框架
│   ├── rss/
│   │   ├── manager.ts            # RSS 订阅的增删查改与自动入库
│   │   └── cron.ts               # node-cron 定时任务封装（可 stop/restart）
│   └── relink/
│       └── cron.ts               # 关联刷新定时任务（可 stop/restart）
├── docs/                         # 文档（API 参考、架构设计）
│   ├── API.md                    # REST API 参考
│   └── ARCHITECTURE.md           # 系统架构与数据流
├── e2e/                          # Playwright E2E 测试
├── knowledge/                    # 文件系统数据存储（被 .gitignore 忽略）
│   ├── notes/                    # 结构化笔记（Markdown）
│   ├── inbox/                    # 待审核条目
│   ├── archive/                  # 归档数据
│   │   └── inbox/                # 已忽略的 inbox 条目
│   ├── conversations/            # 对话记录
│   ├── meta/                     # 元数据
│   │   ├── search-index.json     # 倒排索引（JSON）
│   │   ├── aliases.yml           # 别名映射
│   │   ├── rss-sources.yml       # RSS 订阅列表（含 lastPubDate 增量标记）
│   │   ├── queue.json            # 任务队列持久化状态
│   │   ├── settings.yml          # 运行时设置
│   │   └── logs/                 # 日志文件（按天轮转，JSON Lines）
│   ├── attachments/              # 上传的原始文件
│   └── daily/                    # （预留目录）
├── knowledge-test/               # E2E 测试数据隔离目录（被 .gitignore 忽略）
├── package.json
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── CHANGELOG.md
├── LICENSE
├── .env.example
└── postcss.config.mjs
```

---

## 构建与运行命令

```bash
# 安装 Node.js 依赖
npm install

# 安装 camoufox（网页抓取引擎，首次使用必须执行）
./scripts/setup_camoufox.sh

# 开发服务器（默认 http://localhost:3000）
npm run dev

# 生产构建
npm run build

# 启动生产服务器
npm run start

# 代码检查
npm run lint

# 单元测试（Vitest，监视模式）
npm run test

# 单元测试（一次性运行，带覆盖率报告）
npm run test:coverage

# E2E 测试（Playwright，自动启动 dev 服务器）
npm run test:e2e
```

---

## 环境变量

| 变量名 | 说明 | 是否必须 |
|--------|------|----------|
| `MINIMAX_API_KEY` | MiniMax API 密钥 | 是（聊天、笔记生成） |
| `MINIMAX_BASE_URL` | MiniMax API 基地址，默认 `https://api.minimaxi.com/v1` | 否 |
| `KNOWLEDGE_ROOT` | 数据存储根目录，默认 `knowledge` | 否 |


环境变量通过 `.env` 或 `.env*.local` 文件配置。这些文件以及 `knowledge/` 和 `knowledge-test/` 目录已被 `.gitignore` 排除，不会进入版本控制。

---

## 代码组织规范

### 模块划分

- **`lib/types.ts`**：所有核心业务类型（`Note`, `InboxEntry`, `Conversation`, `Storage` 接口等）。
- **`lib/storage.ts`**：`FileSystemStorage` 类，实现 `Storage` 接口，所有数据持久化均通过此类完成。
- **`lib/parsers.ts`**：`parseNote` / `stringifyNote`，定义了 Note 的 Markdown 格式规范。
- **`lib/queue.ts`**：任务队列与后台 Worker。支持 `ingest`（inbox → note）、`rss_fetch`（RSS 抓取 → inbox）、`web_fetch`（网页抓取 → inbox）和 `relink`（关联刷新）四种任务类型，各类型由独立 worker 并行处理。队列状态在 `knowledge/meta/queue.json` 中持久化（原子写入：tmp+rename）。持久化策略：保留全部 `pending`/`running` 任务；`done`/`failed` 只保留最近 100 条。进程重启后，`running` 任务自动重置为 `pending` 并重跑 Worker。失败任务可通过 `retryTask(id)` 重置并重新执行。
- **`lib/cognition/ingest.ts`**：唯一调用 LLM 进行内容加工的地方。
- **`lib/ingestion/`**：各类原始内容的抓取/解析器，不依赖 LLM。
- **`lib/rss/`**：RSS 订阅管理与定时轮询。
- **`app/api/`**：HTTP API 层，负责接收请求、调用 lib、返回 JSON。
- **`components/`**：React UI 组件，全部为 Client Component（`'use client'`），通过 `fetch` 调用 API。

### 路径别名

TypeScript 与 Vitest 均配置 `@/` 指向项目根目录。所有内部导入应使用 `@/lib/...`、`@/components/...` 等形式。

### API 路由风格

- 使用标准 Web API：`export async function POST(req: Request)`，返回 `Response.json(...)`。
- 不使用 `NextResponse`，保持与 Edge/Node 运行时的最大兼容性。
- 错误处理统一返回 `{ error: err.message }` 与适当的 HTTP status code。

---

## 数据模型与存储格式

### Note（笔记）

存储于 `knowledge/notes/{id}.md`，格式如下：

```markdown
---
id: "note-id"
title: "笔记标题"
tags:
  - "标签1"
  - "标签2"
status: "seed"   # seed | growing | evergreen | stale | archived
created: "2024-01-01T00:00:00.000Z"
updated: "2024-01-01T00:00:00.000Z"
sources:
  - "web"
  - "https://example.com"
---

# 笔记标题

## 一句话摘要
摘要内容

## 与我相关
个人价值分析

## 关键事实
- 事实 1
- 事实 2

## 时间线
- 2024-01 | 事件描述

## 关联
- [[另一篇笔记]] #strong — 关联原因

## 反向链接
- [[引用此笔记的标题]] #strong — 关联上下文

## 常见问题
**Q**: 问题？
**A**: 答案
*来源: [[某笔记]]*

## 详细内容
Markdown 正文
```

### Inbox（收件箱）

存储于 `knowledge/inbox/{timestamp}-{slug}.md`，YAML frontmatter 包含 `source_type`、`source_path`、`title`、`extracted_at` 以及原始元数据。

### RSS 元数据

- `knowledge/meta/rss-sources.yml`：订阅源列表。每个订阅项包含 `url`、`name`、`addedAt` 和 **`lastPubDate`**（上次处理的最晚发布日期）。RSS 增量更新以此为水位线：首次检查只取最近 5 条，后续仅抓取 `pubDate > lastPubDate` 的新条目。`rss-seen.yml` 已废弃并停止写入。

### 任务队列持久化

- `knowledge/meta/queue.json`：任务队列的运行时状态。包含 `tasks` 数组（完整任务历史，类型为 `ingest` 或 `rss_fetch`）和 `pendingIds` 数组。模块加载时自动恢复，enqueue / task start / task complete 时触发原子写入（tmp+rename）。
- 失败的任务保留在 `tasks` 中，`status: 'failed'`，可通过 `retryTask(id)` 重置为 `pending` 并重新入队。

### 检索系统（RAG）

- `knowledge/meta/search-index.json`：倒排索引，持久化存储。
- `lib/search/inverted-index.ts`：分词（中文整词+2/3字组合，英文空格分词，停用词过滤）、索引构建、增量更新（`addNoteToIndex`、`removeNoteFromIndex`）。索引版本 `INDEX_VERSION = 2`。
- `lib/search/engine.ts`：Zone 加权评分（tag 3.0 > qa 2.5 > title 2.0 > summary 1.8 > keyFact/link/backlink 1.5 > content 0.8）、关联扩散（1-hop，30% 衰减）、上下文组装（动态字符预算 15000）。
- `lib/search/cache.ts`：搜索索引内存缓存，5 秒 TTL + 并发请求去重（`loadOrBuildIndex`），供 `chat/route.ts` 复用。
- `app/api/chat/route.ts`：聊天时自动检索相关知识，将结果注入 system prompt；支持 `web_fetch` 工具调用，LLM 可在知识不足时实时抓取网页补充回答。

---

## 测试策略

### 单元测试（Vitest）

- 测试文件与源码紧邻存放，命名规则：
  - `lib/__tests__/storage.test.ts`
  - `lib/cognition/__tests__/ingest.test.ts`
  - `app/api/chat/__tests__/route.test.ts`
  - `lib/search/__tests__/cache.test.ts`
  - `app/api/tasks/__tests__/route.test.ts`
  - `components/__tests__/TasksPanel.test.ts`
- 环境：`jsdom`（用于 React/前端逻辑），`globals: true`
- 覆盖率提供者：`v8`
- 阈值要求：
  - lines ≥ 80%
  - functions ≥ 80%
  - branches ≥ 70%
  - statements ≥ 80%
- 排除目录：`node_modules/`, `.next/`, `e2e/`, `**/*.config.*`, `app/layout.tsx`, `app/page.tsx`

### E2E 测试（Playwright）

- 测试目录：`e2e/`
- 浏览器：仅 Chromium
- 自动启动开发服务器：`npm run dev`（注入 `KNOWLEDGE_ROOT=knowledge-test`）
- `workers: 1`，所有 spec 文件使用 `test.describe.serial`，防止并发测试数据污染
- `e2e/fixtures.ts` 拦截 Google Fonts 请求（防止 headless Chromium 超时）
- 每个测试的 `beforeEach` 调用 `resetTestData()` 清空 `knowledge-test/`
- 配置在 CI 模式下使用 2 次重试；本地开发复用已有服务器

### 运行全部测试

```bash
# 单元测试 + 覆盖率
npm run test:coverage

# E2E
npm run test:e2e
```

---

## 安全与隐私注意事项

1. **敏感数据不入库**：`knowledge/` 与 `.env*` 已被 `.gitignore` 排除，确保个人笔记和 API 密钥不会被意外提交。
2. **文件上传**：上传文件保存在 `knowledge/attachments/`，以时间戳前缀重命名，避免文件名冲突与路径遍历。
3. **Shell 注入**：`storage.ts` 中的 `commit()` 方法通过 `git add` 和 `git commit` 执行外部命令，已对消息中的双引号做了转义。注意：由于 `knowledge/` 在 `.gitignore` 中，`git add` 不会实际添加任何文件，此方法当前处于失效状态。如需启用 Git 版本管理，需将 `knowledge/` 移出 `.gitignore`。
4. **API 密钥**：LLM 和搜索 API 密钥仅通过环境变量注入，不在客户端暴露。
5. **网页抓取**：通过 Python `camoufox` 启动 Firefox 反指纹浏览器，执行页面 JavaScript 后获取 HTML，再由 Node.js 端通过 JSDOM + Readability 提取正文，超时 20 秒（`domcontentloaded` → `load` fallback）。不再使用静态 `fetch` 方式。
6. **RSS 抓取**：使用 `fetch` + 自定义 User-Agent (`AgentKB/1.0`)，源之间加入 500ms 延迟以示礼貌。

---

## 开发约定

- **UI 语言**：中文。所有面向用户的文案、提示、标签均使用中文。
- **主题**：固定深色主题，通过 CSS 变量在 `globals.css` 中定义，不使用 Tailwind 默认颜色。
- **组件风格**：大量自定义 CSS 类（`.glass`、`.card-elevated`、`.btn-primary`、`.input-dark` 等），参考 `globals.css` 的 `@layer components`。
- **状态管理**：无全局状态库，React 组件内部使用 `useState` + `useEffect` + `fetch` 进行数据获取。
- **Cron 启动**：RSS 定时任务在 `app/layout.tsx` 中通过动态 `import('@/lib/rss/cron')` 启动，仅在 Node.js 运行时且非测试环境下执行。
- **Git 集成（当前失效）**：`FileSystemStorage.commit(message)` 设计意图是将 `knowledge/` 变更自动提交到 Git，但因 `knowledge/` 被 `.gitignore` 排除，实际不会产生任何提交。如需启用，需将 `knowledge/` 从 `.gitignore` 中移除。
- **CHANGELOG 更新**：任何对代码行为的实质性修改（新功能、bug 修复、行为变更、API 调整）必须在 `CHANGELOG.md` 中记录。新增条目放在最上方的日期节下；如果当天已有条目，则追加到该节内，不重复创建同日期标题。每次提交前检查 CHANGELOG 是否同步。

---

## 常见修改场景指引

| 场景 | 应修改的文件 |
|------|-------------|
| 新增 API 端点 | `app/api/{feature}/route.ts` |
| 修改笔记数据结构 | `lib/types.ts` → `lib/parsers.ts` → `lib/storage.ts` |
| 调整 LLM 提示词 | `lib/cognition/ingest.ts` 中的 `SYSTEM_PROMPT` |
| 更换 LLM 提供商 | `lib/cognition/ingest.ts` 和 `app/api/chat/route.ts` 中的 OpenAI 客户端配置 |
| 新增入库来源类型 | `lib/ingestion/` 下新增解析器，并在 `app/api/ingest/route.ts` 或 `app/api/upload/route.ts` 中接入 |
| 调整 RSS 轮询频率 | `app/layout.tsx` 中 `startRSSCron(60)` 的参数（分钟） |
| 修改检索/搜索逻辑 | `lib/search/engine.ts` 或 `lib/search/index.ts` |
| 修改聊天 RAG 行为 | `app/api/chat/route.ts` 中的上下文组装逻辑 |
| 修改 UI 主题色 | `app/globals.css` 中的 `:root` CSS 变量 |
| 新增组件 | `components/{Name}.tsx`，并在 `app/page.tsx` 中引用 |
| 调整任务队列逻辑 | `lib/queue.ts` |
| 修改任务面板 UI | `components/TasksPanel.tsx` |
| 新增/修改日志输出 | `lib/logger.ts` |
| 调整日志查看面板 | `components/LogsPanel.tsx` |

---

## 依赖版本锁定

本项目使用 `package-lock.json` 锁定依赖版本。新增依赖后需确保：
1. 在 `package.json` 中明确版本范围；
2. 运行 `npm install` 更新 `package-lock.json`；
3. 若新增依赖涉及文件系统、网络或环境相关行为，补充对应单元测试。
