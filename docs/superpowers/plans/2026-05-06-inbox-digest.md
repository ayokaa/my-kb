# Inbox Digest 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 RSS 收件箱条目自动生成 LLM 摘要，帮助用户快速审批。

**Architecture:** 新增 `inbox_digest` 任务类型到现有队列系统，worker 调用 `fetchWebContent` 抓取原文后通过 LLM 生成简短摘要，写入收件箱 `.md` 文件的 frontmatter。前端在条目详情中展示摘要卡片。

**Tech Stack:** Next.js App Router, TypeScript, js-yaml, @anthropic-ai/sdk

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `lib/types.ts` | `InboxEntry` 接口定义，新增 `digest`/`digestGeneratedAt` |
| `lib/parsers.ts` | `parseInboxEntry()` 解析新增字段 |
| `lib/storage.ts` | `writeInbox()` 序列化新字段；新增 `updateInboxDigest()` |
| `lib/cognition/ingest.ts` | 导出 `fetchFullContent()`；新增 `generateDigest()` |
| `lib/queue.ts` | 新增 `inbox_digest` 任务类型 + `InboxDigestPayload` + worker |
| `lib/settings.ts` | `RuntimeSettings` 新增 `autoDigest` |
| `lib/rss/manager.ts` | `processFeedItems()` 写入收件箱后触发 digest 任务 |
| `app/api/settings/route.ts` | POST 处理 `autoDigest` 字段 |
| `components/InboxPanel.tsx` | 条目详情展示摘要卡片 |
| `components/SettingsPanel.tsx` | 新增 autoDigest 开关 |

---

## Task 1: 数据模型与解析层

**Files:**
- Modify: `lib/types.ts:79-87`
- Modify: `lib/parsers.ts:5-48`

- [ ] **Step 1: 更新 InboxEntry 接口**

在 `lib/types.ts` 的 `InboxEntry` 接口中新增两个字段：

```typescript
export interface InboxEntry {
  sourceType: SourceType;
  sourcePath?: string;
  title: string;
  content: string;
  extractedAt?: string;
  rawMetadata: Record<string, unknown>;
  filePath?: string;
  digest?: string;              // 新增：AI 摘要
  digestGeneratedAt?: string;   // 新增：摘要生成时间
}
```

- [ ] **Step 2: 更新 parseInboxEntry 解析**

在 `lib/parsers.ts` 的 `parseInboxEntry()` 中：

1. 将 `'digest'` 和 `'digest_generated_at'` 加入 `known` Set（第 33 行）
2. 在返回对象中新增两个字段：

```typescript
const known = new Set(['source_type', 'source_path', 'title', 'extracted_at', 'digest', 'digest_generated_at']);

// ...

return {
  sourceType: ((fm.source_type as string) || 'text') as SourceType,
  sourcePath: fm.source_path as string | undefined,
  title: (fm.title as string) || basename(path, '.md'),
  content,
  extractedAt: fm.extracted_at as string | undefined,
  rawMetadata,
  filePath: path,
  digest: fm.digest as string | undefined,                        // 新增
  digestGeneratedAt: fm.digest_generated_at as string | undefined, // 新增
};
```

- [ ] **Step 3: 提交**

```bash
git add lib/types.ts lib/parsers.ts
git commit -m "feat(digest): add digest fields to InboxEntry type and parser"
```

---

## Task 2: 存储层 — updateInboxDigest

**Files:**
- Modify: `lib/storage.ts`

- [ ] **Step 1: 在 FileSystemStorage 中新增 updateInboxDigest 方法**

在 `archiveInbox()` 方法（第 488-499 行）之后添加：

```typescript
/** Append digest to an inbox file's frontmatter without modifying the body content. */
async updateInboxDigest(fileName: string, digest: string): Promise<void> {
  const path = this.inboxPath(fileName);
  const raw = await readFile(path, 'utf-8');

  if (!raw.startsWith('---')) {
    throw new Error(`Invalid inbox file format: ${fileName}`);
  }

  const endMarker = raw.indexOf('\n---', 3);
  if (endMarker === -1) {
    throw new Error(`Unclosed frontmatter in inbox file: ${fileName}`);
  }

  const fmRaw = raw.slice(3, endMarker).trim();
  const fm = yaml.load(fmRaw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;

  fm.digest = digest;
  fm.digest_generated_at = new Date().toISOString();

  const body = raw.slice(endMarker + 4);
  const updated = `---\n${yaml.dump(fm, { allowUnicode: true } as import('./types').YamlDumpOptions)}---${body}`;

  await this.atomicWrite(path, updated);
}
```

注意：不要在末尾加 `body.startsWith('\n') ? body : '\n' + body`，因为原始文件 body 已经带了换行前缀（`raw.slice(endMarker + 4)` 包含了 `\n`）。

- [ ] **Step 2: 提交**

```bash
git add lib/storage.ts
git commit -m "feat(digest): add updateInboxDigest to FileSystemStorage"
```

---

## Task 3: LLM 摘要生成函数

**Files:**
- Modify: `lib/cognition/ingest.ts:242-254`

- [ ] **Step 1: 导出 fetchFullContent**

将 `enrichContent`（第 242-254 行）重命名并导出为 `fetchFullContent`：

```typescript
/** Fetch full content from the original URL if available, otherwise return existing content. */
export async function fetchFullContent(entry: InboxEntry): Promise<string> {
  let content = entry.content;
  const originalUrl = (entry.rawMetadata?.rss_link || entry.rawMetadata?.source_url) as string | undefined;
  if (originalUrl) {
    try {
      const webContent = await fetchWebContent(originalUrl);
      content = webContent.content || entry.content;
    } catch (err) {
      logger.warn('Ingest', `Failed to fetch original content from ${originalUrl}: ${(err as Error).message}`);
    }
  }
  return content;
}
```

然后更新 `processInboxEntry`（第 372 行）中的调用：

```typescript
const content = await fetchFullContent(entry);
```

- [ ] **Step 2: 新增 generateDigest 函数**

在 `fetchFullContent` 之后添加：

```typescript
const DIGEST_SYSTEM_PROMPT = `你是一位专业的内容摘要助手。你的任务是为技术、科学和知识类文章生成准确、信息密度高的中文摘要。

摘要必须包含以下信息：
1. 这篇文章的核心主题是什么（一句话）
2. 文章在讨论或解决什么具体问题
3. 关键结论、发现或观点（如果文章有明确结论）

要求：
- 用简洁清晰的中文撰写
- 不要使用"本文"、"该文"等元指代，直接描述内容
- 长度控制在 3-5 句话
- 保持客观，不加个人评价
- 如果文章包含技术细节，简要提及技术方向但不展开
- 只输出摘要文本，不要加标题、标签或任何额外格式`;

/** Generate a short Chinese summary for an inbox entry. */
export async function generateDigest(title: string, content: string): Promise<string> {
  const userPrompt = `标题：${title}\n\n${content.slice(0, 20000)}`;
  return callLLM(DIGEST_SYSTEM_PROMPT, userPrompt);
}
```

- [ ] **Step 3: 提交**

```bash
git add lib/cognition/ingest.ts
git commit -m "feat(digest): export fetchFullContent and add generateDigest"
```

---

## Task 4: 设置层 — autoDigest

**Files:**
- Modify: `lib/settings.ts`
- Modify: `app/api/settings/route.ts`

- [ ] **Step 1: 更新 RuntimeSettings**

在 `lib/settings.ts` 中：

1. 新增 `DigestSettings` 接口（在 `MemorySettings` 之后）：

```typescript
export interface DigestSettings {
  autoDigest: boolean;
}
```

2. 将 `DigestSettings` 加入 `RuntimeSettings`：

```typescript
export interface RuntimeSettings {
  llm: LLMSettings;
  cron: CronSettings;
  memory: MemorySettings;
  digest: DigestSettings;
}
```

3. 在 `DEFAULT_SETTINGS` 中新增默认值：

```typescript
const DEFAULT_SETTINGS: RuntimeSettings = {
  // ...existing...
  digest: {
    autoDigest: true,
  },
};
```

4. 在 `envOverride()` 中增加 digest 部分（目前没有环境变量覆盖需求，直接透传）：

```typescript
digest: {
  autoDigest: settings.digest?.autoDigest ?? DEFAULT_SETTINGS.digest.autoDigest,
},
```

5. 在 `loadSettings()` 的 `merged` 对象中新增：

```typescript
digest: {
  autoDigest: parsed.digest?.autoDigest ?? DEFAULT_SETTINGS.digest.autoDigest,
},
```

- [ ] **Step 2: 更新 settings API 路由**

在 `app/api/settings/route.ts` 的 `POST` handler 中，`next` 对象新增：

```typescript
const next: RuntimeSettings = {
  // ...existing...
  digest: {
    autoDigest: body.digest?.autoDigest ?? current.digest.autoDigest,
  },
};
```

- [ ] **Step 3: 提交**

```bash
git add lib/settings.ts app/api/settings/route.ts
git commit -m "feat(digest): add autoDigest setting with API support"
```

---

## Task 5: 队列层 — inbox_digest 任务类型

**Files:**
- Modify: `lib/queue.ts`

- [ ] **Step 1: 新增任务类型和 payload**

在 `lib/queue.ts` 中进行以下修改：

1. `TaskType`（第 18 行）新增 `'inbox_digest'`：

```typescript
export type TaskType = 'ingest' | 'rss_fetch' | 'web_fetch' | 'relink' | 'inbox_digest';
```

2. 新增 payload 接口（在 `RelinkPayload` 之后，第 45 行附近）：

```typescript
export interface InboxDigestPayload {
  fileName: string;
}
```

3. 更新 `TaskPayload` 联合类型（第 47 行）：

```typescript
export type TaskPayload = IngestPayload | RSSFetchPayload | WebFetchPayload | RelinkPayload | InboxDigestPayload;
```

- [ ] **Step 2: 更新队列数据结构**

4. `pendingByType`（第 64 行）新增：

```typescript
const pendingByType: Record<TaskType, string[]> = {
  ingest: [],
  rss_fetch: [],
  web_fetch: [],
  relink: [],
  inbox_digest: [],
};
```

5. `workerRunningByType`（第 70 行）新增：

```typescript
const workerRunningByType: Record<TaskType, boolean> = {
  ingest: false,
  rss_fetch: false,
  web_fetch: false,
  relink: false,
  inbox_digest: false,
};
```

- [ ] **Step 3: 更新持久化和恢复**

6. `saveQueueState()` 中的类型数组（第 143 行）新增 `'inbox_digest'`：

```typescript
pendingIds: (['ingest', 'rss_fetch', 'web_fetch', 'relink', 'inbox_digest'] as TaskType[]).flatMap((t) => pendingByType[t]),
```

7. `loadQueueState()` 中的 pending 统计（第 179 行）新增：

```typescript
const totalPending = pendingByType.ingest.length + pendingByType.rss_fetch.length + pendingByType.web_fetch.length + pendingByType.relink.length + pendingByType.inbox_digest.length;
```

8. `initQueue()` 中的类型数组（第 315 行）新增 `'inbox_digest'`：

```typescript
for (const type of ['ingest', 'rss_fetch', 'web_fetch', 'relink', 'inbox_digest'] as TaskType[]) {
```

- [ ] **Step 4: 新增 worker handler**

9. 在 `startWorker()` 的 task type 分支（第 263-293 行）中，在 `relink` 分支之后新增：

```typescript
} else if (task.type === 'inbox_digest') {
  const result = await runDigestTask(task.payload as InboxDigestPayload);
  task.status = 'done';
  task.result = result;
  logger.info('Queue', `Task ${id} inbox digest completed`);
  emitTaskEvent('completed', id, type, undefined, result);
}
```

10. 在 `runRelinkTask()` 函数之后（第 401 行之后），新增 `runDigestTask` 函数：

```typescript
async function runDigestTask(payload: InboxDigestPayload) {
  const { fileName } = payload;
  const storage = new FileSystemStorage();
  const filePath = join(process.cwd(), getKnowledgeRoot(), 'inbox', fileName);

  // Check file exists (may have been approved/archived)
  try {
    await stat(filePath);
  } catch {
    logger.info('Queue', `Inbox file not found, skipping digest: ${fileName}`);
    return { skipped: true, reason: 'file not found' };
  }

  const raw = await readFile(filePath, 'utf-8');
  const entry = parseInboxEntry(raw, filePath);

  // Idempotency: skip if already digested
  if (entry.digest) {
    logger.info('Queue', `Digest already exists for ${fileName}, skipping`);
    return { skipped: true, reason: 'already digested' };
  }

  // Fetch full content (fallback to existing content)
  let content: string;
  try {
    content = await fetchFullContent(entry);
  } catch {
    content = entry.content;
  }

  // Generate digest via LLM
  const digest = await generateDigest(entry.title, content);

  // Write digest to file (may fail if file was archived during processing)
  try {
    await storage.updateInboxDigest(fileName, digest);
  } catch (err) {
    // Check if file was archived during processing
    try {
      await stat(filePath);
    } catch {
      logger.info('Queue', `Inbox file archived during digest generation, skipping: ${fileName}`);
      return { skipped: true, reason: 'file archived during digest' };
    }
    throw err; // Re-throw if file still exists (real write error)
  }
  emitInboxEvent('new');

  return { ok: true, fileName };
}
```

11. 在文件顶部 import 区域更新（在现有 import 后追加/修改）：

```typescript
import { emitNoteEvent, emitTaskEvent, emitInboxEvent } from './events';
// ...existing imports...
import { fetchFullContent, generateDigest } from './cognition/ingest';
```

注意：`emitInboxEvent` **不在**现有 import 中（第 12 行只有 `emitNoteEvent` 和 `emitTaskEvent`），必须新增。`parseInboxEntry`、`readFile`、`stat` 已在现有 import 中。

- [ ] **Step 5: 提交**

```bash
git add lib/queue.ts
git commit -m "feat(digest): add inbox_digest task type and worker to queue"
```

---

## Task 6: RSS Manager 触发 digest 任务

**Files:**
- Modify: `lib/rss/manager.ts:120-136`

- [ ] **Step 1: 在 processFeedItems 中触发 digest**

1. 在文件顶部 import 区域新增：

```typescript
import { enqueue } from '../queue';
import { loadSettings } from '../settings';
```

2. 修改 `processFeedItems()` 中 `writeInbox` 调用（第 120-135 行），使用 `writeInbox` 的返回值（改为 `string | null`，见 Step 2）作为文件名，并在写入成功后触发 digest：

```typescript
      const writtenFileName = await storage.writeInbox({
        sourceType: 'web',
        title: item.title,
        content: `${item.description || ''}\n\n${item.content || ''}`.trim(),
        extractedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        rawMetadata: {
          rss_source: name || url,
          rss_link: item.link,
          rss_pubDate: item.pubDate,
        },
      });

      // Add to dedup set so we don't write the same link again in this batch
      if (item.link) existingLinks.add(item.link);

      if (writtenFileName) {
        count++;

        // Trigger digest generation if autoDigest is enabled
        try {
          const settings = await loadSettings();
          if (settings.digest?.autoDigest) {
            enqueue('inbox_digest', { fileName: writtenFileName });
          }
        } catch (err) {
          logger.warn('RSS', `Failed to enqueue digest task: ${(err as Error).message}`);
        }
      }
```

- [ ] **Step 2: 更新 writeInbox 返回值**

将 `writeInbox` 从返回 `boolean` 改为返回 `string | null`：

在 `lib/storage.ts` 中：

1. `Storage` 接口（`lib/types.ts:118`）：

```typescript
writeInbox(entry: InboxEntry): Promise<string | null>;
```

2. `FileSystemStorage.writeInbox()` 返回值：
   - 去重跳过：`return null` （原 `return false`）
   - 成功写入：`return fileName` （原 `return true`）

3. 更新 `lib/rss/manager.ts` 中的 `if (written)` 为 `if (writtenFileName)`。

- [ ] **Step 3: 更新其他调用 writeInbox 的地方**

搜索所有 `writeInbox` 调用，将 `if (written)` / `if (await storage.writeInbox(...))` 改为 truthy 检查（`string | null`，string 是 truthy，null 是 falsy），逻辑不变。

特别注意：
- `app/api/search/route.ts` 中 `await storage.writeInbox(...)` 无需改（不使用返回值）
- 测试文件中的 mock 返回值和断言需要同步更新（见 Task 9）

**关于 `listInboxPending()`：** `inbox_digest` 任务类型不需要加入 `listInboxPending()` 的过滤条件。该函数的语义是"影响收件箱审批状态的任务"，digest 只是追加元数据、不影响审批流程。

- [ ] **Step 4: 提交**

```bash
git add lib/storage.ts lib/types.ts lib/rss/manager.ts
git commit -m "feat(digest): trigger inbox_digest on RSS feed item write"
```

---

## Task 7: 前端 — InboxPanel 摘要展示

**Files:**
- Modify: `components/InboxPanel.tsx`

- [ ] **Step 1: 更新 InboxEntry 接口**

在 `InboxPanel.tsx` 的 `InboxEntry` 接口（第 8-15 行）中新增：

```typescript
interface InboxEntry {
  title: string;
  content: string;
  sourceType: string;
  extractedAt?: string;
  rawMetadata: Record<string, unknown>;
  filePath?: string;
  digest?: string;              // 新增
  digestGeneratedAt?: string;   // 新增
}
```

- [ ] **Step 2: 在条目详情中添加摘要卡片**

在 RSS 条目详情区域（第 267-308 行），在"打开原文阅读"链接卡片之后、"Feed 摘要"之前，新增摘要卡片：

```tsx
{/* AI 摘要 */}
{selected.digest && (
  <div className="rounded-xl border border-[var(--accent)]/20 bg-[var(--accent-dim)]/50 px-5 py-4">
    <div className="flex items-center gap-2 mb-2">
      <span className="rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--bg-primary)]">
        AI 摘要
      </span>
    </div>
    <p className="text-sm leading-relaxed text-[var(--text-primary)] break-words">
      {selected.digest}
    </p>
  </div>
)}
```

插入位置：在第 288 行 `</a>` 之后（原文链接卡片关闭标签后），第 290 行 `{selected.content && (` 之前。

- [ ] **Step 3: 提交**

```bash
git add components/InboxPanel.tsx
git commit -m "feat(digest): show AI digest card in inbox entry detail"
```

---

## Task 8: 前端 — SettingsPanel autoDigest 开关

**Files:**
- Modify: `components/SettingsPanel.tsx`

- [ ] **Step 1: 更新 SettingsData 接口**

在 `SettingsData` 接口（第 6-16 行）中新增：

```typescript
interface SettingsData {
  llm: {
    model: string;
    apiKey: string;
    baseUrl: string;
  };
  cron: {
    rssIntervalMinutes: number;
    relinkCronExpression: string;
  };
  digest: {
    autoDigest: boolean;
  };
}
```

- [ ] **Step 2: 添加开关 UI**

在"定时任务" section（第 132-163 行）之后、保存按钮（第 165 行）之前，新增一个 section：

```tsx
<section className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
    收件箱
  </h3>
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm font-medium text-[var(--text-secondary)]">自动生成摘要</p>
      <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">RSS 条目写入收件箱后自动生成 AI 摘要</p>
    </div>
    <button
      type="button"
      onClick={() => setSettings((s) => s ? { ...s, digest: { autoDigest: !s.digest.autoDigest } } : s)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
        settings?.digest?.autoDigest ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
          settings?.digest?.autoDigest ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
</section>
```

- [ ] **Step 3: 提交**

```bash
git add components/SettingsPanel.tsx
git commit -m "feat(digest): add autoDigest toggle in settings panel"
```

---

## 依赖关系

```
Task 1 (types + parser)
  → Task 2 (storage updateInboxDigest)
    → Task 3 (LLM fetchFullContent + generateDigest)
      → Task 5 (queue inbox_digest worker) ← Task 4 (settings)
        → Task 6 (RSS manager trigger)
Task 7 (InboxPanel) ← Task 1
Task 8 (SettingsPanel) ← Task 4
Task 9 (tests) ← Task 6
```

可并行的任务组：
- Task 1 先行
- Task 2, Task 4 可并行（都依赖 Task 1）
- Task 3 依赖 Task 1
- Task 5 依赖 Task 2 + Task 3
- Task 6 依赖 Task 4 + Task 5
- Task 7 依赖 Task 1
- Task 8 依赖 Task 4
- Task 9 在所有实现完成后

---

## Task 9: 更新测试

**Files:**
- Modify: `lib/__tests__/storage.test.ts`
- Modify: `lib/__tests__/queue.test.ts`
- Modify: `lib/rss/__tests__/manager.test.ts`

- [ ] **Step 1: 更新 storage 测试中的 writeInbox 断言**

在 `lib/__tests__/storage.test.ts` 中，所有 `writeInbox` 相关断言：

- `toBe(true)` → 改为断言返回值为字符串（如 `expect(result).toBeTruthy()` 或 `expect(typeof result).toBe('string')`）
- `toBe(false)` → 改为 `toBeNull()`

- [ ] **Step 2: 更新 queue 测试中的 writeInbox mock**

在 `lib/__tests__/queue.test.ts` 中，`writeInbox` 的 mock：

- `mockResolvedValue(undefined)` → `mockResolvedValue('1234567890-test.md')` 或 `mockResolvedValue(null)`（取决于测试意图）
- 检查是否有 `toBe(true)` / `toBe(false)` 断言需要更新

- [ ] **Step 3: 更新 manager 测试中的 writeInbox mock**

在 `lib/rss/__tests__/manager.test.ts` 中，`writeInbox` 的 mock：

- `mockResolvedValue(true)` → `mockResolvedValue('1234567890-test.md')`
- `mockResolvedValue(undefined)` → `mockResolvedValue(null)`
- 检查是否有依赖返回值 `true`/`false` 的断言

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run
```

Expected: All tests pass

- [ ] **Step 5: 提交**

```bash
git add lib/__tests__/storage.test.ts lib/__tests__/queue.test.ts lib/rss/__tests__/manager.test.ts
git commit -m "test(digest): update writeInbox return type in tests"
```
