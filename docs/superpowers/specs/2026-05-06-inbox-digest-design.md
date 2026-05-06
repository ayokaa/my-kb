# Inbox Digest: RSS 收件箱摘要自动生成

**Date:** 2026-05-06
**Status:** Draft
**Scope:** 收件箱条目新增 AI 摘要功能，帮助用户快速判断内容是否值得审批

---

## 1. 背景与目标

RSS 订阅条目写入收件箱后，用户只能看到 RSS feed 自带的标题和简短描述（通常不完整），需要逐个打开原文才能决定是否审批。这导致审批效率低下。

**目标：** 收件箱条目写入后，异步串行通过 LLM 生成简短中文摘要，追加到收件箱条目中。用户在审批时可以直接阅读摘要，快速判断内容价值。

**非目标：**
- 不替代审批后的完整 ingest 管线（extract、QA、link 生成）
- 不修改现有审批流程
- 不添加复杂的加载态或轮询机制

---

## 2. 数据模型

### 2.1 Frontmatter 新增字段

收件箱 `.md` 文件的 YAML frontmatter 新增两个可选字段：

```yaml
---
source_type: web
title: Article Title
extracted_at: "2025-04-20T12:00:00Z"
rss_source: Feed Name
rss_link: https://article.url
rss_pubDate: "2025-04-20T10:00:00Z"
digest: "这是一篇关于 Rust 异步运行时设计的文章，作者分析了 Tokio 的任务调度策略与 io_uring 集成方案..."
digest_generated_at: "2025-04-20T12:01:00Z"
---

Article content here...
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `digest` | string | 否 | LLM 生成的简短中文摘要 |
| `digest_generated_at` | ISO 8601 string | 否 | 摘要生成完成时间 |

条目写入收件箱时这两个字段不存在，`inbox_digest` worker 完成后追加写入。

### 2.2 TypeScript 接口变更

`InboxEntry`（`lib/types.ts`）新增：

```typescript
export interface InboxEntry {
  // ...existing fields...
  digest?: string;              // 新增：AI 摘要
  digestGeneratedAt?: string;   // 新增：摘要生成时间
}
```

### 2.3 解析与存储层

- `parseInboxEntry()`（`lib/parsers.ts`）：提取 `digest` 和 `digest_generated_at` 字段为一级属性（加入 known fields 集合，不放入 `rawMetadata`）
- `writeInbox()`（`lib/storage.ts`）：序列化时包含这两个字段（如果存在）
- 新增 `updateInboxDigest(fileName, digest)` 辅助函数：读取文件 → 解析 frontmatter → 追加 digest/digest_generated_at → 原子写入，避免破坏正文内容

---

## 3. 队列任务

### 3.1 新增任务类型

`TaskType` 联合类型新增 `'inbox_digest'`。需同步更新 `queue.ts` 中的以下位置：

1. `pendingByType` Record：新增 `inbox_digest: []`
2. `workerRunningByType` Record：新增 `inbox_digest: false`
3. `loadQueueState()` 中的类型数组：新增 `'inbox_digest'`
4. `initQueue()` 中的类型数组：新增 `'inbox_digest'`
5. 如果 `listPending()` 有类型过滤，需确认兼容性

Payload：

```typescript
{ fileName: string }  // 收件箱文件名（不含路径）
```

### 3.2 Worker 执行流程

`runDigestTask(payload)` 执行以下步骤：

1. **读取条目**：调用 storage 读取收件箱文件，解析为 `InboxEntry`
2. **幂等检查**：如果条目已有 `digest` 字段，直接返回成功
3. **文件存在检查**：如果收件箱文件不存在（已被审批/归档），任务标记为 done 并跳过
4. **内容获取**：
   - 如果条目有 `rss_link` 或 `source_url`，调用 `fetchFullContent(url)` 抓取原文全文
   - `fetchFullContent` 是从 `ingest.ts` 中 `enrichContent` 提取出来的导出函数（仅负责抓取+解析，不含写入逻辑）
   - 抓取失败时回退使用条目现有的 `content` 字段
5. **LLM 生成摘要**：调用 `callLLM()` 使用专用 prompt 生成摘要（详见 Section 5）
6. **写入摘要**：调用 `updateInboxDigest(fileName, digest)` 将摘要追加到收件箱文件
7. **发送事件**：调用 `emitInboxEvent('new')` 通知前端刷新（复用现有 action 类型，前端收到后重新拉取列表即可）

任何步骤失败，任务标记为 `failed`，可重试。

**与 ingest 任务的竞态防护**：如果用户在 digest 生成期间审批了条目，ingest worker 会归档该文件。当 digest worker 到达步骤 3 时检测到文件不存在，安全跳过。两个 worker 分别由不同任务类型驱动，互不阻塞。

### 3.3 触发时机

在 `lib/rss/manager.ts` 的 `processFeedItems()` 中：

- 每个条目 `writeInbox()` 成功后，调用 `loadSettings()` 获取当前 `autoDigest` 设置
- 如果为 `true`，调用 `enqueue('inbox_digest', { fileName })`
- 如果为 `false`，不生成摘要

### 3.4 设置项

`lib/settings.ts` 默认设置新增：

```yaml
autoDigest: true  # 是否自动为收件箱条目生成摘要
```

前端设置面板增加对应的开关控件。

---

## 4. 前端展示

### 4.1 InboxPanel 条目详情

在条目详情区域（右侧面板），现有内容预览上方新增摘要区域：

- **有 digest 字段时**：显示一个带视觉区分的摘要卡片，标注"AI 摘要"
- **无 digest 字段时**：不显示摘要区域（不做加载态、不做轮询）

用户刷新页面或切换条目时，如果摘要已生成完成，自然可见。

### 4.2 设置面板

在现有设置中增加开关："自动生成收件箱摘要"，对应 `autoDigest` 配置项。

---

## 5. LLM Prompt

### 5.1 设计原则

摘要必须让用户一眼看出这篇文章在讲什么，包括：
- 文章的核心主题是什么
- 文章在讨论/解决什么问题
- 关键结论或观点是什么（如果有）

### 5.2 Prompt 设计

**System Prompt：**

```
你是一位专业的内容摘要助手。你的任务是为技术、科学和知识类文章生成准确、信息密度高的中文摘要。

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
```

**User Prompt 模板：**

```
标题：{title}

{content}
```

**输出：** 纯文本摘要字符串，不需要 JSON 包装。

### 5.3 LLM 调用

复用现有 `callLLM()` 函数（`lib/llm.ts`），使用与 ingest 管线相同的模型配置。

---

## 6. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `lib/types.ts` | 修改 | InboxEntry 新增 digest/digestGeneratedAt |
| `lib/parsers.ts` | 修改 | parseInboxEntry 提取新字段 |
| `lib/storage.ts` | 修改 | writeInbox 序列化新字段，新增 updateInboxDigest |
| `lib/queue.ts` | 修改 | 新增 inbox_digest 任务类型和 worker |
| `lib/cognition/ingest.ts` | 修改 | 提取 `fetchFullContent` 为导出函数，新增 `generateDigest` 函数 |
| `lib/settings.ts` | 修改 | 默认设置新增 autoDigest |
| `lib/rss/manager.ts` | 修改 | processFeedItems 触发 digest 任务 |
| `app/api/settings/route.ts` | 修改 | 如果需要暴露新设置（视现有设置 API 而定） |
| `components/InboxPanel.tsx` | 修改 | 条目详情新增摘要展示区域 |
| `components/SettingsPanel.tsx` | 修改 | 新增 autoDigest 开关 |

---

## 7. 错误处理

- **抓取失败**：回退使用 RSS feed 原始 content，不阻塞摘要生成
- **LLM 调用失败**：任务标记为 failed，可通过任务面板重试
- **文件写入失败**：任务标记为 failed，收件箱条目保持原样
- **条目已被审批/归档**：worker 检测到文件不存在时，任务标记为 done 但跳过处理

---

## 8. 边界情况

- **重复写入**：幂等检查（已有 digest 则跳过）防止重复生成
- **并发安全**：队列 worker 天然串行执行，无需额外锁
- **服务器重启**：队列持久化到 `queue.json`，pending 的 inbox_digest 任务会在重启后恢复执行
- **条目被拒绝/审批**：归档后 digest worker 检测到文件不存在，安全跳过（步骤 3 的存在性检查）
- **digest 与 ingest 并发**：两个任务类型独立 worker，互不阻塞。如果 ingest 先完成并归档文件，digest worker 到达步骤 3 时安全跳过。如果 digest 先完成，摘要已写入文件，ingest 处理时忽略 digest 字段（不影响 extract 流程）
