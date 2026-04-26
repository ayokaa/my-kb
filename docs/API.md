# API Reference

All API routes use standard Web API signatures (`export async function GET(req: Request)`) and return `Response.json(...)`. Errors follow the shape `{ error: string }` with appropriate HTTP status codes.

---

## Chat

### `POST /api/chat`

Stream a chat completion from MiniMax API.

**Request body:**
```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ]
}
```

**Response:** `text/event-stream` (SSE) via `ai` SDK `streamText`.

**Error:** `500` if MiniMax API fails.

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

Manually ingest content into the inbox.

**Request body:**
```json
{
  "type": "text" | "link",
  "content": "raw text content",
  "title": "optional title",
  "url": "https://example.com"
}
```

For `type: "link"`, the server fetches the original article via Playwright + Readability and writes the enriched content to the inbox.

**Response:** `{ "ok": true, "fileName": "123-hello.md" }`

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

## Search

### `POST /api/search`

Search the web and ingest results into the inbox. Requires `SEARCH_API_KEY` env var.

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
      "type": "ingest" | "rss_fetch",
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

Upload a file (PDF, TXT, MD). File is saved to `knowledge/attachments/` with a timestamp prefix, then written to the inbox.

**Request:** `multipart/form-data` with `file` field.

**Response:** `{ "ok": true, "fileName": "20250425-abc.pdf" }`
