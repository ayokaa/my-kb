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

### 1. Ingest

Raw content enters the system through four paths:

| Source | Entry Point | Handler |
|--------|-------------|---------|
| Web link | `POST /api/ingest` | Enqueues `web_fetch` task → `fetchWebContent` (Camoufox + trafilatura) → LLM |
| RSS feed | `lib/rss/cron.ts` | Enqueues `rss_fetch` task → `fetchRSS` + `ingestFeedItems` |
| File upload | `POST /api/upload` | `extractPDF` or direct text read → enqueues `ingest` task |
| Plain text | `POST /api/ingest` | Enqueues `ingest` task directly |

**Manual ingest** (text, link, file upload) no longer writes to the inbox. The API routes enqueue tasks immediately, and the worker calls `processInboxEntry()` → LLM → `saveNote()` directly.

**RSS ingest** still writes to `knowledge/inbox/{timestamp}-{slug}.md` as a buffer, awaiting manual approval or auto-processing.

### 2. Inbox → Queue (RSS & Legacy)

For RSS entries and legacy inbox files, when the user clicks **Approve** in the Inbox panel:

1. `POST /api/inbox/process` archives the file immediately (to prevent double-clicks).
2. `enqueue('ingest', { fileName })` adds a task to the queue.
3. `saveQueueState()` writes the updated queue to `knowledge/meta/queue.json`.

### 3. Queue → Notes

The queue uses per-type isolated workers (`lib/queue.ts`). Each worker processes its own task type independently, so `ingest`, `rss_fetch`, `web_fetch`, and `relink` tasks never block each other. Supported task types:

**`ingest`** — Convert content to a structured note. Supports two modes:

*Direct mode* (text, file upload, and manual link ingest):
1. Receives `title`, `content`, `sourceType`, and `rawMetadata` directly from the task payload.
2. Checks for duplicate source URLs in existing notes (skips if found).
3. Calls `processInboxEntry()` → `callLLM()` (reads model/credentials from `lib/llm.ts`).
4. LLM returns structured JSON: title, tags, summary, keyFacts, timeline, links, QAs, content.
5. `saveNote()` writes the note to `knowledge/notes/{id}.md`.
6. `saveQueueState()` records task completion.

*Legacy file mode* (RSS and old inbox entries):
1. Verifies the inbox file still exists (`stat` check); if missing, marks task `failed` with `Inbox file not found`.
2. Reads the archived inbox file.
3–6. Same as direct mode (duplicate check → LLM → saveNote).
7. `archiveInbox()` moves the source file to `knowledge/archive/inbox/` (idempotent — silently skips if already missing).
8. `saveQueueState()` records task completion.

**`relink`** — Refresh note-to-note associations:
1. Loads all notes via `storage.listNotes()`.
2. For each note, calls `relinkNote()` → search for top-5 candidates → LLM judgment.
3. Merges new links with existing links (additive, no deletion).
4. Saves only when links changed. Returns `{ processed, updated, failed }` stats.

**`rss_fetch`** — Fetch an RSS feed and write new items to the inbox:
1. Calls `fetchRSS(url)` to retrieve and parse the feed.
2. Calls `processFeedItems()` which applies `lastPubDate` filtering and deduplication.
3. Writes new items to `knowledge/inbox/` as Markdown files.
4. Updates subscription metadata (`lastChecked`, `lastEntryCount`, `lastPubDate`).

**`web_fetch`** — Scrape a web page and generate a note directly:
1. Calls `fetchWebContent(url)` (Camoufox + trafilatura) to extract article content.
2. Checks for duplicate source URLs in existing notes (skips if found).
3. Calls `processInboxEntry()` → LLM to generate a structured note.
4. `saveNote()` writes the note to `knowledge/notes/{id}.md`.
5. `saveQueueState()` records task completion.

**Retry:** Failed tasks can be manually retried via `retryTask(id)`, which resets the task to `pending` and re-queues it.

If the process crashes and restarts, `loadQueueState()` restores pending tasks and auto-restarts the worker.

### 4. Notes → Chat (RAG)

The chat endpoint (`POST /api/chat`) performs retrieval-augmented generation (RAG) before calling the LLM:

1. Loads the search index via `loadOrBuildIndex()` (5-minute TTL memory cache; concurrent requests share the same promise). If loading fails, the cached promise is cleared via `try/finally` so subsequent requests retry instead of hanging on a permanently rejected promise.
2. Tokenizes the last 3 user messages concatenated (jieba dictionary segmentation for Chinese; whitespace-split + lowercase for English; stop-word filtering).
3. Searches the inverted index with Zone-weighted scoring (tags > QAs > title > summary > keyFacts > links > backlinks). **Content is not indexed** — it accounts for 80%+ of index volume but the `assembleContext` context builder only uses the first 2000 chars of each note's body.
4. If structured search returns fewer than 3 results, a **ripgrep fallback** (`rg -l -i pattern notes/`) scans all note bodies for the query terms. Any matches are loaded via `storage.loadNote()` and appended at a low fixed score (0.3).
5. Applies optional link diffusion (1-hop neighbor notes at 30% weight decay).
6. Assembles the top results into a structured context string with dynamic character budget (`maxChars: 15000`). Each note's `sources` URLs are included so the LLM can discover referenced web pages.
7. **Tool calling (optional)**: A single streaming LLM call (`stream: true`) with Anthropic `tools` is issued. The response is consumed as `content_block_delta` events (`text_delta` for text, `input_json_delta` for tool arguments).
   - URLs are validated before fetching: only HTTP/HTTPS schemes are allowed; private/internal addresses (localhost, RFC 1918 ranges) are rejected to prevent SSRF.
   - A single chat request is limited to at most 3 tool calls to prevent resource exhaustion.
   - If `web_fetch` is invoked, the server calls `fetchWebContent(url)` (via Camoufox Python script) and appends the extracted article as a `tool_result` content block in the message history (Anthropic format).
8. Injects the context (+ tool results if any) into the conversation.
9. Filters `<think>...</think>` tags from the LLM output before streaming to the client.
10. Streams the LLM response back to the client via `ai` SDK `formatStreamPart`.
11. On stream start, enqueues `data:` SSE events for source metadata (`{ type: 'sources', notes: [...] }`) and any tool calls (`{ type: 'tool_call', name, url }`) so the UI can display knowledge references and fetch indicators.

This provides grounded, knowledge-aware answers rather than generic conversational responses. When the knowledge base is insufficient, the LLM can fetch fresh web content on-the-fly.

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
├── TabShell.tsx            — Tab container (CSS hidden for state preservation)
├── Providers.tsx           — Client wrapper (ToastProvider)
└── Providers.tsx           — Client wrapper (ToastProvider)

hooks/
├── ToastContext.tsx  — Global toast notification system (React Context)
└── useSSE.ts         — Generic SSE hook with typed events + auto-reconnect

lib/
├── memory.ts       — User memory modeling (profile, note familiarity, conversation digest)

lib/
├── types.ts        — Source of truth for all data shapes
├── storage.ts      — FileSystemStorage (atomic writes, CRUD, index mgmt)
├── parsers.ts      — Note Markdown ↔ object serialization + inbox parsing
├── queue.ts        — Task queue + per-type workers + persistence (ingest, rss_fetch, web_fetch, relink)
├── settings.ts     — Runtime configuration (YAML persistence, env fallback)
├── llm.ts          — Centralized async LLM client factory (reads settings fresh every call)
├── events.ts       — Typed SSE event bus (emitNoteEvent, emitTaskEvent, emitInboxEvent)
├── search/
│   ├── inverted-index.ts  — Inverted index (tokenize, build, add, remove)
│   ├── engine.ts          — Search scoring, link diffusion, context assembly
│   └── eval.ts            — Quantified evaluation framework (golden dataset, quality gates)
├── cognition/
│   ├── ingest.ts   — LLM gateway for note generation (structure + QAs + links)
│   └── relink.ts   — LLM gateway for refreshing note-to-note links
├── ingestion/
│   ├── web.ts      — Camoufox + trafilatura extraction
│   ├── rss.ts      — RSS/Atom/JSON Feed parsing
│   └── pdf.ts      — PDF text extraction
├── rss/
│   ├── manager.ts  — Subscription CRUD + incremental ingest
│   └── cron.ts     — cron wrapper (enqueues rss_fetch tasks, restartable)
└── relink/
    └── cron.ts     — cron wrapper (enqueues relink tasks, restartable)
```

**Rules:**
- `lib/ingestion/*` only fetches raw data. It never touches the LLM.
- `lib/cognition/ingest.ts` and `lib/cognition/relink.ts` are the only modules allowed to call the LLM for note generation / link refresh.
- `lib/llm.ts` is the single source of truth for LLM client instantiation. All call sites (`ingest.ts`, `relink.ts`, `app/api/chat/route.ts`, `app/api/memory/update/route.ts`) go through it.

---

## Real-Time Updates (SSE + Toast)

### Problem

The original system used a single undifferentiated `data: changed` SSE broadcast for all events. Every panel that subscribed (only NotesPanel and TasksPanel) had to re-fetch its entire dataset because the signal carried no information about what changed. InboxPanel and RSSPanel had no SSE subscription at all — new RSS items and incoming inbox entries were invisible until the user manually refreshed or switched tabs. Operation feedback was limited to in-line status text (e.g., delete results) or silent `console.error` for failures.

### Solution

Three layers of infrastructure:

**1. Typed SSE Events (`lib/events.ts`)**

The single `broadcastNoteChanged()` is replaced by three typed emit functions:

| Function | SSE event | Payload | Triggered by |
|----------|-----------|---------|-------------|
| `emitNoteEvent` | `note` | `{ action, id, title }` | `saveNote()`, `deleteNote()`, queue ingest/web_fetch workers |
| `emitTaskEvent` | `task` | `{ action, id, type, error?, result? }` | `enqueue()`, worker start/complete/fail, `retryTask()` |
| `emitInboxEvent` | `inbox` | `{ action, count }` | `writeInbox()` |

Events use standard SSE format (`event: note\ndata: {"action":"created",...}\n\n`), enabling `EventSource.addEventListener()` for targeted handling.

**2. Generic SSE Hook (`hooks/useSSE.ts`)**

A single React hook replaces per-panel manual `EventSource` construction:

```typescript
const { connected } = useSSE({
  onNote: (e) => { /* type: NoteEvent, payload parsed */ },
  onTask: (e) => { /* type: TaskEvent */ },
  onInbox: (e) => { /* type: InboxEvent */ },
  onConnectionChange: (c) => { /* c: boolean */ },
})
```

Features: exponential backoff reconnection (1s → 2s → 4s → max 30s), JSON parsing built-in, cleanup on unmount.

**3. Global Toast (`hooks/ToastContext.tsx`)**

Zero-dependency React Context system:

```typescript
const { show } = useToast()
show('笔记已删除', 'info')
show('任务完成', 'success')
show('加载失败', 'error')
```

Toasts stack at bottom-right, auto-dismiss after 4 seconds, click to close. `ToastProvider` wraps the app in `layout.tsx`.

**Connection Status:** `Sidebar` renders a green/amber dot in its footer using `useSSE`'s `connected` state, providing visual feedback when the SSE connection drops. Three states: gray "连接中" → green "已连接" → amber pulsing "重连中".

### Panel Migration

All 6 panels migrated from manual `EventSource` + `console.error` to `useSSE` + `useToast`:

| Panel | Before | After |
|-------|--------|-------|
| NotesPanelClient | Manual EventSource → load() | `useSSE({ onNote })` → load(); toast on delete/errors |
| TasksPanel | Manual EventSource → load() | `useSSE({ onTask })` → load() + toast on complete/fail |
| InboxPanel | **No SSE** | `useSSE({ onInbox })` → load(); toast on approve/reject |
| RSSPanel | **No SSE** | `useSSE({ onInbox })` → load(); toast on add/remove/check |
| ChatPanel | `console.error` | toast on save/create/delete errors |
| TabShell | Manual EventSource → count fetch | `useSSE({ onInbox, onTask })` → badge count update |

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
├── meta/
│   ├── search-index.json  — Inverted index (JSON)
│   ├── aliases.yml
│   ├── rss-sources.yml    — Subscriptions + lastPubDate
│   ├── queue.json         — Serialized task queue
│   └── settings.yml       — Runtime settings
├── conversations/       — Chat history (*.md)
└── attachments/         — Uploaded original files

knowledge-test/               — E2E test data (isolated)
```

The storage root is configurable via the `KNOWLEDGE_ROOT` environment variable. When unset, it defaults to `knowledge/`. E2E tests set `KNOWLEDGE_ROOT=knowledge-test` so all file operations during tests go to `knowledge-test/` instead of `knowledge/`.

---

## Settings System

### Problem

LLM credentials, model names, and cron intervals were statically baked into environment variables at boot time. Changing any value required editing `.env.local` and restarting the server.

### Solution

`lib/settings.ts` provides a runtime configuration layer:

1. **Persistence**: Settings are stored as YAML at `knowledge/meta/settings.yml` via atomic write (tmp+rename).
2. **Fallback chain**: `loadSettings()` reads the file first, then overrides individual fields with environment variables (`MINIMAX_API_KEY`, `LLM_MODEL`, `RSS_CHECK_INTERVAL_MINUTES`, etc.). This ensures backward compatibility — existing `.env.local` files continue to work.
3. **Hot reload**: `lib/llm.ts` caches the `Anthropic` client instance and invalidates the cache when settings change (detected via settings content hash). This avoids the overhead of reconstructing the client on every call while still enabling hot reload without server restart.
4. **Cron restartability**: Both `lib/rss/cron.ts` and `lib/relink/cron.ts` expose `stop/restart` functions. The Settings API (`POST /api/settings`) calls them when interval/expression changes.
5. **Security**: `GET /api/settings` returns a *safe* copy where the API key is masked (`sk-...xxxx`). Only `POST` accepts the full key.

### UI

`components/SettingsPanel.tsx` is a `'use client'` form that fetches current settings on mount and POSTs changes on save. It lives in the main tab switcher (`TabShell`) alongside Chat, Inbox, Notes, etc.

---

## User Memory System

### Problem

The chat system treated every conversation as stateless. It had no memory of the user's background, preferences, or prior familiarity with knowledge base topics. This meant:
- A user who had discussed "vector databases" extensively would still receive beginner-level explanations on the next mention.
- The LLM had no awareness of the user's role, tech stack, or interests, leading to generic responses.
- Note status (`seed`/`growing`/`evergreen`) was purely manual — there was no signal from actual usage.

### Solution

A lightweight user memory model (`lib/memory.ts`) that is updated automatically after each conversation.

**Data Model** (`UserMemory`, persisted at `knowledge/meta/user-memory.json`):

| Field | Type | Purpose |
|-------|------|---------|
| `profile` | `{ role?, techStack[], interests[], background? }` | User's professional identity and domain knowledge |
| `noteKnowledge` | `Record<noteId, { level, firstSeenAt, lastReferencedAt, notes }>` | Observed familiarity with specific notes (`aware` → `referenced` → `discussed`) |
| `conversationDigest` | `{ conversationId, summary, topics[], timestamp }[]` | Rolling window of the last 20 conversation summaries |
| `preferences` | `Record<string, unknown>` | Observed signals (detail level, code example preference, etc.) |

**Update Pipeline** (`POST /api/memory/update`):

1. **Load existing memory** from `user-memory.json` (or empty memory if first time).
2. **Build prompt** containing:
   - Current user profile summary (if any)
   - Recent 3 conversation summaries
   - The full conversation to analyze
3. **LLM extraction** with a structured JSON output prompt. The LLM returns only *changes* — fields with no new information are omitted.
4. **Merge** (`mergeMemory()`) using field-specific strategies:
   - Arrays (`techStack`, `interests`): dedup append
   - Scalars (`role`, `background`): overwrite
   - `conversationDigest`: insert at front, cap at 20 entries
   - `noteKnowledge`: per-note overwrite with `firstSeenAt` preservation
5. **Atomic save** (tmp+rename) to `user-memory.json`.
6. **Status evolution** (`evolveNoteStatuses()`) scans all notes and transitions status based on `noteKnowledge`:
   - `seed` → `growing` when `level !== 'aware'`
   - `growing` → `evergreen` when `level === 'discussed'`
   - `evergreen` → `stale` after 30 days without reference (while knowledge still exists)
   - `stale` → `growing` when referenced again
   - Any non-archived status → `seed` when knowledge is removed (via manual deletion or clear)
   - `archived` is never changed

**Manual memory management** (`GET/POST/DELETE /api/memory`):

A dedicated memory panel allows users to view and edit their memory directly. Supported operations:
- View full memory (profile, note knowledge, conversation digest, preferences)
- Edit profile (role, background, techStack, interests)
- Edit/delete preferences
- Delete individual note knowledge entries
- Delete individual conversation digest entries
- Clear all memory (with confirmation)

Any operation that removes `noteKnowledge` triggers `evolveNoteStatuses()` to keep note statuses in sync.

**Chat Integration** (`getChatContext()`):

Before each chat completion, the system calls `getChatContext(memory, relevantNoteIds)` to produce a structured "user profile" block that is injected into the system prompt. This block includes:
- Profile lines (role, tech stack, interests, background)
- Preference signals
- Recent 3 conversation summaries
- Familiarity notes for relevant knowledge base entries

If no memory exists, the block is omitted entirely — zero overhead for new users.

**Design Decisions:**
- **No LLM on read path**: `getChatContext()` is a pure formatting function; no LLM call is made when loading memory for chat.
- **Incremental, not replacement**: The LLM only emits *changes*, and the merge logic preserves history. This prevents the model from "forgetting" information due to context window limits.
- **Pure rules for status evolution**: `computeNoteStatus()` uses simple time + level thresholds. No LLM involvement means instant, deterministic, and cheap updates.

---

## Link Generation & Maintenance

### Ingest-Time Link Generation (Two-Stage)

When a new note is created, the system decides which existing notes it should link to:

1. **Mechanical pre-filter**: If the knowledge base has >10 notes, the search engine (`buildIndex` + `search`) ranks existing notes against the incoming entry. Only the top 5 candidate titles are passed to the LLM.
2. **LLM judgment**: The LLM receives the candidate subset and decides actual links (with weight and context).
3. **Void-link filtering**: Generated links are validated against existing note titles using bidirectional substring matching. Invalid links are silently discarded.

If the knowledge base has ≤10 notes, all titles are passed to the LLM (no pre-filter needed).

### Background Relink Job

Problem: Links are generated at ingest time. A note created early in the knowledge base's life never gets links to notes that were added later.

Solution: A daily `relink` cron job (default `0 3 * * *`) traverses all notes and re-evaluates their links:

1. For each note, search for top-5 related candidates (excluding itself).
2. Ask the LLM which candidates this note should link to.
3. Merge new links into the note's existing `links` array (additive, no deletion of old links).
4. Save only if links actually changed.

The job is enqueued as a `relink` task type and processed by the queue's per-type worker, so it never blocks ingest or RSS tasks.

### Backlinks (反向链接)

Links are directional (`note A → note B`). Backlinks provide the reverse view (`note B ← note A`), enabling bidirectional navigation in the UI.

**Data model:** `Note.backlinks: NoteLink[]`, persisted under a `## 反向链接` Markdown section. Format mirrors `## 关联`:
```markdown
## 反向链接
- [[引用此笔记的标题]] #strong — 关联上下文
```

**Auto-build on save:** `saveNote()` computes backlinks by scanning all other notes' `links` arrays. A link matches when either title contains the other (bidirectional substring, case-insensitive). This is the same fuzzy rule used by `navigateToNote()` and `rebuildBacklinks()`, ensuring consistency between storage, navigation, and rebuild.

**Full rebuild:** `rebuildBacklinks()`:
1. Loads all notes.
2. Resets `backlinks` on every note.
3. For each link in each note, finds **all** target notes by fuzzy title match (bidirectional substring, case-insensitive). Unlike the older single-match behavior, every note whose title matches the link target receives a backlink entry.
4. Appends `{ target: sourceNote.title, weight, context }` to each matching target's `backlinks`.
5. Saves all modified notes with `skipBacklinkRebuild: true` to avoid recursion.

**Trigger points:**
- `saveNote()` — auto-builds for the saved note.
- `deleteNote()` — rebuilds after archiving (the deleted note's backlinks are removed, and notes that linked to it are updated).
- Queue workers — `ingest` and `relink` tasks call `rebuildBacklinks()` on completion.

**Indexing:** `buildNoteIndex()` indexes `backlink.target` into the inverted index with field `backlink` (weight 1.5), so searching for a note title also surfaces notes that are referenced by it.

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
  "tasks": [ /* active + recent history */ ],
  "pendingIds": [ "task-...", "task-..." ]
}
```

Persistence strategy:
- All `pending` and `running` tasks are **always** retained (never trimmed).
- `done` and `failed` tasks are capped at the most recent 100, sorted by `createdAt` descending.
- `pendingIds` covers all 4 task types (`ingest`, `rss_fetch`, `web_fetch`, `relink`).

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

1. **Cron-level `isRunning` lock** (`lib/rss/cron.ts`): If a previous cron tick is still enqueueing tasks, subsequent ticks are skipped. This prevents cron "missed execution" pile-up when many subscriptions are checked.
2. **Feed-level `processingFeeds: Set<string>`** (`lib/rss/manager.ts`): Prevents two concurrent `rss_fetch` tasks from ingesting the same feed URL at the same time.

---

## Web Extraction

### Why Camoufox?

Modern sites (Next.js, React, Vue) ship HTML skeletons and render content client-side. A simple `fetch` only gets the empty shell. Camoufox is a privacy-focused Firefox fork built for automation: it executes JavaScript like a real browser while resisting fingerprinting and bot detection. The Node.js side spawns a Python script (`scripts/fetch_web.py`) that uses `camoufox.sync_api.Camoufox` to render the page and return the full HTML.

### Pipeline

```
URL ──Camoufox (Python)──→ rendered HTML ──trafilatura──→ {title, content}
```

- Wait strategy: `domcontentloaded` (with `load` fallback), avoiding indefinite hangs from persistent analytics/tracking requests that prevent `networkidle` from ever firing.
- Timeout: 20 seconds.
- The browser page is always closed in a `finally` block.
- The browser instance is a singleton; graceful shutdown on `SIGTERM`/`SIGINT`.

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
| **Camoufox over fetch** | Required for modern client-rendered sites; anti-fingerprinting reduces bot detection. |
| **Inbox review step** | LLM calls cost money and can produce garbage. Human approval prevents polluting the knowledge base. |
| **YAML frontmatter** | Human-readable metadata that any Markdown editor can display. |
| **Inverted index + ripgrep fallback** | Chinese tokenization via jieba dictionary; 7 metadata fields indexed (content excluded). Structured results below threshold trigger `rg` full-text scan. Index persisted as `search-index.json`, updated incrementally on note save/delete. |
| **E2E data isolation via env var** | Single `KNOWLEDGE_ROOT` point of control; no mocking or dependency injection needed. |
