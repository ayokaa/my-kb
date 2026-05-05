# Changelog

All notable changes to this project are documented in this file.

## 2026-05-05

### Changed

- **ChatPanel 架构拆分**：820 行单文件拆为三层——`useConversationManager`（会话 CRUD + 持久化）、`ChatSession`（单会话 UI）、`ChatPanel`（120 行布局 shell）。`ChatSession` 可独立测试。
- **会话按需挂载**：从「全部 ChatSession 挂载 + CSS 隐藏」改为「活跃 + stream 中才挂载」。100 个会话时只有 1~N 个在 DOM 上。`streamingIds: Set<string>` 替代了 `streamingSessionsRef + streamTick` 假 state。
- **消息按需加载**：移除 Phase 2 全量预加载（避免 69 并发占满浏览器连接池）。切换会话时首次访问才 `GET /api/conversations/[id]`。
- **乐观创建**：新建会话客户端生成 ID，UI 立即切换，POST 后台持久化。300ms 时间戳防抖替代 `isCreatingRef` 互斥锁，支持连续快速创建。
- **主题无闪烁**：`<head>` 内联阻塞脚本，在 React hydration 前设置 `data-theme`。`ThemeProvider` 从 DOM 读取初始值，`useLayoutEffect` 同步。
- **会话状态类型安全**：`ChatMessage.role` 从 `string` 改为 `'user' | 'assistant'` 联合类型。`parseMessages()` 统一 API 响应映射，消除重复代码。
- **React 性能优化**：`markdownComponents` 提取为模块级常量；非活跃会话不渲染 DOM；stream data effect 从 O(n²) 改为 O(n)（`lastDataLenRef`）；`handleStreamStateChange` 无变化时返回 `prev` 跳过重渲染；`onSave`/`onStreamStateChange` 用 ref 包装避免过期闭包。
- **Chat 组件清理**：移除死代码（`toolCalls` UI、`Globe` icon import）；排队消息 key 从数组索引改为唯一 ID；双重隐藏简化为条件渲染 + `hidden` class。
- **面板清理**：所有面板统一使用共享的 `formatDate`/`serializeMessages`；`NotesPanelClient` 内联 markdown components 提取为 `noteDetailComponents` 常量；`TasksPanel` 移除未使用的 `typeLabel`；`SettingsPanel` placeholder 改为 Anthropic 默认值。
- **ENV 迁移**：`MINIMAX_API_KEY` → `ANTHROPIC_API_KEY`，`MINIMAX_BASE_URL` → `ANTHROPIC_BASE_URL`。
- **Logger 健壮性**：`close()` 等待循环加 5 秒超时保护，防止进程无法退出。

### Fixed

- **删除会话后刷新重现**：根因是 `POST /api/conversations/[id]` 在文件不存在时静默重建。修复：API 返回 404 不重建；前端 `deletedIdsRef` 5 秒窗口拦截 save。
- **AI streaming 时新建会话无响应**：`handleNewConversation` 从 `await` API 改为乐观更新 + fire-and-forget，UI 瞬间切换。
- **stream 中断时截断 JSON 崩溃**：`processStreamRound` 的 `JSON.parse` 加 try-catch，截断时返回 `{}` 并记录 warn。
- **多 stream 并发卡顿**：移除 Phase 2 预加载（`Promise.all` 全部会话消息）——300ms 窗口内 16 个请求占满连接池，正常操作请求受阻。
- **E2E 测试间歇性失败**：根因是 hydration 时序——服务端渲染的文本在 React 接管前就被 `waitForFunction` 检测到。修复：`loadConversations` 完成后设 `data-ready="true"`，测试等确切信号。
- **非活跃 keep-alive 会话抢占布局空间**：`hidden` class 被误删导致 `flex-1` 均分高度。修复：非活跃会话外层 div 加回 `hidden`。

### Added

- **E2E 测试**：14 个 Playwright 测试覆盖创建/切换/删除/输入/主题/持久化，确定性等待（`waitForResponse`、`waitForSelector`）替代盲等 timeout。
- **单元测试**：`parseMessages`（5 例）、`ThemeProvider`（8 例）、`ChatPanel`（10 例）、`utils.test.ts`。
- **`data-ready` 就绪标记**：`useConversationManager` 在 `loadConversations` 完成后设 `ready=true`，E2E 测试和后续逻辑可依赖。

### Removed

- **ToastContext + Providers**：死代码，所有调用早已替换为 `console.error`。
- **Phase 2 全量消息预加载**：切换时按需加载替代。

## 2026-05-04

### Changed

- **ChatPanel 多会话架构重构**：从单 `useChat` 实例切换模型改为每个会话独立 `ChatSession` 组件，所有实例同时挂载、CSS `hidden` 控制可见性：
  - 彻底解决「生成中切换会话导致消息保存到错误会话」的问题
  - 每个 `ChatSession` 拥有独立的 `useChat` hook，会话之间完全隔离，互不干扰
  - 持久化双重保障：`isLoading` 从 true→false 时自动保存 + 组件 `unmount` 时兜底保存
  - 使用 `convIdRef` 捕获当前会话 ID，保存时不受 props 变化影响
  - `handleSave` 去掉 `id !== activeIdRef.current` 检查，后台 stream 完成后也能正确保存
  - 切换会话直接 `setActiveId(id)`，不再需要 `setActiveMessages([])` 清空消息，避免闪烁
  - 新建对话直接 `setActiveId(newId)`，不再需要等待消息加载
  - `loadConversations` 并行加载所有会话的初始消息，避免点击时才加载的延迟
  - `handleSave` 仅更新对应会话的 `turnCount`，不再触发全量 `loadConversations` 重新拉取
- **ToastPortal 布局抖动修复**：去掉 `toasts.length === 0 ? null` 条件、始终渲染容器；添加 `will-change: transform` 创建 GPU 合成层；限制 `max-h/max-w`；`transition-all` 改为 `transition-colors`；`html, body` 添加 `overflow-x: hidden`

## 2026-05-04

### Changed

- **聊天系统提示词重构**：全面重写 `app/api/chat/route.ts` 的 `baseSystem`，从简单的"优先基于知识库作答"升级为结构化格式说明 + 精细化回答原则：
  - 新增【检索结果格式说明】：逐字段解释笔记结构化格式（标签、来源、摘要、与我相关、关键事实、时间线、问答、关联/反向链接、正文）的语义和引用策略
  - 新增【回答原则】：明确"按需取材，拒绝堆砌""深度整合，拒绝粘贴"，禁止复制笔记原文
  - 新增【引用规范】：要求行内标注 `[^笔记标题]`，回答末尾必须列出"参考来源"并注明引用的字段
- **上下文组装补全缺失字段**：`lib/search/engine.ts` 的 `assembleContext()` 补齐了此前丢失的四个结构化字段：
  - `与我相关`（personalContext）
  - `时间线`（timeline）
  - `关联`（links，含权重和关联原因）
  - `反向链接`（backlinks，含权重和关联原因）
- **提示词文档同步更新**：运行 `npm run extract-prompts` 重新生成 `docs/PROMPTS.md`，提示词总数从 14 更新为 18。
- **聊天错误处理增强**：流式响应当中后端出错时，错误信息直接写入消息流（用户能在对话中看到 `[请求失败] ...`），同时触发 `useChat` 的 `onError` 回调弹出 Toast 通知；前端消息区域新增红色错误状态展示。
- **聊天 API 纯 Anthropic 格式重构**：`app/api/chat/route.ts` 删除 `toAnthropicParams()` 转换层，后端内部消息历史全面改用 `Anthropic.MessageParam[]`：
  - `validateMessages` 收紧：messages 数组中不再允许 `system` role（Anthropic 中 system 通过顶层 `system` 参数传递）
  - `processStreamRound` 返回 Anthropic 风格的 `toolUses`（`{id, name, input}`），替代此前的 OpenAI 风格 `toolCalls`
  - `executeToolCalls` 返回 `Anthropic.ToolResultBlockParam[]` 数组，直接用于构建下一轮消息
  - 多轮 Agent Loop 中，assistant 消息直接以 `ContentBlockParam[]`（含 `text` + `tool_use` blocks）追加；工具结果以 `user` 消息（含 `tool_result` blocks）追加，完全符合 Anthropic Messages API 的 user/assistant 交替约束
  - 同步更新 `app/api/chat/__tests__/validation.test.ts`，移除过时的 `openai` SDK mock

## 2026-05-03

### Added

- **记忆管理面板**：新增「记忆」导航页，用户可查看 AI 积累的所有记忆数据，包括用户档案、偏好设置、笔记认知和对话摘要。
- **记忆编辑与删除**：记忆面板支持前端交互操作：
  - 用户档案：编辑角色、背景，添加/删除技术栈和兴趣标签
  - 偏好设置：编辑值、删除条目
  - 笔记认知：逐条删除
  - 对话摘要：逐条删除
  - 一键清除：带确认对话框，清空全部记忆
- **`/api/memory` REST API**：新增 `GET /api/memory`（读取记忆）、`POST /api/memory`（更新档案/偏好）、`DELETE /api/memory`（删除笔记认知/对话摘要/偏好/一键清空）。
- **记忆相关测试**：新增 `app/api/memory/__tests__/route.test.ts`（15 个用例）、`components/__tests__/MemoryPanel.test.tsx`、补充 `lib/search/__tests__/engine.test.ts`（2 个用例）。

### Changed

- **笔记认知与状态关联修复**：修复对话后笔记状态未更新的问题。根因是 LLM 在对话中看不到笔记的 slug ID，导致 `noteKnowledge` 中的 key 与 `note.id` 不匹配，`evolveNoteStatuses()` 永远找不到对应笔记。
  - `lib/search/engine.ts` 的 `assembleContext()` 在注入对话上下文的笔记信息中显式标注 `ID: ${note.id}`
  - `app/api/memory/update/route.ts` 的 prompt 明确要求 LLM 使用"对话中笔记标注的 ID: xxx 值"作为 `noteId`
- **笔记状态演进规则调整**：`lib/memory.ts` 的 `computeNoteStatus()` 修改删除认知后的行为——认知记录被删除（`nk = undefined`）时，笔记状态统一退回 `seed`（而非保持原状态或变为 `stale`）。
  - `growing` → `seed`
  - `evergreen` → `seed`
  - `stale` → `seed`
  - `evergreen` 的超时逻辑保持不变：仍有认知但 30 天未引用时降级为 `stale`
- **手动操作记忆后触发状态演进**：`app/api/memory/route.ts` 的 DELETE 操作中，删除 `noteKnowledge` 或 `clearAll` 后自动调用 `evolveNoteStatuses()`，确保手动删除认知后笔记状态同步更新。
- **运行日志默认保留量**：`lib/logger.ts` 的 `query()` 默认 limit 从 100 改为 1000；`components/LogsPanel.tsx` 的前端请求 limit 同步改为 1000。
- **记忆触发时机补充测试与日志**：
  - 提取 `hooks/useMemoryFlush.ts` 自定义 Hook，封装记忆缓存与刷新逻辑
  - `ChatPanel.tsx` 迁移至新 Hook，`handleSave` 中使用 `stageMemoryUpdate`，四个触发点（新建/切换/删除对话、组件卸载）继续使用 `flushMemoryUpdate`
  - 新增 `hooks/__tests__/useMemoryFlush.test.ts`（9 个用例），覆盖：stage、null id 跳过、无 pending 跳过、消息不足跳过、正常 flush、重复 flush 只发一次、fetch 成功/失败日志、多对话独立处理
  - 补全前端 `console.log`/`console.error` 日志：stage、skip、flushing、success、failed 五个环节均有输出
  - 补全后端 `app/api/memory/update/route.ts` 日志：接收请求时记录 `conversationId` 和消息数，消息不足拒绝时也记录
- **LLM 查询重写**：多轮对话时，在检索前调用独立 LLM 将对话历史重写为检索查询。解决指代消解（"那"→"RAG"）和上下文断裂问题。单轮对话跳过重写以节省成本。重写失败时自动 fallback 到用户原消息。与 `loadOrBuildIndex()` 并行执行以压缩延迟。
- **会话级记忆更新**：记忆提取从"每轮 AI 回复后触发"改为"会话结束时批量触发"。判定会话结束的时机：创建新对话、切换对话、删除当前对话、组件卸载。减少简单寒暄轮次对 `conversationDigest` 的噪音污染，使摘要更凝练。
- **记忆提取 Prompt 偏好示例扩展**：`preferenceSignals` 增加 `_description` 说明示例不限于所列键名，并新增 `language`、`responseFormat`、`expertiseLevel` 等示例，避免 LLM 将偏好提取局限于 `detailLevel` 和 `preferCodeExamples` 两个维度。

### Fixed

- **偏好值后端类型校验**：`POST /api/memory` 的 `updatePreference` action 新增 value 类型检查，仅允许 `string | number | boolean`，拒绝 `object | array | null` 注入。
- **查询重写 getLLM 异常降级**：`rewriteQuery` 链新增 `.catch()` 兜底，`getLLM()` 拒绝时降级到用户原消息而非返回 500。
- **会话记忆更新错误静默**：`flushMemoryUpdate` 的 fetch 失败从静默吞错改为 `console.error` 输出。
- **摘要列表 React key**：对话摘要列表 key 从数组索引改为 `conversationId`，避免删除时渲染错位。
- **图标重命名**：`AlertTriangle` → `TriangleAlert`，对齐 lucide-react 新版本 API。

## 2026-05-02

### Added

- **消除 `as any` 滥用**：修复 18 处非测试代码中的 `as any`，统一替换为更精确的类型（`Record<string, unknown>`、`FormData`、`ChangeEvent`、`YamlDumpOptions` 等）。新增 `hooks/useKeyboardShortcuts.ts` 封装快捷键判断逻辑，避免各组件重复手写 `if ((e.ctrlKey || e.metaKey) && e.key === 'Enter')`。
- **补充 `lib/queue.ts` 单元测试**：新增 7 个测试，覆盖直接入库（title+content）、userHint 注入、web_fetch 缓存复用、relink 任务、worker 异常捕获、listInboxPending 过滤、自动启动 worker 等分支。queue.ts 行覆盖从 62.8% 提升到 81.3%，分支覆盖从 38.7% 提升到 58.0%。
- **前端快捷键支持**：所有涉及文本输入的交互统一快捷键行为。
  - `ChatPanel`：聊天输入框改为 `textarea`，Enter 换行，Ctrl/Cmd+Enter 发送，内容自动增高（最高 200px），发送后高度重置。
  - `IngestPanel`：文本/链接/文件三个 tab 的输入区统一快捷键——内容 `textarea` 用 Ctrl+Enter 提交，URL `input` 用 Enter 提交，提示词 `textarea` 用 Ctrl+Enter 提交（文件 tab 触发文件选择）。
  - `InboxPanel`：提示词 `textarea` 用 Ctrl+Enter 将当前条目加入知识库。
  - 快捷键逻辑统一封装到 `hooks/useKeyboardShortcuts.ts`，提供 `onCtrlEnter(handler)` 和 `onEnter(handler)` 两个工具函数，消除各组件中重复的判断代码。
  - 新增单元测试 `hooks/__tests__/useKeyboardShortcuts.test.ts`（7 个测试），覆盖 Ctrl+Enter、Meta+Enter、纯 Enter、其他按键等场景。
- **补充 E2E 测试覆盖**：新增 `e2e/settings.spec.ts`（5 个测试），覆盖设置面板导航、默认值加载、修改保存、非法 cron 表达式校验、非法 RSS 间隔校验。更新 `e2e/chat.spec.ts`，补充 Enter 换行和 Ctrl+Enter 发送的快捷键行为验证。更新 `e2e/ingest.spec.ts`，补充文本和链接 tab 的 Ctrl+Enter 快捷键提交验证。

### Changed

- **Relink 改为全量替换模式**：`lib/cognition/relink.ts` 中 `relinkNote` 不再增量追加关联，而是直接用 LLM 重新评估后的完整 `links` 列表替换现有关联。解决了长期运行后关联只增不减、过时链接累积的问题。
  - prompt 更新：明确要求 LLM "基于当前笔记的完整内容重新判断"并"输出完整的关联列表，不是增量补充"。
  - `linksEqual` 同步增强：除 `target` 外，新增比较 `weight` 和 `context`，确保关联属性变化也能触发保存。
- **关联候选数量从 5 提升到 20**：`lib/cognition/ingest.ts` 中 `CANDIDATE_LIMIT` 从 5 改为 20。ingest 和 relink 传给 LLM 的候选笔记上限从 5 篇提升到 20 篇，显著扩大 LLM 的视野。
- **候选笔记信息丰富化**：`selectCandidateTitles` 重构为 `selectCandidates`，返回完整的 `Note[]` 而非仅标题字符串。ingest 和 relink 的 system prompt 现在向 LLM 展示每篇候选笔记的**标题、摘要和关键事实**。
- **LLM 输出上限提升**：ingest 和 relink 中的 `max_tokens` 从 4096 提升至 **8192**，以容纳更长的候选笔记上下文。
- **关联数量上限设为 5 个**：ingest 和 relink 的 prompt 中明确要求"最多关联 5 个笔记，优先保留关联度最高的"，同时代码层做 `slice(0, 5)` 兜底截断，防止关联列表过度膨胀。

## 2026-05-01

### Changed

- **日志系统重构：集成 pino，统一日志输出**：`lib/logger.ts` 集成 `pino` + `pino-pretty`，开发环境提供彩色结构化终端输出（stream 模式，避开 Next.js Worker Thread 兼容问题），生产环境静默（仅写文件），测试环境完全关闭。
  - 新增 `setLevel(level)` 运行时级别切换，默认 `info`。
  - Buffer 和 SSE 回调保留所有级别日志（供 query API 和日志面板使用），级别过滤仅影响文件写入和 pino 终端输出。
  - `metadata.error` 自动提取 Error stack trace，调用点通过 `{ error: err }` 传参即可保留完整调用栈。
  - 时间戳从 UTC `toISOString()` 改为本地时区 `toLocalISOString()`，修复 UTC+8 凌晨日期偏移问题。
  - 禁用 `patchConsole()`（`app/layout.tsx` 中注释掉），所有服务端代码显式使用 `logger.xxx()`。
  - 全局替换：14 个文件 24 处 `console.xxx` → `logger.xxx`，Error 对象统一通过 metadata 传递。
  - 新增依赖：`pino` 10.3.1、`pino-pretty` 13.1.3、`@types/pino` 7.0.4。
- **新增测试覆盖**（12 个）：`setLevel` 运行时切换、级别过滤行为（buffer vs 文件）、Error stack 自动提取、`toLocalISOString` 输出格式验证。

### Changed (cron)

- **定时任务库从 `node-cron` 4.2.1 替换为 `cron` 4.4.0**：`node-cron` 4.2.1 存在已知的 missed execution 误报问题（issue #485），在无干扰环境下也会触发 false positive。替换为周下载量 120万+ 的 `cron` 包，其内置 250ms 容忍阈值（`threshold`），延迟在阈值内仍正常执行任务，超出阈值才跳过，行为更合理可靠。
- **增强错误处理**：RSS 和 Relink 的 `CronJob` 配置中新增 `name: 'rss-cron' / 'relink-cron'` 和 `errorHandler`，未捕获的 cron 执行异常会被转发到项目 logger，而不是直接输出到控制台。
- **更新相关文件**：`lib/rss/cron.ts`、`lib/relink/cron.ts`、`app/api/settings/route.ts`（验证逻辑改用 `validateCronExpression`）、所有相关测试文件及文档（`AGENTS.md`、`docs/ARCHITECTURE.md`）。
- **新增错误处理测试**：`lib/rss/__tests__/cron-error.test.ts`（3 个测试），验证 `CronJob.errorHandler` 对同步抛错和异步 reject 的捕获行为，以及 `name` 属性是否正确传递。

## 2026-04-30

### Fixed

- **`node-cron` HMR 任务泄漏（增强）**：`lib/rss/cron.ts` 和 `lib/relink/cron.ts` 新增 `globalThis` 跨模块实例存储机制。HMR 重载后，新模块实例通过 `globalThis` 直接定位并销毁旧任务，弥补模块级变量重置后 `getTasks()` registry 清理可能遗漏的竞态窗口。配合 `getTasks()` 形成双重保险，确保 dev 模式下快速连续 HMR 不会累积僵尸 cron 任务。

### Added

- **HMR 防护单元测试**：新增 `lib/rss/__tests__/hmr-globals.test.ts`（4 个测试）和 `lib/relink/__tests__/hmr-globals.test.ts`（2 个测试），使用真实 `node-cron` 验证 `vi.resetModules()` 模拟 HMR 场景下 globalThis 清理的正确性，包括单次重载、连续 5 次快速重载、以及 `stopXxxCron` 彻底清理等场景。
- **提示词自动文档化**：新增 `scripts/extract-prompts.ts`，通过 TypeScript AST 静态分析自动提取代码库中所有 LLM 提示词（system prompt、tool definition、user template），生成 `docs/PROMPTS.md`。支持 `npm run extract-prompts` 一键更新，确保提示词修改后文档同步刷新。

## 2026-04-29

### Fixed

- **Logger 同步 I/O 阻塞事件循环**：将 `appendFileSync` 替换为基于 `queueMicrotask` 的异步批量写入。burst 日志（如 RSS cron 整点触发时的 26 次 enqueue）会被合并为单次 `appendFile` 调用，消除 per-line 的事件循环阻塞。
- **Queue 无界 Promise 链**：`saveQueueState` 从 `saveLock = saveLock.then(...)` 改为 `saveInProgress + saveRequested` 的防抖互斥模式。26 次 rapid enqueue 最多触发 2 次磁盘写入。
- **SSE heartbeat interval 泄漏**：`app/api/logs/stream/route.ts` 的 `cancel()` 现在正确调用 `cleanup()`，同时清除 interval 和 log callback。
- **SSE events stale controller 泄漏**：当 controller set 超过 50 个时，主动发送 heartbeat 探测并清理已断开的 controller。
- **SSE events 无心跳断开** (`app/api/events/route.ts`)：新增 30s heartbeat、AbortSignal 处理和 cancel 清理，与 `/api/logs/stream` 保持一致，防止代理因空闲超时断开 SSE 连接。
- **`node-cron` HMR 任务泄漏**：`rss/cron.ts` 和 `relink/cron.ts` 在启动新任务前，通过 `node-cron` 的 `getTasks()` registry 清理同名的旧任务实例，防止 Next.js dev 服务器热更新后僵尸任务累积。
- **LogsPanel 滚动按钮定位**：修复日志面板中"滚动到底部"按钮会随内容滚动而移动的布局问题，改为固定定位在右下角。（`2ff16c0`）
- **MessageStream 类型修复**：修复 Anthropic Messages API 流式响应中的 `MessageStream` 类型不匹配问题，确保 TypeScript 编译通过。（`ac4b5f5`）
- **RSSPanel 加载顺序**：修复 RSS 订阅面板在初始加载时的数据获取顺序问题，避免空状态闪烁。（`ac4b5f5`）

### Added

- **类型化 SSE 事件系统** (`lib/events.ts`)：将单 `data: changed` 广播拆分为 `emitNoteEvent` / `emitTaskEvent` / `emitInboxEvent` 三个类型化函数，携带结构化 payload（action/id/title 等）。SSE 格式使用标准 `event:` + `data:` 字段，客户端可用 `EventSource.addEventListener()` 按事件类型精准订阅。
- **全局 toast 通知** (`hooks/ToastContext.tsx`)：零依赖 React Context toast 系统。`ToastProvider` 包裹 app，`useToast().show(message, type)` 在右下角堆叠显示，4s 自动消失，点击即关闭。支持 success/error/info 三种类型。
- **通用 SSE hook** (`hooks/useSSE.ts`)：封装 EventSource 连接、自动重连（指数退避 1s→2s→4s→max 30s）、JSON 解析、连接状态返回。一个 hook 替代此前每个面板中手动重复的 `new EventSource(...)` 代码。
- **连接状态指示器** (`components/ConnectionStatus.tsx`)：侧边栏底部显示绿色/琥珀色圆点 + "已连接"/"重连中" 文字，反映 SSE 连接健康。
- **收件箱实时更新**：InboxPanel 和 RSSPanel 首次通过 `useSSE({ onInbox })` 订阅收件箱变更事件。RSS cron 抓取到新内容时自动通知前端。
- **任务完成通知**：TasksPanel 通过 `useSSE({ onTask })` 收到任务成功/失败事件时弹出 toast 通知，不再需要手动切到任务面板查看进度。
- **操作反馈**：所有面板的 create/save/delete/approve/reject 操作都增加了 toast 反馈（成功/失败），取代此前仅 `console.error` 的静默失败。
- **用户记忆系统** (`lib/memory.ts`)：聊天后自动分析对话，提取用户画像（角色、技术栈、兴趣、背景）、笔记熟悉度（`aware`/`referenced`/`discussed`）、对话摘要和偏好信号。记忆持久化到 `knowledge/meta/user-memory.json`，增量合并，不重复已有信息。`getChatContext()` 将记忆注入聊天 system prompt，实现个性化回复。（`e9e21d6`）
- **笔记状态自动进化** (`lib/memory.ts`)：根据用户记忆中的 `noteKnowledge` 自动演进笔记状态。纯规则判断，不调用 LLM：`seed` → 用户提及过 → `growing`；`growing` → 深入讨论过 → `evergreen`；`evergreen` → 30 天未提及 → `stale`；`stale` → 再次被提及 → `growing`。每次 `/api/memory/update` 完成后自动执行。（`e4cfcd9`）
- **笔记面板服务端全文搜索** (`app/api/notes/route.ts`)：`GET /api/notes` 新增 `?search=` 查询参数。后端使用 `ripgrep` 扫描所有笔记正文做全文匹配，同时叠加标题/摘要/标签的字符串包含匹配。返回结果后前端不再做客户端过滤，解决大知识库下前端搜索性能问题。（`3d19174`）

### Changed

- **Search cache TTL**：从 5 秒提升至 5 分钟，减少 14MB 倒排索引的重建频率。
- **搜索索引去 content + ripgrep 兜底**：`buildNoteIndex` 不再对 `note.content` 做分词索引——正文贡献 80%+ 的索引体积但检索权重最低（0.8）。结构化搜索结果 < 3 条时，自动用 `rg -l -i` 扫描 notes/ 做全文关键词兜底。索引体积缩小 ~10x，构建速度提升 ~5x。
- **中文分词从 n-gram 迁移至 jieba**：用 `@node-rs/jieba` 词典分词替换 `expandChineseTokens` 的纯 n-gram 滑动窗口。分词精度显著提升（"向量数据库" 从 8 个噪声 token 降为 ["向量","数据库"]），索引噪声大幅减少。`INDEX_VERSION` 升至 3 触发自动重建。
- **URL 去重覆盖全路径**：`runWebFetchTask` 和 `runIngestTask` direct mode 新增 `listNoteSources()` 查重，同一 URL 不会重复生成笔记。去重覆盖了之前遗漏的 web_fetch 和文本/文件直接入库路径。
- **笔记按创建时间倒序**：`listNotes()` 从 `readdir` 顺序改为按 `created` 降序，前端笔记列表最新排在前面。
- **Web 抓取重试缓存**：`Task` 新增 `taskCache` 字段，`retryTask` 保留不清除。`runWebFetchTask` 抓取成功后缓存内容到 task，LLM 失败重试时跳过抓取直接用缓存。
- **入库提示词**：所有入库入口（文本/链接/文件/收件箱）新增可选的提示词输入框，填入后作为 `【用户提示】` 注入 LLM 提取 prompt，引导 AI 重点关注特定方向。
- **Web 抓取超时空内容直接失败**：`fetchWebContent` 返回空内容时抛异常（取代之前继续送 LLM 产出垃圾笔记），任务标记为 failed。
- **笔记删除二次确认**：删除按钮改为与对话删除一致的两击模式——首次点击变红"确认删除"，3s 自动恢复，二次点击执行删除。
- **Web 抓取超时提升至 60s**：Python 端 `goto` 超时从 15s 升至 60s，Node.js 端 90s。
- **SSE 刷新保留搜索词**：`NotesPanelClient` 在收到 SSE `note` 事件自动刷新列表时，保留当前搜索框中的搜索词，不再跳回全量列表。（`cd4327f`）
- **连接状态并入侧边栏**：`ConnectionStatus` 组件删除，功能并入 `Sidebar` 底部 Status 区域。三种状态：灰色"连接中" → 绿色"已连接" → 琥珀色脉冲"重连中"。（`05d9763`）

## 2026-04-28

### Changed

- **LLM API 格式迁移至 Anthropic Messages API**：
  - `lib/llm.ts`：OpenAI 客户端工厂替换为 `@anthropic-ai/sdk` 的 `Anthropic` 客户端。保留设置缓存和热重载机制。
  - `app/api/chat/route.ts`：流式对话从 OpenAI `chat.completions.create` 迁移到 Anthropic `messages.create`。System prompt 作为顶层参数；消息格式转换为 Anthropic `MessageParam`（`tool_use` / `tool_result` content blocks）。Agent Loop 保持最多 2 轮、最多 3 个并发工具调用。
  - `lib/cognition/ingest.ts` 与 `lib/cognition/relink.ts`：非流式 LLM 调用同步迁移。响应从 `choices[0].message.content` 改为提取 `content` 数组中的 `TextBlock`。
  - 相关单元测试全部适配新响应格式。

- **网页抓取引擎替换** (`lib/ingestion/web.ts`)：将 Playwright Chromium 替换为原始 Python `camoufox`（Firefox 反指纹浏览器）。
  - 新增 `scripts/fetch_web.py`：Python 脚本使用 `camoufox.sync_api.Camoufox` 渲染页面并返回 HTML + title。
  - 新增 `requirements.txt` + `scripts/setup_camoufox.sh`：安装 Python 依赖并下载浏览器二进制。
  - `lib/ingestion/web.ts` 改为通过 `child_process` 调用 `python3 scripts/fetch_web.py <url>`，Python 端使用 `trafilatura` 提取正文，只返回 `{title, content}` JSON，Node.js 端直接解析。彻底绕过 JSDOM + Readability 在复杂 CSS 页面（如微信公众号）上的崩溃问题。
  - 新增 `lib/ingestion/camoufox-runner.ts`：封装 `execFile` 调用，便于单元测试 mock。
  - `@playwright/test` 仍保留用于 E2E 测试。

### Added

- **运行时日志系统**：新增结构化日志模块，支持前后端统一的日志收集、持久化与实时查看。
  - `lib/logger.ts`：核心 Logger 类，提供 `debug/info/warn/error` 四级日志 API；内存环形缓冲区（1000 条）+ 按天轮转的文件持久化（JSON Lines，保留 30 天）；支持 `patchConsole()` 无侵入拦截现有 `console.*` 调用。
  - `app/api/logs/route.ts`：GET 查询日志（支持 level/module/search/limit/offset/from 过滤）；DELETE 清空内存缓冲。
  - `app/api/logs/stream/route.ts`：SSE 实时推送新日志，带历史回溯和心跳保活。
  - `components/LogsPanel.tsx`：前端日志查看面板，支持级别过滤、模块过滤、关键词搜索、实时/暂停切换、自动滚动、元数据展开。
  - `Sidebar` / `TabShell`：新增 "日志" 标签页入口。
  - 核心模块（`queue`, `rss/cron`, `rss/manager`, `cognition/ingest`, `cognition/relink`, `relink/cron`）的 `console.*` 调用已迁移至 `logger.*`。
  - `app/layout.tsx` 启动时自动调用 `patchConsole()` 初始化日志拦截。

### Changed

- **手动入库跳过收件箱** (`app/api/ingest/route.ts`, `app/api/upload/route.ts`)：文本、链接和文件上传不再先写入 `inbox` 再异步 `ingest`，而是直接在 API 路由中调用 `processInboxEntry` 生成 Note 并保存。前端提交后同步等待 LLM 处理完成并返回生成的笔记标题，不再经过收件箱审核环节。

### Fixed

- **Search cache deadlock** (`lib/search/cache.ts`): `doLoadOrBuild` exceptions left `loadPromise` permanently set to a rejected Promise, causing all subsequent requests to hang. Fixed with `try/finally` to always reset `loadPromise` to `null`. (`50f6dfe`)
- **Search backlink field type** (`lib/search/types.ts`): `SearchField` was missing `backlink`, causing backlink-indexed terms to receive zero weight during scoring. Added `backlink` to the union type and `DEFAULT_ZONE_WEIGHTS` (weight 1.2). (`de2a210`)
- **Camoufox fetch robustness** (`lib/ingestion/web.ts`, `scripts/fetch_web.py`):
  - `JSON.parse` 增加 try-catch，当 Python 进程被 kill 或 stdout 截断时抛出包含原始输出的友好错误，而不是生硬的 `SyntaxError`。
  - Python 端在 `fetch()` 内重定向 `sys.stdout` 到 `io.StringIO`，抑制 Camoufox / trafilatura 的警告污染，确保最终 `stdout` 只有纯净 JSON。
  - `fetchWebContent` 入口增加 `isValidHttpUrl` 校验，拒绝非 http/https 协议及私网 IP，防止 SSRF。
  - 协调两端超时：Python 单次 goto 超时降至 15s（fallback 最多 30s），Node.js 超时降至 50s，确保 fallback 有机会执行。
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
