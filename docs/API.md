# API Reference

All API routes use standard Web API signatures (`export async function GET(req: Request)`) and return `Response.json(...)`. Errors follow the shape `{ error: string }` with appropriate HTTP status codes.

---

## Chat

### `POST /api/chat`

Stream a chat completion via Anthropic Messages API with RAG retrieval and optional `web_fetch` tool calling.

**Security:** `web_fetch` URLs are validated to reject non-HTTP/HTTPS schemes and private/internal addresses (localhost, RFC 1918 ranges). A single request is limited to at most 3 tool calls.

**Request body:**
```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ]
}
```

**Response:** `text/plain` stream (SSE via `ai` SDK `formatStreamPart`).

The stream emits three kinds of events:

1. **Text chunks** (`formatStreamPart('text', ...)`): The LLM's response content, streamed token-by-token. `<think>...</think>` blocks are filtered server-side.

2. **Source metadata** (`formatStreamPart('data', [{ type: 'sources', notes: [...] }])`): Sent at the start of the stream when relevant knowledge base notes are found. Each note contains `id`, `title`, and `score`. The frontend renders these as clickable knowledge badges.

3. **Tool call events** (`formatStreamPart('data', [{ type: 'tool_call', name: 'web_fetch', url: '...' }])`): Sent when the LLM invoked the `web_fetch` tool to scrape a web page. The frontend displays a "已抓取网页" indicator during loading.

**Tool calling flow (Agent Loop):**
1. The server searches the knowledge base and assembles a context string.
2. A single streaming LLM call (`stream: true`) with tools is issued.
3. If `web_fetch` tool calls are detected mid-stream, the server pauses text output, executes `fetchWebContent(url)` (Camoufox + trafilatura) for up to 3 calls, and appends the results as `tool_result` content blocks.
4. The conversation continues with a second streaming LLM call that includes the tool results, producing the final response.
5. Maximum 2 rounds to prevent infinite loops.

**Error:** `500` if LLM API fails.

---

## Conversations

### `GET /api/conversations`

List all conversations, sorted by `updatedAt` descending.

**Response:**
```json
{
  "conversations": [
    {
      "id": "conv-1234567890-abc123",
      "date": "2026-04-27T12:00:00.000Z",
      "title": "对话标题",
      "topics": ["对话标题"],
      "status": "open",
      "updatedAt": "2026-04-27T12:00:00.000Z",
      "turnCount": 5
    }
  ]
}
```

### `POST /api/conversations`

Create a new conversation.

**Request body:** `{ "title": "optional title" }`

**Response:** `{ "ok": true, "conversation": { ... } }`

---

## Conversation Detail

### `GET /api/conversations/[id]`

Load a single conversation with its message history.

**Response:**
```json
{
  "id": "conv-...",
  "title": "...",
  "messages": [
    { "id": "turn-0", "role": "user", "content": "...", "createdAt": "..." },
    { "id": "turn-1", "role": "assistant", "content": "...", "createdAt": "..." }
  ]
}
```

**Error:** `404` if conversation does not exist.

### `POST /api/conversations/[id]`

Save (or create) a conversation's message history.

**Request body:** `{ "messages": [{ "role": "user", "content": "...", "createdAt": "..." }] }`

**Response:** `{ "ok": true }`

If the conversation does not exist, it is created automatically.

### `DELETE /api/conversations/[id]`

Delete a conversation.

**Response:** `{ "ok": true }`

---

## Events (SSE)

### `GET /api/events`

Server-Sent Events stream for real-time server-to-client push notifications.

**Response:** `text/event-stream`

The stream emits `note:changed` events whenever a note is saved or deleted, driving real-time UI refreshes in `NotesPanel`, `InboxPanel`, `TasksPanel`, and `RSSPanel`.

---

## Inbox

### `GET /api/inbox`

List visible inbox entries (excludes files currently being processed by the task queue).

**Response:**
```json
{
  "entries": [
    {
      "sourceType": "web",
      "title": "...",
      "content": "...",
      "rawMetadata": { "source_url": "..." },
      "filePath": "...",
      "digest": "AI 生成的中文摘要（仅当 autoDigest 启用且摘要已生成时存在）",
      "digestGeneratedAt": "2026-05-06T12:00:00.000Z"
    }
  ]
}
```

### `POST /api/inbox/process`

Approve an inbox entry and enqueue it for LLM processing.

**Request body:**
```json
{ "fileName": "123-hello.md" }
```

**Response:** `{ "ok": true, "taskId": "task-..." }`

The file is immediately archived from the inbox listing to prevent double-clicks.

### `POST /api/inbox/archive`

Manually archive an inbox entry (reject without processing).

**Request body:**
```json
{ "fileName": "123-hello.md" }
```

**Response:** `{ "ok": true, "message": "已归档" }`

---

## Ingest

### `POST /api/ingest`

Manually ingest content into the knowledge base. Text and link ingest no longer goes through the inbox; they are enqueued as tasks and processed asynchronously by the worker.

**Request body:**
```json
{
  "type": "text" | "link",
  "content": "raw text content",
  "title": "optional title",
  "url": "https://example.com"
}
```

For `type: "link"`, the server enqueues a `web_fetch` task that uses Camoufox + trafilatura to scrape the article and then calls the LLM to generate a structured note directly.

**Response:**
- For `type: "text"`: `200 OK`
  ```json
  { "ok": true, "taskId": "task-...", "message": "已加入处理队列" }
  ```
- For `type: "link"`: `202 Accepted`
  ```json
  { "ok": true, "taskId": "task-...", "message": "已加入抓取队列" }
  ```

---

## Memory

### `GET /api/memory`

Return the current user memory model.

**Response:**
```json
{
  "profile": {
    "role": "...",
    "interests": ["..."],
    "background": "...",
    "updatedAt": "2026-05-03T00:00:00.000Z"
  },
  "noteKnowledge": {
    "rag-overview": {
      "level": "discussed",
      "firstSeenAt": "...",
      "lastReferencedAt": "...",
      "notes": "..."
    }
  },
  "conversationDigest": "LLM-synthesized summary of recent discussions",
  "recentDigests": [
    "2026-05-05 | Discussed React 19 features",
    "2026-05-04 | Explored RAG optimization techniques"
  ],
  "preferences": {
    "detailLevel": "concise"
  },
  "updatedAt": "2026-05-03T00:00:00.000Z"
}
```

---

### `POST /api/memory`

Update the user memory model.

**Request body:**
```json
{
  "action": "updateProfile",
  "profile": {
    "role": "...",
    "background": "...",
    "interests": ["..."]
  }
}
```

**Actions:**

| Action | Required fields | Description |
|--------|-----------------|-------------|
| `updateProfile` | `profile` | Overwrites profile fields. Empty strings clear `role`/`background`. |
| `updatePreference` | `key`, `value` | Sets or updates a preference key. |

**Response:**
```json
{ "ok": true }
```

**Error:** `400` for unknown action or missing required fields.

---

### `DELETE /api/memory`

Delete parts of the user memory model.

**Request body:**
```json
{
  "action": "deleteNoteKnowledge",
  "noteId": "rag-overview"
}
```

**Actions:**

| Action | Required fields | Description |
|--------|-----------------|-------------|
| `deleteNoteKnowledge` | `noteId` | Removes a single note knowledge entry. Triggers `evolveNoteStatuses()` — if the note was `evergreen`/`growing`/`stale`, it reverts to `seed`. |
| `deleteConversationDigest` | — | Clears the entire `conversationDigest` string. |
| `deletePreference` | `key` | Removes a preference key. |
| `clearAll` | — | Resets the entire memory to empty. Triggers `evolveNoteStatuses()` — all notes with knowledge revert to `seed`. |

**Response:**
```json
{ "ok": true }
```

**Error:** `400` for unknown action or missing required fields.

---

### `POST /api/memory/update`

Analyze a conversation and update the user memory model. Called automatically by the chat system after each completed conversation turn.

**Request body:**
```json
{
  "conversationId": "conv-...",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Behavior:**
1. Loads existing memory from `knowledge/meta/user-memory.json` (or empty memory if not exists).
2. Loads settings to get `memory.taskIntervalMs` (default 30000ms).
3. Runs 4 independent LLM extraction tasks **serially** with `taskIntervalMs` sleep between each:
   - `profile` — extracts `role`, `interests`, `background` (explicit statements only)
   - `noteFamiliarity` — observed familiarity level (`aware`/`referenced`/`discussed`) for notes annotated as `ID: xxx` in chat context
   - `digest` — generates `newDigest` (1-2 sentence summary of this conversation)
   - `preference` — extracts explicit preference signals (detail level, code examples, etc.)
   Each task receives the full user profile + known preferences in its prompt header.
4. Merges extracted data into existing memory:
   - `profileChanges`: overwrite scalars, dedup append arrays
   - `noteFamiliarity`: per-note overwrite with `firstSeenAt` preservation
   - `newDigest`: prepend `"YYYY-MM-DD | text"` to `recentDigests`, filter entries older than 7 days
   - `preferenceSignals`: overwrite
   - `recentDiscussion`: overwrites `conversationDigest`
5. If `newDigest` was extracted, schedules a delayed `regenerateRecentDiscussion` task (10-minute debounce). This task reads all `recentDigests` and calls the LLM to synthesize a comprehensive `recentDiscussion` text, which overwrites `conversationDigest`.
5. Persists merged memory atomically (tmp+rename).
6. Triggers `evolveNoteStatuses()` which automatically transitions note statuses based on `noteKnowledge`:
   - `seed` → `growing` when user has referenced the note (`level !== 'aware'`)
   - `growing` → `evergreen` when user has discussed it in depth (`level === 'discussed'`)
   - `evergreen` → `stale` after 30 days without mention (while knowledge still exists)
   - `stale` → `growing` when mentioned again
   - Any status → `seed` when knowledge is removed (via manual deletion or clear)

**Response:**
```json
{ "ok": true }
```

**Error:** `400` if messages array is too short; `500` on LLM or persistence failure.

---

## Notes

### `GET /api/notes`

List all notes. Supports optional server-side full-text search via query parameter.

**Query params:** `?search=关键词` (optional)

When `search` is provided, the endpoint performs two-phase matching:
1. **ripgrep full-text scan**: Scans all note bodies in `knowledge/notes/` for the search term.
2. **Metadata matching**: Also matches against note `title`, `summary`, and `tags` (case-insensitive substring).

Only notes that match at least one phase are returned. When `search` is omitted, all notes are returned sorted by `created` descending.

**Response:**
```json
{
  "notes": [
    {
      "id": "ai-agents-in-zed",
      "title": "AI Agents in Zed",
      "tags": ["ai", "zed"],
      "status": "seed",
      "summary": "...",
      "content": "..."
    }
  ]
}
```

### `GET /api/notes/[id]`

Load a single note by ID.

**Response:** `{ "note": { ... } }`

**Error:** `404` if note does not exist.

### `DELETE /api/notes/[id]`

Delete a note. The note is moved to `knowledge/archive/` and the inverted index is cleaned.

**Response:** `{ "ok": true }`

**Error:** `500` on failure.

---

## RSS

### `POST /api/rss`

Queue an RSS fetch task. The fetch and ingest happen asynchronously in the background worker.

**Request body:**
```json
{
  "url": "https://overreacted.io/rss.xml",
  "name": "Overreacted",
  "maxItems": 5
}
```

**Response:** `202 Accepted`
```json
{ "ok": true, "taskId": "task-...", "message": "RSS fetch queued" }
```

---

## RSS Subscriptions

### `GET /api/rss/subscriptions`

List all subscriptions.

**Response:**
```json
{
  "subscriptions": [
    {
      "url": "...",
      "name": "...",
      "addedAt": "...",
      "lastPubDate": "..."
    }
  ]
}
```

### `POST /api/rss/subscriptions`

Add a subscription.

**Request body:** `{ "url": "...", "name": "..." }`

**Response:** `{ "ok": true }`

### `DELETE /api/rss/subscriptions`

Remove a subscription.

**Request body:** `{ "url": "..." }`

**Response:** `{ "ok": true }`

---

## RSS Subscriptions — Check

### `POST /api/rss/subscriptions/check`

Manually trigger RSS check. Enqueues one `rss_fetch` task per subscription (or per URL if specified).

**Request body:** `{ "url": "..." }` (optional)

**Response:**
```json
{ "ok": true, "queued": 3, "taskIds": ["task-...", "task-...", "task-..."] }
```

---

## RSS Subscriptions — OPML Import

### `POST /api/rss/subscriptions/import-opml`

Import subscriptions from OPML XML.

**Request body:** `{ "xml": "<opml>...</opml>" }`

**Response:** `{ "ok": true, "added": 3, "skipped": 0 }`

---

## Settings

### `GET /api/settings`

Load runtime settings. The API key is masked (`sk-...xxxx`) for security.

**Response:**
```json
{
  "llm": {
    "model": "claude-3-5-sonnet-20241022",
    "apiKey": "sk-...xxxx",
    "baseUrl": "https://api.minimaxi.com/anthropic"
  },
  "cron": {
    "rssIntervalMinutes": 60,
    "relinkCronExpression": "0 3 * * *"
  },
  "digest": {
    "autoDigest": true
  }
}
```

### `POST /api/settings`

Update runtime settings. Changes are persisted to `knowledge/meta/settings.yml` and take effect immediately (cron jobs are restarted if interval/expression changed).

**Request body:**
```json
{
  "llm": {
    "model": "claude-3-5-sonnet-20241022",
    "apiKey": "sk-xxxxxxxx",
    "baseUrl": "https://api.minimaxi.com/anthropic"
  },
  "cron": {
    "rssIntervalMinutes": 60,
    "relinkCronExpression": "0 3 * * *"
  },
  "digest": {
    "autoDigest": true
  }
}
```

**Validation:** Returns `400` if `relinkCronExpression` is invalid or `rssIntervalMinutes` is not a positive number.

**Response:** `{ "success": true }`

---

## Search

### `POST /api/search`

Search the web and ingest results. Requires `SEARCH_API_KEY` env var.

**Request body:** `{ "query": "prompt caching", "maxResults": 3 }`

**Response:** `{ "ok": true, "entries": [{ "title": "...", "url": "..." }] }`

**Note:** Currently no frontend component calls this endpoint.

---

## Tasks

### `GET /api/tasks`

List tasks.

**Query params:** `?filter=pending` (optional)

**Response:**
```json
{
  "tasks": [
    {
      "id": "task-...",
      "type": "ingest" | "rss_fetch" | "web_fetch" | "relink" | "inbox_digest",
      "status": "pending" | "running" | "done" | "failed",
      "createdAt": "...",
      "startedAt": "...",
      "completedAt": "...",
      "error": "...",
      "result": { "skipped": true, "reason": "duplicate source" }
    }
  ]
}
```

### `POST /api/tasks`

Retry a failed task.

**Request body:**
```json
{ "id": "task-...", "action": "retry" }
```

**Response:** `{ "task": { ... } }`

**Error:** `400` if task is not found or not in `failed` status.

---

## Upload

### `POST /api/upload`

Upload a file (PDF, TXT, MD). File is saved to `knowledge/attachments/` with a timestamp prefix, then enqueued as an `ingest` task for LLM processing.

**Request:** `multipart/form-data` with `file` field.

**Response:** `{ "ok": true, "fileName": "20250425-abc.pdf", "title": "...", "taskId": "task-...", "message": "已加入处理队列" }`
