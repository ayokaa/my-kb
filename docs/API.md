# API Reference

All API routes use standard Web API signatures (`export async function GET(req: Request)`) and return `Response.json(...)`. Errors follow the shape `{ error: string }` with appropriate HTTP status codes.

---

## Chat

### `POST /api/chat`

Stream a chat completion from MiniMax API with RAG retrieval and optional `web_fetch` tool calling.

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

**Tool calling flow:**
1. The server searches the knowledge base and assembles a context string.
2. A non-streaming LLM call (`stream: false`) determines whether the LLM wants to invoke tools.
3. If `web_fetch` is called, the server executes `fetchWebContent(url)` (Camoufox + trafilatura) and injects the extracted content into the conversation.
4. A second streaming LLM call produces the final response.

**Error:** `500` if MiniMax API fails.

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
      "filePath": "..."
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

## Notes

### `GET /api/notes`

List all notes.

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
    "model": "MiniMax-M2.7",
    "apiKey": "sk-...xxxx",
    "baseUrl": "https://api.minimaxi.com/v1"
  },
  "cron": {
    "rssIntervalMinutes": 60,
    "relinkCronExpression": "0 3 * * *"
  }
}
```

### `POST /api/settings`

Update runtime settings. Changes are persisted to `knowledge/meta/settings.yml` and take effect immediately (cron jobs are restarted if interval/expression changed).

**Request body:**
```json
{
  "llm": {
    "model": "MiniMax-M2.7",
    "apiKey": "sk-xxxxxxxx",
    "baseUrl": "https://api.minimaxi.com/v1"
  },
  "cron": {
    "rssIntervalMinutes": 60,
    "relinkCronExpression": "0 3 * * *"
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
      "type": "ingest" | "rss_fetch" | "web_fetch" | "relink",
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
