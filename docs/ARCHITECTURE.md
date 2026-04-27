# Architecture

> System design and data flow for my-kb.

## Overview

my-kb is a personal knowledge base that turns raw information (web pages, RSS feeds, files, text) into structured Markdown notes using an LLM. All data lives on the local filesystem; there is no database.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Ingest    │────→│   Inbox     │────→│   Queue     │────→│    Notes    │
│ (Web/RSS/   │     │ (pending    │     │ (LLM worker │     │ (structured │
│  PDF/Text)  │     │  review)    │     │  pipeline)  │     │  Markdown)  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                                                    │
       └──────────────────── Chat ←─────────────────────────┘
```

## Data Flow

### 1. Ingest → Inbox

Raw content enters the system through four paths:

| Source | Entry Point | Handler |
|--------|-------------|---------|
| Web link | `POST /api/ingest` | `fetchWebContent` (Playwright + Readability) |
| RSS feed | `lib/rss/cron.ts` | Enqueues `rss_fetch` task → `fetchRSS` + `ingestFeedItems` |
| File upload | `POST /api/upload` | `extractPDF` or direct text read |
| Plain text | `POST /api/ingest` | Direct write |

All paths write a Markdown file with YAML frontmatter to `knowledge/inbox/{timestamp}-{slug}.md`.

### 2. Inbox → Queue

When the user clicks **Approve** in the Inbox panel:

1. `POST /api/inbox/process` archives the file immediately (to prevent double-clicks).
2. `enqueue('ingest', { fileName })` adds a task to the queue.
3. `saveQueueState()` writes the updated queue to `knowledge/meta/queue.json`.

### 3. Queue → Notes

The queue uses per-type isolated workers (`lib/queue.ts`). Each worker processes its own task type independently, so `ingest`, `rss_fetch`, and `web_fetch` tasks never block each other. Supported task types:

**`ingest`** — Convert an inbox entry to a structured note:
1. Verifies the inbox file still exists (`stat` check); if missing, marks task `failed` with `Inbox file not found`.
2. Reads the archived inbox file.
3. Checks for duplicate source URLs in existing notes (skips if found).
4. Calls `processInboxEntry()` → `callLLM()` (MiniMax API).
5. LLM returns structured JSON: title, tags, summary, keyFacts, timeline, links, QAs, content.
6. `saveNote()` writes the note to `knowledge/notes/{id}.md`.
7. `archiveInbox()` moves the source file to `knowledge/archive/inbox/` (idempotent — silently skips if already missing).
8. `saveQueueState()` records task completion.

**`rss_fetch`** — Fetch an RSS feed and write new items to the inbox:

**`rss_fetch`** — Fetch an RSS feed and write new items to the inbox:
1. Calls `fetchRSS(url)` to retrieve and parse the feed.
2. Calls `processFeedItems()` which applies `lastPubDate` filtering and deduplication.
3. Writes new items to `knowledge/inbox/` as Markdown files.
4. Updates subscription metadata (`lastChecked`, `lastEntryCount`, `lastPubDate`).

**`web_fetch`** — Scrape a web page and write to the inbox:
1. Calls `fetchWebContent(url)` (Playwright + Readability) to extract article content.
2. Writes the extracted content to `knowledge/inbox/` as a Markdown file.

**Retry:** Failed tasks can be manually retried via `retryTask(id)`, which resets the task to `pending` and re-queues it.

If the process crashes and restarts, `loadQueueState()` restores pending tasks and auto-restarts the worker.

### 4. Notes → Chat (RAG)

The chat endpoint (`POST /api/chat`) performs retrieval-augmented generation (RAG) before calling the LLM:

1. Tokenizes the last user message (Chinese character-level + English word-level).
2. Searches the inverted index with Zone-weighted scoring (tags > QAs > title > summary > content).
3. Applies optional link diffusion (1-hop neighbor notes at 30% weight decay).
4. Assembles the top results into a structured context string.
5. Injects the context into the system prompt sent to MiniMax.
6. Filters `<think>...</think>` tags from the LLM output before streaming to the client.
7. Streams the LLM response back to the client.
8. On stream completion, enqueues a `data:` SSE event containing source metadata (`{ type: 'sources', notes: [...] }`) so the UI can display knowledge references.

This provides grounded, knowledge-aware answers rather than generic conversational responses.

---

## Module Boundaries

```
app/                — HTTP layer (routing, JSON serialization)
├── api/            — Route handlers
├── layout.tsx      — Root layout, cron bootstrap
└── page.tsx        — Tab shell

components/         — React UI (Client Components + Server Components)
├── Sidebar.tsx
├── ChatPanel.tsx
├── InboxPanel.tsx
├── NotesPanel.tsx          — Server Component (fetches initial data)
├── NotesPanelClient.tsx    — Client Component (interactivity + SSE)
├── RSSPanel.tsx
├── TasksPanel.tsx
└── TabShell.tsx            — Tab container (CSS hidden for state preservation)

lib/
├── types.ts        — Source of truth for all data shapes
├── storage.ts      — FileSystemStorage (atomic writes, CRUD, index mgmt)
├── parsers.ts      — Note Markdown ↔ object serialization + inbox parsing
├── queue.ts        — Task queue + per-type workers + persistence (ingest, rss_fetch, web_fetch)
├── events.ts       — SSE event bus (server-to-client push for note changes)
├── search/
│   ├── inverted-index.ts  — Inverted index (tokenize, build, add, remove)
│   ├── engine.ts          — Search scoring, link diffusion, context assembly
│   └── eval.ts            — Quantified evaluation framework (golden dataset, quality gates)
├── cognition/
│   └── ingest.ts   — **Only module allowed to call LLM for note generation**
├── ingestion/
│   ├── web.ts      — Playwright + Readability extraction
│   ├── rss.ts      — RSS/Atom/JSON Feed parsing
│   └── pdf.ts      — PDF text extraction
└── rss/
    ├── manager.ts  — Subscription CRUD + incremental ingest
    └── cron.ts     — node-cron wrapper (enqueues tasks)
```

**Rule:** `lib/ingestion/*` only fetches raw data. It never touches the LLM. `lib/cognition/ingest.ts` is the sole LLM gateway.

---

## Storage Layer

### Why Filesystem?

- **Portability**: Notes are plain Markdown; any editor can open them.
- **Version control**: `knowledge/` can be tracked by Git.
- **No ops**: No Docker, no migrations, no connection strings.
- **Privacy**: Data never leaves the machine.

### Atomic Writes

`FileSystemStorage.atomicWrite(path, content)` uses the tmp+rename pattern:

```
mkdir -p dirname(path)
writeFile(path.tmp.${Date.now()}, content)
rename(tmp, path)
```

This ensures readers never see a partially written file.

### Directory Layout

```
knowledge/                    — Production data (default)
├── notes/               — Structured notes (*.md)
├── inbox/               — Pending review entries (*.md)
├── archive/
│   └── inbox/           — Rejected or processed inbox files
├── conversations/       — Chat history (*.md)
├── meta/
│   ├── inverted-index.md
│   ├── aliases.yml
│   ├── rss-sources.yml  — Subscriptions + lastPubDate
│   └── queue.json       — Serialized task queue
└── attachments/         — Uploaded original files

knowledge-test/               — E2E test data (isolated)
```

The storage root is configurable via the `KNOWLEDGE_ROOT` environment variable. When unset, it defaults to `knowledge/`. E2E tests set `KNOWLEDGE_ROOT=knowledge-test` so all file operations during tests go to `knowledge-test/` instead of `knowledge/`.

---

## Queue Design

### Why Not Redis/Bull?

The workload is tiny (single-user, at most a few dozen tasks per day). A Redis dependency would add operational complexity for no meaningful gain.

### State Machine

```
pending ──startWorker()──→ running ──success──→ done
                              │
                              └─failure──→ failed
```

### Persistence

Queue state is serialized as JSON after every state change:

```json
{
  "tasks": [ /* full history */ ],
  "pendingIds": [ "task-...", "task-..." ]
}
```

On module load, the queue reads `queue.json` and re-enqueues any tasks that were `pending` or `running` (the latter are reset to `pending`).

---

## RSS Incremental Update

### Problem

Without incremental tracking, every cron run would re-ingest every RSS item, creating duplicates.

### Solution: `lastPubDate` Watermark

Each subscription stores the latest `pubDate` it has processed:

```yaml
# knowledge/meta/rss-sources.yml
- url: https://overreacted.io/rss.xml
  name: Overreacted
  addedAt: '2025-04-24T00:00:00Z'
  lastPubDate: '2025-04-20T12:00:00Z'
```

- **First check**: Ingest up to 5 most-recent items, set `lastPubDate` to the newest.
- **Subsequent checks**: Only ingest items whose `pubDate > lastPubDate`.

### Race Condition Protection

Two layers of defense prevent overlapping execution:

1. **Cron-level `isRunning` lock** (`lib/rss/cron.ts`): If a previous cron tick is still enqueueing tasks, subsequent ticks are skipped. This prevents `node-cron` "missed execution" pile-up when many subscriptions are checked.
2. **Feed-level `processingFeeds: Set<string>`** (`lib/rss/manager.ts`): Prevents two concurrent `rss_fetch` tasks from ingesting the same feed URL at the same time.

---

## Web Extraction

### Why Playwright?

Modern sites (Next.js, React, Vue) ship HTML skeletons and render content client-side. A simple `fetch` only gets the empty shell. Playwright launches a headless Chromium browser, waits for `networkidle`, and extracts the fully rendered DOM.

### Pipeline

```
URL ──Playwright──→ rendered HTML ──JSDOM──→ Document
                                       │
                                       ├─Readability──→ article.title/textContent
                                       │
                                       └─fallback──→ body.innerText
```

Timeout: 20 seconds. The browser is always closed in a `finally` block.

---

## E2E Test Isolation

### Problem

E2E tests write real files (inbox entries, notes, queue state) to the filesystem. Without isolation, running tests would pollute the user's production `knowledge/` data.

### Solution: `KNOWLEDGE_ROOT` Environment Variable

All storage paths in the codebase read `process.env.KNOWLEDGE_ROOT` (with fallback to `knowledge/`):

| Module | Path Construction |
|--------|-------------------|
| `lib/storage.ts` | `constructor(root \|\| join(cwd, KNOWLEDGE_ROOT \|\| 'knowledge'))` |
| `lib/queue.ts` | `QUEUE_PATH = join(cwd, KNOWLEDGE_ROOT \|\| 'knowledge', 'meta', 'queue.json')` |
| `lib/rss/manager.ts` | `META_DIR = join(cwd, KNOWLEDGE_ROOT \|\| 'knowledge', 'meta')` |
| `app/api/upload/route.ts` | `UPLOAD_DIR = join(cwd, KNOWLEDGE_ROOT \|\| 'knowledge', 'attachments')` |

`playwright.config.ts` launches the dev server on port `3001` with `KNOWLEDGE_ROOT=knowledge-test`:

```
npx next dev -p 3001   # test server
```

Using a dedicated port (`3001`) prevents Playwright from accidentally reusing a user's regular dev server on `:3000`, which would serve the production `knowledge/` directory instead of the isolated `knowledge-test/` directory.

The `e2e/fixtures.ts` fixture provides `resetTestData()` which deletes `knowledge-test/` before each test, ensuring a clean slate. It also provides `createTestNote()` for seeding structured notes directly without going through the LLM pipeline.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Filesystem over database** | Notes are documents; Markdown is the native format. Git provides versioning for free. |
| **Memory queue + JSON persistence** | Workload is tiny. Avoids Redis ops overhead. |
| **Playwright over fetch** | Required for modern client-rendered sites. |
| **Inbox review step** | LLM calls cost money and can produce garbage. Human approval prevents polluting the knowledge base. |
| **YAML frontmatter** | Human-readable metadata that any Markdown editor can display. |
| **Inverted index (JSON)** | Keyword-based search index stored as `search-index.json`. Updated incrementally on note save/delete. |
| **E2E data isolation via env var** | Single `KNOWLEDGE_ROOT` point of control; no mocking or dependency injection needed. |
