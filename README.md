# my-kb — AI 驱动的个人知识库

> 通过聊天、网页链接、RSS 订阅、文件上传等方式收集信息，由 LLM 自动加工成结构化的知识笔记，并以 Markdown 文件持久化存储。

## 核心工作流

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  信息摄入  │ ──→ │  收件箱   │ ──→ │  LLM加工  │ ──→ │  知识笔记  │
│ (Web/RSS/ │     │ (人工审核)│     │(自动/手动)│     │(Markdown)│
│  PDF/Text)│     └──────────┘     └──────────┘     └──────────┘
└──────────┘                                            │
     ↑──────────────────────────────────────────────────┘
     └────────────────  对话检索与问答  ──────────────────→
```

- **信息摄入**：支持网页链接、RSS 订阅、PDF/TXT/MD 文件、纯文本
- **收件箱审核**：待处理内容经过人工确认（或自动）后进入加工流程
- **LLM 加工**：调用 MiniMax API 提取标签、摘要、关键事实、时间线、关联等结构化信息
- **知识笔记**：以 Markdown + YAML Frontmatter 格式存储于本地文件系统
- **对话检索**：基于已有笔记进行流式 AI 对话

## 技术栈

![Next.js](https://img.shields.io/badge/Next.js-16.2-000?logo=next.js)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss)
![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright)
![Vitest](https://img.shields.io/badge/Vitest-Unit-6E9F18?logo=vitest)

- **框架**：Next.js 16 App Router + React 19
- **语言**：TypeScript 5 (strict mode)
- **样式**：Tailwind CSS + 自定义 CSS 变量（深色主题）
- **AI 流**：`ai` SDK + OpenAI-compatible MiniMax API
- **网页抓取**：Playwright（Chromium 无头浏览器）+ Readability
- **RSS**：`feedsmith` + 增量更新（`lastPubDate` 水位线）
- **存储**：纯文件系统（`knowledge/` 目录），原子写入
- **测试**：Vitest（86 单元测试）+ Playwright（6 E2E 测试）

## 快速开始

### 1. 克隆与安装

```bash
git clone <repo-url>
cd my-kb
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
# 编辑 .env.local，填入你的 MiniMax API 密钥
```

必需变量：
- `MINIMAX_API_KEY` — MiniMax API 密钥（用于笔记生成和聊天）

可选变量：
- `MINIMAX_BASE_URL` — 默认 `https://api.minimaxi.com/v1`

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
│   ├── layout.tsx          # 根布局（启动 RSS cron）
│   └── page.tsx            # 主页面（标签页切换）
├── components/             # React 组件（Client Components）
│   ├── Sidebar.tsx
│   ├── ChatPanel.tsx
│   ├── InboxPanel.tsx
│   ├── NotesPanel.tsx
│   ├── RSSPanel.tsx
│   └── TasksPanel.tsx
├── lib/                    # 核心业务逻辑
│   ├── types.ts            # 类型定义
│   ├── storage.ts          # 文件系统存储
│   ├── parsers.ts          # Markdown 解析/序列化
│   ├── queue.ts            # 任务队列（内存 + JSON 持久化）
│   ├── cognition/          # LLM 调用
│   ├── ingestion/          # 内容抓取（Web/RSS/PDF）
│   └── rss/                # RSS 订阅管理
├── e2e/                    # Playwright E2E 测试
├── knowledge/              # 数据存储（.gitignore，本地 only）
│   ├── notes/              # 结构化笔记
│   ├── inbox/              # 待审核条目
│   ├── meta/               # 元数据（索引、队列、RSS订阅）
│   └── attachments/        # 上传的原始文件
└── AGENTS.md               # AI 协作规范（面向编程助手）
```

## 数据存储

所有数据以 Markdown / YAML 文件形式存储在 `knowledge/` 目录中，不依赖数据库：

- **笔记**：`knowledge/notes/{id}.md` — YAML Frontmatter + Markdown 正文
- **收件箱**：`knowledge/inbox/{timestamp}-{slug}.md`
- **元数据**：`knowledge/meta/` — 倒排索引、RSS 订阅列表、任务队列状态

`knowledge/` 和 `.env*.local` 已被 `.gitignore` 排除，确保个人数据不会进入版本控制。

## 关键设计决策

| 决策 | 说明 |
|------|------|
| **文件系统存储** | 笔记即文件，可用任意 Markdown 编辑器打开，天然支持 Git 版本管理 |
| **Playwright 抓取** | 现代网站多为客户端渲染，纯 `fetch` 只能拿到空壳 HTML。Playwright 执行 JS 后提取正文 |
| **内存队列 + JSON 持久化** | 任务量不大，无需引入 Redis。进程重启时自动恢复 pending 任务 |
| **RSS 增量更新** | 以 `lastPubDate` 为水位线，避免重复抓取，首次只取最近 5 条 |
| **收件箱审核** | LLM 加工前可人工确认，避免垃圾信息入库；也支持 API 直接入库 |

## License

MIT
