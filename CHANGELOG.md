# Changelog

All notable changes to this project are documented in this file.

## 2025-04-26

### Security

- Upgrade to Next.js 16.2.4 + React 19.2.5 to address multiple CVEs in the legacy 14.x line (CVE-2025-55184, CVE-2025-29927, CVE-2025-32421).

### Changed

- **Framework**: Next.js 14.2.0 → 16.2.4, React 18.2.0 → 19.2.5.
- **Font loading**: Replace `next/font/google` with CSS `@import` to work around Next.js 16.2.x Turbopack regression (vercel/next.js#92671).
- **Build tool**: Turbopack is now the default bundler in Next.js 16.

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
