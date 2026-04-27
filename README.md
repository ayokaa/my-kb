# my-kb — AI-Powered Personal Knowledge Base

> Collect information through chat, web links, RSS feeds, and file uploads. An LLM automatically processes raw content into structured knowledge notes, persisted as Markdown files on your local filesystem.

## Core Workflow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Ingest  │ ──→ │  Inbox   │ ──→ │  Queue   │ ──→ │  Notes   │
│(Web/RSS/ │     │ (human   │     │ (LLM     │     │(structured│
│PDF/Text) │     │  review) │     │  worker) │     │ Markdown)│
└──────────┘     └──────────┘     └──────────┘     └──────────┘
       │                                                    │
       └────────────────── Chat ←───────────────────────────┘
```

- **Ingest**: Web links, RSS feeds, PDF/TXT/MD files, plain text
- **Inbox Review**: Pending content is confirmed by the user (or auto-approved) before processing
- **LLM Processing**: Calls the MiniMax API to extract tags, summaries, key facts, timelines, links, and other structured information
- **Knowledge Notes**: Stored as Markdown + YAML Frontmatter on the local filesystem
- **Chat**: Streamed AI conversation with RAG retrieval — searches the knowledge base and injects relevant context into the system prompt

## Tech Stack

![Next.js](https://img.shields.io/badge/Next.js-16.2-000?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss)
![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright)
![Vitest](https://img.shields.io/badge/Vitest-Unit-6E9F18?logo=vitest)

- **Framework**: Next.js 16 App Router + React 19
- **Language**: TypeScript 5 (strict mode)
- **Styling**: Tailwind CSS + custom CSS variables (dark theme)
- **AI Streaming**: `ai` SDK + OpenAI-compatible MiniMax API
- **Web Scraping**: Playwright (Chromium headless) + Readability
- **RSS**: `feedsmith` + incremental updates (`lastPubDate` watermark), queued async fetch
- **Search**: Keyword-based RAG with Zone-weighted scoring for chat context augmentation
- **Storage**: Pure filesystem (`knowledge/` directory), atomic writes
- **Testing**: Vitest (260 unit tests) + Playwright (50 E2E tests)
- **Real-time**: SSE event bus for server-to-client push (note changes, chat data events)

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/ayokaa/my-kb.git
cd my-kb
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env.local
# Edit .env.local and fill in your MiniMax API key
```

Required:
- `MINIMAX_API_KEY` — MiniMax API key (used for note generation and chat)

Optional:
- `MINIMAX_BASE_URL` — defaults to `https://api.minimaxi.com/v1`

### 3. Start Development Server

```bash
npm run dev
```

Open http://localhost:3000

### 4. Run Tests

```bash
# Unit tests (Vitest)
npm run test

# Unit tests + coverage report
npm run test:coverage

# E2E tests (Playwright)
npm run test:e2e

# All tests
npm run test:all
```

## Project Structure

```
my-kb/
├── app/                    # Next.js App Router
│   ├── api/                # API routes
│   ├── layout.tsx          # Root layout (bootstraps RSS cron)
│   └── page.tsx            # Main page (tab switcher)
├── components/             # React UI (Client Components)
│   ├── Sidebar.tsx
│   ├── ChatPanel.tsx
│   ├── InboxPanel.tsx
│   ├── NotesPanel.tsx
│   ├── NotesPanelClient.tsx
│   ├── RSSPanel.tsx
│   └── TasksPanel.tsx
├── lib/                    # Core business logic
│   ├── types.ts            # Type definitions
│   ├── storage.ts          # Filesystem storage
│   ├── parsers.ts          # Markdown parse/serialize
│   ├── queue.ts            # Task queue (memory + JSON persistence)
│   ├── cognition/          # LLM calls
│   ├── ingestion/          # Content scraping (Web/RSS/PDF)
│   └── rss/                # RSS subscription management
├── e2e/                    # Playwright E2E tests
├── knowledge/              # Data storage (.gitignore, local only)
│   ├── notes/              # Structured notes
│   ├── inbox/              # Pending review entries
│   ├── conversations/      # Chat history (*.md)
│   ├── meta/               # Metadata (index, queue, RSS subscriptions)
│   └── attachments/        # Uploaded original files
├── knowledge-test/         # E2E test data isolation (.gitignore, local only)
├── docs/                   # Documentation
│   ├── API.md              # REST API reference
│   └── ARCHITECTURE.md     # System design & data flow
├── CHANGELOG.md
├── AGENTS.md               # AI assistant conventions
└── LICENSE
```

## Data Storage

All data is stored as Markdown / YAML files in the `knowledge/` directory. No database is required:

- **Notes**: `knowledge/notes/{id}.md` — YAML Frontmatter + Markdown body
- **Inbox**: `knowledge/inbox/{timestamp}-{slug}.md`
- **Metadata**: `knowledge/meta/` — inverted index, RSS subscription list, task queue state

Both `knowledge/` and `knowledge-test/` and `.env*.local` are excluded by `.gitignore` to ensure personal data never enters version control.

### Test Data Isolation

E2E tests run against a separate `knowledge-test/` directory (set via `KNOWLEDGE_ROOT=knowledge-test` in `playwright.config.ts`). This prevents test operations from polluting your real `knowledge/` data. The `resetTestData()` helper in `e2e/fixtures.ts` clears `knowledge-test/` before each test.

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Filesystem storage** | Notes are documents; Markdown is the native format. Git provides versioning for free. |
| **Playwright scraping** | Modern sites are client-side rendered. Pure `fetch` only retrieves an empty HTML shell. Playwright executes JS before extracting content. |
| **Memory queue + JSON persistence** | Workload is small (single user, a few dozen tasks per day). Avoids Redis operational overhead. |
| **RSS incremental updates** | Uses `lastPubDate` as a watermark to avoid re-fetching duplicates. First check is limited to 5 items. |
| **Inbox review step** | LLM calls cost money and can produce noise. Human approval prevents polluting the knowledge base. |

## Documentation

- [`AGENTS.md`](./AGENTS.md) — AI assistant coding conventions
- [`docs/API.md`](./docs/API.md) — REST API reference
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — System architecture & data flow
- [`CHANGELOG.md`](./CHANGELOG.md) — Change history

## License

[MIT](./LICENSE)
