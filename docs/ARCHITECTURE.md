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
| RSS feed | `lib/rss/cron.ts` | `fetchRSS` + `ingestFeedItems` |
| File upload | `POST /api/upload` | `extractPDF` or direct text read |
| Plain text | `POST /api/ingest` | Direct write |

All paths write a Markdown file with YAML frontmatter to `knowledge/inbox/{timestamp}-{slug}.md`.

### 2. Inbox → Queue

When the user clicks **Approve** in the Inbox panel:

1. `POST /api/inbox/process` archives the file immediately (to prevent double-clicks).
2. `enqueue('ingest', { fileName })` adds a task to the queue.
3. `saveQueueState()` writes the updated queue to `knowledge/meta/queue.json`.

### 3. Queue → Notes

The queue worker (`lib/queue.ts`) processes tasks serially:

1. Reads the archived inbox file.
2. Checks for duplicate source URLs in existing notes (skips if found).
3. Calls `processInboxEntry()` → `callLLM()` (MiniMax API).
4. LLM returns structured JSON: title, tags, summary, keyFacts, timeline, links, QAs, content.
5. `saveNote()` writes the note to `knowledge/notes/{id}.md`.
6. `saveQueueState()` records task completion.

If the process crashes and restarts, `loadQueueState()` restores pending tasks and auto-restarts the worker.

### 4. Notes → Chat

The chat endpoint (`POST /api/chat`) streams responses from MiniMax. Currently it does **not** search the knowledge base before responding; it is a standalone conversational agent. KB-augmented chat is a future enhancement.

---

## Module Boundaries

```
app/                — HTTP layer (routing, JSON serialization)
├── api/            — Route handlers
├── layout.tsx      — Root layout, cron bootstrap
└── page.tsx        — Tab shell

components/         — React UI (all Client Components)
├── Sidebar.tsx
├── ChatPanel.tsx
├── InboxPanel.tsx
├── NotesPanel.tsx
├── RSSPanel.tsx
└── TasksPanel.tsx

lib/
├── types.ts        — Source of truth for all data shapes
├── storage.ts      — FileSystemStorage (atomic writes, CRUD, index mgmt)
├── parsers.ts      — Note Markdown ↔ object serialization
├── queue.ts        — Task queue + worker + persistence
├── cognition/
│   └── ingest.ts   — **Only module allowed to call LLM**
├── ingestion/
│   ├── web.ts      — Playwright + Readability extraction
│   ├── rss.ts      — RSS/Atom/JSON Feed parsing
│   └── pdf.ts      — PDF text extraction
└── rss/
    ├── manager.ts  — Subscription CRUD + incremental ingest
    └── cron.ts     — node-cron wrapper
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
knowledge/
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
```

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

A `processingFeeds: Set<string>` lock prevents two overlapping cron runs from ingesting the same feed concurrently.

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

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Filesystem over database** | Notes are documents; Markdown is the native format. Git provides versioning for free. |
| **Memory queue + JSON persistence** | Workload is tiny. Avoids Redis ops overhead. |
| **Playwright over fetch** | Required for modern client-rendered sites. |
| **Inbox review step** | LLM calls cost money and can produce garbage. Human approval prevents polluting the knowledge base. |
| **YAML frontmatter** | Human-readable metadata that any Markdown editor can display. |
| **Inverted index in Markdown** | Keeps everything in the same format; no separate index file to maintain. |
