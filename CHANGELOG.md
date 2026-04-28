# Changelog

All notable changes to this project are documented in this file.

## 2026-04-28

### Added

- **运行时日志系统**：新增结构化日志模块，支持前后端统一的日志收集、持久化与实时查看。
  - `lib/logger.ts`：核心 Logger 类，提供 `debug/info/warn/error` 四级日志 API；内存环形缓冲区（1000 条）+ 按天轮转的文件持久化（JSON Lines，保留 30 天）；支持 `patchConsole()` 无侵入拦截现有 `console.*` 调用。
  - `app/api/logs/route.ts`：GET 查询日志（支持 level/module/search/limit/offset/from 过滤）；DELETE 清空内存缓冲。
  - `app/api/logs/stream/route.ts`：SSE 实时推送新日志，带历史回溯和心跳保活。
  - `components/LogsPanel.tsx`：前端日志查看面板，支持级别过滤、模块过滤、关键词搜索、实时/暂停切换、自动滚动、元数据展开。
  - `Sidebar` / `TabShell`：新增 "日志" 标签页入口。
  - 核心模块（`queue`, `rss/cron`, `rss/manager`, `cognition/ingest`, `cognition/relink`, `relink/cron`）的 `console.*` 调用已迁移至 `logger.*`。
  - `app/layout.tsx` 启动时自动调用 `patchConsole()` 初始化日志拦截。

### Fixed

- **Search cache deadlock** (`lib/search/cache.ts`): `doLoadOrBuild` exceptions left `loadPromise` permanently set to a rejected Promise, causing all subsequent requests to hang. Fixed with `try/finally` to always reset `loadPromise` to `null`. (`50f6dfe`)
- **Search backlink field type** (`lib/search/types.ts`): `SearchField` was missing `backlink`, causing backlink-indexed terms to receive zero weight during scoring. Added `backlink` to the union type and `DEFAULT_ZONE_WEIGHTS` (weight 1.2). (`de2a210`)
- **LLM client caching** (`lib/llm.ts`): `getLLMClient` was instantiating a fresh `OpenAI` client on every call, causing unnecessary overhead and TOCTOU races on the settings file. Added instance caching with settings-change detection. New `getLLM()` helper returns both `client` and `model` atomically. (`29bbe04`)
- **Chat SSRF protection & tool-call concurrency** (`app/api/chat/route.ts`):
  - `web_fetch` URLs are validated to be HTTP/HTTPS only; private/internal addresses (e.g., `192.168.x.x`, `10.x.x.x`, `127.x.x.x`, `localhost`) are rejected before any outbound request.
  - A single chat request is limited to at most 3 tool calls to prevent resource exhaustion.
  - Tests refactored to use top-level `vi.mock` to avoid `vi.doMock` module-cache timeouts. (`4f8ef97`)
- **Backlinks rebuild multi-match** (`lib/storage.ts`): `rebuildBacklinks()` used `find()` which stopped after the first fuzzy title match, while `saveNote()` auto-build used multi-match logic. This inconsistency meant some valid backlinks were dropped during full rebuilds. Replaced with a `for...of` loop over all notes so every matching target receives the backlink. (`1c21162`)

## 2026-04-27

### Added

- **Settings UI Panel**: New "设置" tab in the sidebar allows runtime configuration of:
  - LLM model, API key, and base URL (hot-reloaded without server restart)
  - RSS check interval (minutes)
  - Relink cron expression
  - Configuration is persisted to `knowledge/meta/settings.yml` with env-var fallback. (`09cdf11`)
- **Centralized LLM client** (`lib/llm.ts`): Async factory replaces 3 scattered `new OpenAI()` instantiations. Credentials are read fresh on every call, enabling runtime reconfiguration. (`09cdf11`)
- **Relink cron job** (`lib/relink/cron.ts`): Daily background task that re-evaluates note-to-note associations for the entire knowledge base. Existing notes get links to newer notes they missed at ingest time. Merge strategy: additive (new links appended, old links preserved). (`9530fe3`)
- **Mechanical pre-filter for link generation** (`lib/cognition/ingest.ts`): When the knowledge base has >10 notes, the LLM no longer receives all titles. Instead, the existing search engine ranks notes against the incoming entry and only the top 5 candidates are passed to the LLM for judgment. This prevents LLM degradation as the note count grows. (`dc6d508`)
- **AI real-time web fetch tool calling** (`app/api/chat/route.ts`): The chat API now supports LLM-driven `web_fetch` tool calls. When the knowledge base content is insufficient, the LLM can invoke `fetchWebContent` (Playwright + Readability) to scrape web pages on-the-fly and inject the extracted content into the conversation context. Two-phase calling: tool detection (`stream: false`) → execute fetch → streaming response (`stream: true`). (`23580f2`)
- **Backlinks (反向链接)**: Complete bidirectional link tracking across the knowledge base.
  - `Note` model gains `backlinks: NoteLink[]`, persisted to YAML Markdown under a new `## 反向链接` section. (`7a781a8`)
  - `parseNote`/`stringifyNote` support the new section. (`7a781a8`)
  - `buildNoteIndex` indexes `backlink.target` into the inverted index (field: `backlink`). (`7a781a8`)
  - `saveNote()` auto-builds backlinks for the current note using bidirectional substring matching. (`1a71bfc`)
  - `rebuildBacklinks()` performs a full rebuild across all notes. (`1a71bfc`)
  - `deleteNote()` triggers `rebuildBacklinks()` after archiving. (`1a71bfc`)
  - Queue `ingest`/`relink` tasks call `rebuildBacklinks()` on completion. (`d6d22c9`)
  - Frontend `NotesPanelClient` displays a "反向链接" section below "关联"; clicking navigates to the source note. (`be59173`)
- **Search index memory cache** (`lib/search/cache.ts`): Extracted from `chat/route.ts` for testability. `loadOrBuildIndex` provides a 5-second TTL in-memory cache plus request deduplication (concurrent calls share the same promise). Eliminates redundant `search-index.json` reads across chat requests. (`601fd9e`, `e14fd9b`)

### Changed

- **Cron restartability**: Both RSS and relink cron modules now track `ScheduledTask` handles and expose `stop/restart` functions, enabling hot-reload from the Settings panel. (`09cdf11`)
- **Queue type expansion**: `lib/queue.ts` gained a fourth task type `relink` with its own isolated worker. (`9530fe3`)
- **Ingest link candidate selection**: `selectCandidateTitles()` is now generic over `{title, content}` so both `InboxEntry` and `Note` can reuse the same search-based pre-filter. (`9530fe3`)
- **Ingest three-step pipeline** (`lib/cognition/ingest.ts`): Refactored single LLM call into Extract → QA → Link serial pipeline. Each step has a single responsibility. Step 2/3 degrade gracefully to empty arrays on retry exhaustion instead of failing the entire note. Exponential backoff retry (1s → 2s, max 2 retries). (`bee9c14`)
- **Search system overhaul** (`lib/search/engine.ts`, `lib/search/inverted-index.ts`):
  - Tokenization: removed single-char膨胀, replaced with whole-word + 2-char/3-char combos. Index dropped from ~160k to ~90k terms.
  - Scoring: multi-field score accumulation + simple IDF decay instead of max-only.
  - Context: `assembleContext()` replaced hard `maxNotes` limit with dynamic character budget (`maxChars: 15000`), packing full metadata + content previews until budget exhausted.
  - Query building: chat API uses last 3 user messages concatenated instead of only the last one.
  - Index version bumped to v2, triggering automatic rebuild on first load. (`185492f`)
- **Search context character budget** (`lib/search/engine.ts`): Removed hardcoded `limit` from `search()`; `assembleContext()` now uses a `maxChars` budget (default 15000) to dynamically pack full note metadata and content previews. Chat API no longer passes a limit, letting the budget mechanism decide how many notes fit. (`79a7208`)
- **Message queue** (`components/ChatPanel.tsx`): While the LLM is generating a response, new user messages enter a queue instead of spawning concurrent requests. Queued messages display as semi-transparent "排队中" bubbles and are auto-sent when the current turn completes. Send button shows queue count during loading. (`712a581`)
- **IngestPanel extraction** (`components/IngestPanel.tsx`): The ingest UI (text/link/file/rss tabs) was extracted from `ChatPanel` into a standalone `IngestPanel` component accessed via a new Sidebar tab. `ChatPanel` now focuses solely on conversation management and chat. (`2a9c9b6`)
- **E2E ingest navigation fix**: Updated E2E tests to navigate via `nav-ingest` instead of the removed `ingest-toggle` button, and switched to `data-testid` locators to avoid strict-mode violations on ambiguous text matches. (`78f2c4e`)
- **Search context sources visibility** (`lib/search/engine.ts`): `assembleContext` now includes each note's `sources` URLs in the context string, enabling the LLM to discover and fetch from referenced web pages during tool calls. (`2fac0f3`)
- **Note link navigation consistency** (`components/NotesPanelClient.tsx`, `lib/storage.ts`): Link creation, validation, `navigateToNote`, `saveNote`, and `rebuildBacklinks` all use the same bidirectional substring matching (`t.includes(target) || target.includes(t)`), eliminating "link stored but navigation fails" mismatches. (`be59173`)

### Fixed

- **Void link cleanup** (`lib/cognition/ingest.ts`, `lib/queue.ts`): LLM prompt now receives the list of existing note titles and is instructed to only link to real notes. `processInboxEntry()` filters generated links against existing titles using bidirectional substring matching. `buildLinkMap()` and `diffuseLinks()` skip links whose target cannot be found. A one-time migration removed 97 void links across 42 notes, leaving only valid associations. (`2426c5f`)
- **Chat status filter**: Chat RAG search now includes all note statuses (`seed`, `growing`, `evergreen`, `stale`) instead of only `evergreen`/`growing`, ensuring newer notes are discoverable. (`ddd549f`)
- **Conversation delete interaction**: Changed from single-click immediate delete to double-click confirm (3-second timeout to cancel). Added `DELETE /api/conversations/[id]` endpoint. (`ddd549f`)
- **Auto-create conversation on empty list**: When all conversations are deleted, a new session is automatically created instead of leaving the user with a blank chat. (`36ad157`)
- **RSS cron expression**: Fixed `*/59 * * * *` to `0 * * * *` for true hourly scheduling. Reads `RSS_CHECK_INTERVAL_MINUTES` env var. (`ddd549f`)
- **ChatPanel layout fixes**:
  - Added `overflow-hidden` + `h-full` to prevent the left conversation list from being pushed out of the viewport during chat scroll. (`334027a`)
  - Added `min-h-0` to `ChatArea` root and message area to restore the missing scrollbar when content overflows. (`6e26608`)
  - Added `min-w-0 truncate` to long conversation names and `shrink-0` to the delete button to prevent it from being squeezed out by flex layout. (`489a660`)
- **`archiveInbox` idempotency**: `storage.archiveInbox()` now checks if the source file exists before attempting `rename()`. If the file is already missing (e.g. manually deleted or removed by `resetTestData()` during E2E), it returns silently instead of throwing `ENOENT`. (`f0f6cd5`)
- **`runIngestTask` missing-file handling**: The queue worker now calls `stat()` on the inbox file before `readFile()`. If the file is missing, the task is marked `failed` with a clear error message (`Inbox file not found: {fileName}`) instead of crashing the worker with an unhandled `ENOENT`. (`f0f6cd5`)
- **RSS cron missed-execution pile-up**: `lib/rss/cron.ts` now guards the callback with an `isRunning` lock. If a previous tick is still enqueueing feed checks, subsequent ticks are skipped with a log message instead of overlapping and producing `missed execution` warnings. (`21110d2`)
- **Playwright dev-server collision**: `playwright.config.ts` now launches the test server on port `3001` (`npx next dev -p 3001`) with `baseURL: http://localhost:3001`. This prevents Playwright from accidentally reusing a user's regular dev server on `:3000` (which uses the production `knowledge/` directory instead of `knowledge-test/`). (`b9cca0c`)
- **PDF parsing ESM import**: Fixed `pdf-parse` v2.4.5 ESM compatibility by using `new PDFParse({ data: buffer })` with an explicit `PDFJS_WORKER_PATH`, resolving `dist` path resolution failures. (`e03d236`)
- **Task queue blocking**: Replaced the single serial worker with per-type isolated workers (`ingest`, `rss_fetch`, `web_fetch`). Tasks of different types no longer block each other, improving throughput. (`25e263c`)
- **Duplicate conversation creation** (`components/ChatPanel.tsx`): `handleNewConversation` now guards with `isCreatingRef` to prevent double-click, React Strict Mode double-invocation, and auto-create + button-click overlap from spawning duplicate conversations. (`6bd24c2`)
- **Task count accuracy** (`lib/queue.ts`): `listInboxPending()` once again includes `rss_fetch` tasks in the count, restoring correct badge numbers in the sidebar. (`87ddf06`)
- **Queue persistence trimming** (`lib/queue.ts`): `queue.json` caps done/failed tasks at the most recent 100; `pending`/`running` tasks are never trimmed. Recovery resets `status === 'running'` to `pending` and re-queues them. `pendingIds` now covers all 4 types (`ingest`/`rss_fetch`/`web_fetch`/`relink`). (`6901ff8`, `4cb56dc`)
- **Web fetch timeout** (`lib/ingestion/web.ts`): `page.goto` wait strategy downgraded from `networkidle` to `domcontentloaded` (with `load` fallback), avoiding indefinite hangs on modern sites with persistent analytics/tracking requests. (`d008769`)

### Added

- **E2E coverage expansion**: 20 → 28 tests (+8) across existing spec files:
  - `notes.spec.ts` (+3): note detail view, search + status filtering, delete with confirmation dialog.
  - `upload.spec.ts` (+2): Markdown and plain-text file upload via the ingest panel.
  - `rss.spec.ts` (+1): subscription removal via UI.
  - `tasks.spec.ts` (+1): failed task visibility after worker error.
  - `inbox.spec.ts` (+1): RSS entry detail renders "Open original" link and feed summary.
- **`e2e/fixtures.ts` `createTestNote()` helper**: Directly writes a structured Markdown note to `knowledge-test/notes/` using `stringifyNote()`, enabling E2E tests to seed notes without going through the LLM pipeline.
- **RSS Panel accessibility**: Delete-subscription button now has `aria-label="删除订阅"` for reliable E2E targeting and screen-reader support. (`eed491d`)
- **Unit tests for cron lock**: `lib/rss/__tests__/cron.test.ts` (4 tests) covers interval expression, enqueue behavior, overlap-skipping logic, and duplicate-start prevention. (`21110d2`)
- **Unit tests for missing-file resilience**: `lib/__tests__/storage.test.ts` and `lib/__tests__/queue.test.ts` each gained one test verifying graceful handling when an inbox file disappears mid-processing. (`f0f6cd5`)
- **SSE event bus**: New `/api/events` endpoint provides a Server-Sent Events stream for server-to-client push notifications. (`46eb289`)
- **Note change broadcasting**: `saveNote()` and `deleteNote()` now emit `changed` events through the event bus after completing, driving real-time UI refreshes. (`a1242e5`)
- **Conversation management API**: Added `/api/conversations` (list/create) and `/api/conversations/[id]` (load/save) endpoints for multi-session persistence. Conversation IDs use `conv-{timestamp}-{random}` format and are sorted by `updatedAt` descending. (`32f3504`)
- **web_fetch task type**: Link ingestion (`POST /api/ingest` with `type: 'link'`) is now asynchronous via the task queue, returning `202 Accepted` + `taskId` immediately. (`81b9bc1`)
- **inbox_pending filtering**: Added `listInboxPending()` and `GET /api/inbox?filter=inbox_pending` for retrieving inbox entries that have not yet been queued for processing. (`48e04e2`)
- **Upload file type restriction**: Frontend `<input accept=".pdf,.txt,.md">` + backend MIME type validation (`application/pdf`, `text/plain`, `text/markdown`). Illegal types are rejected with `415 Unsupported Media Type`. (`c0b8dea`)
- **Upload duplicate detection**: `POST /api/upload` returns `skipped: true` when a file with the same hash already exists in the attachments directory, avoiding duplicate storage. (`0d02010`)
- **Notes panel SSE real-time refresh**: `NotesPanel` switched from 3-second polling to listening on `/api/events` SSE; the list auto-reloads when notes change. (`d77902e`)
- **Panel activation auto-refresh**: `InboxPanel`, `TasksPanel`, and `RSSPanel` trigger data refresh when activated via `TabShell` tab switching. (`040f34d`)
- **ChatPanel overhaul**: Rebuilt with conversation list sidebar, Markdown rendering (`react-markdown` + `remark-gfm`), auto-scroll to bottom, knowledge source badges, and a "New Conversation" button. (`1b95a91`)
- **Chat retrieval source display**: LLM responses return retrieval source metadata via SSE `data:` events (`{ type: 'sources', notes: [...] }`). `ChatPanel` parses `useChat`'s `data` array and renders clickable knowledge badges below assistant messages. (`32f3504`)
- **Test coverage expansion**:
  - Unit tests: `lib/events.ts` (4 tests), `lib/search/inverted-index.ts` (extended), `lib/cognition/ingest.ts` (LLM JSON fallback + `validateLLMOutput` boundary cases).
  - API route tests: `/api/events`, `/api/rss/subscriptions/check`, `/api/rss/import-opml`.
  - E2E tests: `sidebar.spec.ts` (badge), `notes.spec.ts` (search), plus extensive coverage for `chat.spec.ts`, `ingest.spec.ts`, `rss.spec.ts`, `tasks.spec.ts`, `upload.spec.ts`.
- **Backlinks test coverage**: 14 new tests across `lib/__tests__/parsers.test.ts`, `lib/__tests__/inverted-index.test.ts`, `lib/__tests__/storage.test.ts`, and `app/api/notes/__tests__/route.test.ts` covering parsing, indexing, auto-build, rebuild, fuzzy match, and UI interaction. (`f4752ef`, `515a976`, `8032b4a`)
- **Search cache tests**: `lib/search/__tests__/cache.test.ts` covers TTL expiration, concurrent deduplication, and `__resetSearchCache()` test isolation. (`601fd9e`)
- **Chat tool call UI indicator** (`components/ChatPanel.tsx`): During loading, if a `tool_call` SSE event is received, a "🌐 已抓取网页: [URL]" badge appears above the "思考中..." spinner. (`e7da66e`)

### Changed

- **TabShell rendering strategy**: Switched from conditional rendering (`{tab === 'x' && <Panel />}`) to CSS `hidden` (`className={tab === 'x' ? '' : 'hidden'}`). All panels remain mounted, preserving component state (especially chat sessions) across tab switches. (`040f34d`)
- **Task badge location**: Moved from the Inbox panel to the Tasks panel sidebar icon, reducing visual clutter. (`48e04e2`)
- **Search barrel file removed**: Deleted `lib/search/index.ts`; imports now go directly to `lib/search/inverted-index.ts`, eliminating circular-dependency risk. (`709d1ed`)
- **parseInboxEntry extraction**: Moved `parseInboxEntry` from `lib/storage.ts` to `lib/parsers.ts`. `writeInbox` now returns `boolean` indicating whether a write actually occurred (`false` when skipping duplicates). (`242e7ab`)
- **RSS subscription check parallelization**: `checkAllFeeds()` now executes subscription checks in parallel, reducing batch refresh latency. (`da54cb0`)
- **RSS OPML strict validation**: `parseOPML` now throws descriptive errors for invalid or empty OPML instead of failing silently. (`da54cb0`)
- **Test counts**: 307 Vitest unit tests (+128), 50 Playwright E2E tests (+22).

### Added

- **RSS fetch queued**: RSS fetching is now asynchronous via the task queue instead of blocking the HTTP request.
  - `lib/queue.ts`: Added `rss_fetch` task type and `runRSSFetchTask()` handler. Subscription checks use `checkFeed()`; manual fetches use `fetchRSS()` + `ingestRSSItems()`.
  - `app/api/rss/route.ts`: Returns `202 Accepted` with `taskId` immediately.
  - `app/api/rss/subscriptions/check/route.ts`: Enqueues one `rss_fetch` task per subscription (or per URL if specified).
  - `lib/rss/cron.ts`: Cron job now enqueues tasks instead of directly calling `checkAllFeeds()`.

- **Task retry for failed ingest tasks**: Users can now manually retry failed tasks from the Tasks panel.
  - `lib/queue.ts`: Added `retryTask(id)` which resets a failed task to `pending`, clears error/result/completedAt, re-queues it, and triggers the worker.
  - `app/api/tasks/route.ts`: Added `POST` handler supporting `action: 'retry'`.
  - `components/TasksPanel.tsx`: Added "重试" button on failed task cards with loading state (`RotateCcw` icon + `retryingId` tracking).
  - `lib/__tests__/queue.test.ts`: 3 tests for retryTask behavior.
  - `app/api/tasks/__tests__/route.test.ts`: 3 tests for POST retry endpoint.

- **Chat KB Search (RAG)**: Keyword-based structured retrieval system with Zone-weighted scoring.
  - `lib/search/inverted-index.ts`: Inverted index builder with Chinese/English mixed tokenization, stop-word filtering, and all-length Chinese substring expansion.
  - `lib/search/engine.ts`: Search engine with OR-semantics query, Zone scoring (tag 3.0 > qa 2.5 > title 2.0 > summary 1.8 > keyFact/link 1.5 > content 0.8), and 1-hop link diffusion (0.3 decay).
  - `lib/search/eval.ts`: Quantified evaluation framework with SuccessRate@5, AvgPrecision@5, FalsePositiveRate, per-category metrics, quality gates, and error-report generation.
  - `lib/search/__tests__/`: 54 tests including inverted-index correctness, zone-scoring logic, boolean-query behavior, and golden-dataset quality assessment (10 test cases, all passing gates: success≥90%, precision≥70%, FP≤10%).
  - `app/api/chat/route.ts`: Integrates retrieval into chat — loads/builds search index, executes query against notes, assembles structured context into dynamic system prompt.
  - `lib/storage.ts`: `saveNote()` and `deleteNote()` now auto-update `knowledge/meta/search-index.json` incrementally.

## 2026-04-26

### Security

- Upgrade to Next.js 16.2.4 + React 19.2.5 to address multiple CVEs in the legacy 14.x line (CVE-2025-55184, CVE-2025-29927, CVE-2025-32421).

### Fixed

- **Inbox process API**: `POST /api/inbox/process` was calling `archiveInbox()` *before* `enqueue()`, causing the worker to fail with `ENOENT` when it tried to read the file from `knowledge/inbox/`. The file had already been moved to `knowledge/archive/inbox/`. Removed the premature archive; worker now handles archiving after successful processing. (`3634ff1`)
- **RSS duplicate ingestion**: Same articles were being ingested repeatedly (e.g. one article appeared 21+ times in `archive/inbox`). Fixed with three layers of defense:
  - `fetchRSS` now returns items sorted by `pubDate` descending.
  - `processFeedItems` uses `Date` object comparison instead of string comparison for `lastPubDate`.
  - Both `processFeedItems` and `writeInbox` now check for existing `rss_link` before writing, skipping duplicates with a log message. (`bdc9cb1`)
- **AGENTS.md inaccuracies**: Added missing `app/api/tasks/` and `app/api/notes/[id]/` to directory tree; corrected AI stream description (`@ai-sdk/openai` installed but unused); added missing test file examples; clarified Git integration is currently non-functional due to `.gitignore`. (`70482ad`)

### Added

- **E2E test coverage**: Expanded from 6 to 20 tests across 7 spec files, covering all user-facing paths:
  - `inbox.spec.ts`: empty state, view detail, archive, approve, badge count updates.
  - `ingest.spec.ts`: text ingestion via UI, link form, tab switching, RSS tab presence.
  - `notes.spec.ts`: empty state, search input, status filter buttons.
  - `tasks.spec.ts`: panel load, status filters, task display after queue.
- **`e2e/fixtures.ts`**: Custom Playwright fixture that intercepts `fonts.googleapis.com` and `fonts.gstatic.com` requests. Prevents `page.goto` timeout in headless Chromium caused by Google Fonts `@import` blocking the `load` event.

### Changed

- **Framework**: Next.js 14.2.0 → 16.2.4, React 18.2.0 → 19.2.5.
- **Font loading**: Replace `next/font/google` with CSS `@import` to work around Next.js 16.2.x Turbopack regression (vercel/next.js#92671).
- **Build tool**: Turbopack is now the default bundler in Next.js 16.
- **Playwright config**: Set `workers: 1` to prevent cross-test data pollution when multiple spec files run concurrently. Each spec file uses `test.describe.serial` with `beforeEach` cleanup.
- **Test count**: 86 → 92 Vitest unit tests (+4 for `sortRSSItems`, +2 for inbox sorting, +2 for queue test isolation); 6 → 20 Playwright E2E tests (+14).
- **Hardcoded storage paths**: `lib/storage.ts`, `lib/queue.ts`, `lib/rss/manager.ts`, and `app/api/upload/route.ts` now read `process.env.KNOWLEDGE_ROOT` instead of hardcoded `knowledge/` paths, making the storage layer configurable for test environments. (`f9a01ca`)
- **RSS lastPubDate string comparison bug**: `processFeedItems` used string comparison (`itemPubDate > latestPubDate`) to update the watermark. When RSS sources returned dates in different formats (e.g. RFC 822 vs ISO 8601), this produced incorrect ordering, causing `lastPubDate` to lag behind and the same articles to be re-ingested on every check. Fixed by introducing `normalizePubDate()` (always ISO) and `isNewerPubDate()` (Date timestamp comparison). `latestPubDate` now updates for all valid items regardless of whether they are written to inbox.

### Added

- **E2E test data isolation**: E2E tests use a dedicated `knowledge-test/` directory via `KNOWLEDGE_ROOT=knowledge-test` injected by `playwright.config.ts`. `e2e/fixtures.ts` provides `resetTestData()` to clear the directory before each test. Both `knowledge/` and `knowledge-test/` are `.gitignore`d.
- **Server Component migration**: `app/page.tsx` is now a Server Component. Tab state and polling logic moved to `components/TabShell.tsx` (Client Component). `NotesPanel` is now a Server Component that fetches notes on the server via `FileSystemStorage.listNotes()`, passing initial data to `NotesPanelClient` (Client Component) for interactivity.
- **Queue test isolation**: `lib/queue.ts` now uses dynamic `getKnowledgeRoot()` and `getQueuePath()` functions instead of module-level constants. `lib/__tests__/queue.test.ts` creates a temporary directory and sets `KNOWLEDGE_ROOT` before module load, ensuring queue state never touches production `knowledge/` during tests.

## 2025-04-25

### Added

- **Task queue visibility**: New `TasksPanel` component polls `/api/tasks` every 3s, with status filtering (all/pending/running/done/failed).
- **Queue persistence**: `lib/queue.ts` now persists state to `knowledge/meta/queue.json` via atomic writes (tmp+rename). Pending tasks survive process restarts and auto-restart the worker.
- **Task count badge**: Sidebar shows orange badge when inbox is empty but tasks are pending.
- **Inbox processing indicator**: `InboxPanel` footer shows "processing N items" when tasks are active.
- **Tasks API**: `GET /api/tasks?filter=pending` returns queue state.

### Changed

- **Web scraping**: Unified to Playwright (Chromium headless) + Readability + JSDOM. Replaces the previous `fetch`-based approach which could not extract content from client-side rendered pages.
- **Web fetch timeout**: 8s → 20s (`networkidle` wait mode).
- **RSS incremental update**: Replace `rss-seen.yml` with `lastPubDate` per subscription in `rss-sources.yml`. First check limits to 5 items.

### Fixed

- **RSS race condition**: `processingFeeds` Set lock prevents concurrent duplicate writes during `ingestFeedItems`.
- **Note source deduplication**: `queue.ts` worker checks existing `note.sources` for duplicate URLs before LLM processing.
- **Tag deduplication**: `ingest.ts` uses `Array.from(new Set(...))` + prompt instruction.
- **InboxPanel UX**: Loading spinner per item, anti-double-click (`processedFiles` Set), auto-select next after approve/reject.
- **RSS pubDate display**: `extractedAt` now uses RSS `pubDate`; UI shows `rss_pubDate` first.

## 2025-04-24

### Added

- **Project scaffolding**: Next.js App Router + React + TypeScript 5 + Tailwind CSS.
- **AI Chat**: Streaming chat with MiniMax API (`MiniMax-M2.7`) via `ai` SDK.
- **Inbox (human-in-the-loop)**: Raw content lands in `knowledge/inbox/`, user approves/rejects before LLM processing.
- **Structured notes**: LLM extracts tags, summary, keyFacts, timeline, links, QAs into Markdown + YAML frontmatter. Stored in `knowledge/notes/`.
- **Notes panel**: Browse, search, filter by status (seed/growing/evergreen/stale), view detail with Markdown rendering.
- **Note deletion**: `DELETE /api/notes/[id]` cleans inverted index + moves to archive.
- **RSS subscriptions**: Full CRUD + OPML import + auto-check cron (`node-cron`, every 60min).
- **File upload**: PDF/TXT/MD upload to `knowledge/attachments/`, timestamp-prefixed to avoid collisions.
- **Web ingestion**: Manual URL ingestion via `POST /api/ingest`.
- **Search API**: `POST /api/search` (Serper.dev backend, currently no frontend caller).
- **FileSystemStorage**: Atomic writes, note CRUD, index management, git commit integration.
- **Inverted index**: Tag-based index in `knowledge/meta/inverted-index.md`.
- **Tests**: 86 Vitest unit tests + 6 Playwright E2E tests, coverage thresholds (lines ≥80%, functions ≥80%, branches ≥70%).
- **Theme**: Dark "knowledge sanctuary" theme with Cormorant Garamond + JetBrains Mono.
- **Documentation**: `AGENTS.md`, `README.md`, `.env.example`.
