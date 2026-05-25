# Ora Channel Connectors：外部渠道入口

Ora 是一个桌面端 AI Agent 工作台，Agent 在本地 Runtime 中运行。但用户不一定在电脑前，更多时候是通过 Slack、微信、飞书这些日常工具发消息过来。Channel/Connector 体系就是解决这件事的：把外部平台的消息统一转换成内部 session/run，Agent 执行完后再把结果送回对应的对话里。

这套体系里最容易被误解的一点，是很多人会把 channel 入口想成“收到一句话后，系统会自己猜用户在说哪个项目”。现在不是这样。当前主路径是：**普通自然语言消息只复用当前已绑定项目，不会偷偷触发新的本地项目绑定；只有显式 `/project` 和后续数字确认，才会进入项目发现和绑定流程。**

## 阅读地图

| 层级 | 核心文件 | 职责 |
| --- | --- | --- |
| 契约层 | `packages/shared/src/runtime.ts` (L47–271) | 所有 Channel 类型的 Zod schema 与 TS type |
| 适配器接口 | `apps/runtime/src/channels/base.ts` | `ChannelAdapter` 接口定义 |
| 编排层 | `apps/runtime/src/channels/service.ts` | `ChannelService`：创建/启停 adapter、组装 Manager/Store/Bus |
| 业务核心 | `apps/runtime/src/channels/manager.ts` | `ChannelManager`：ingest → process → run → outbound |
| 持久层 | `apps/runtime/src/channels/store.ts` | `ChannelStore`：config/binding/message/delivery 的 CRUD |
| 消息总线 | `apps/runtime/src/channels/message-bus.ts` | `ChannelMessageBus`：进程内 inbound/outbound pub/sub |
| HTTP 入口 | `apps/runtime/src/http-server.ts` | webhook 路由、认证、分发 |
| 各平台适配器 | `apps/runtime/src/channels/*.ts` | 具体平台的连接、收发、消息规范化 |
| 命令系统 | `apps/runtime/src/channels/commands.ts` | `/help` `/status` `/new` `/project` |
| 附件增强 | `apps/runtime/src/channels/attachments.ts` | 附件下载、大小截断、文本提取 |
| 项目发现 | `apps/runtime/src/channels/project-discovery.ts` | 本地文件系统扫描，匹配项目文件夹 |

---

## 1. 为什么需要这套体系

不同消息平台的差异是全方位的。连接方式上，Slack 用 WebSocket、Telegram 用长轮询、飞书用 webhook，接入逻辑各不相同。消息格式上，每个平台有自己的 JSON 结构，字段名、嵌套层级完全不同。认证机制也一样，有的用 bot token，有的用 HMAC 签名，有的要 QR 码登录。

如果每接一个新平台都单独写一套逻辑，三个问题会越来越严重：入站消息处理逻辑散落在各处，难以复用；出站投递状态没有统一追踪，丢消息了都不知道；外部对话和内部 session 的映射关系靠临时方案维护，容易错乱。

Channel/Connector 体系用两层抽象解决这个问题。**ChannelAdapter** 负责和具体平台打交道，每个平台实现同一个接口，把平台原生消息规范化为统一格式。**ChannelManager** 负责后续所有通用逻辑，包括去重、命令路由、session 绑定、run 的创建和恢复，以及出站消息的构造和投递追踪。Channel 层只处理消息的收和发，不知道 Runtime 内部的模式图、gate、ledger 这些细节。

---

## 2. 架构怎么设计

### 2.1 四层协作

```
External Platform
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  ChannelAdapter (per platform)                       │
│  - 连接管理 (poll / WebSocket / webhook)             │
│  - 消息解析 (normalizeXxxMessage)                    │
│  - 消息发送 (adapter.send)                           │
└──────────┬─────────────────────────────┬────────────┘
           │ onIngest()                  │ bus.publishOutbound()
           ▼                             ▲
┌──────────────────────┐    ┌──────────────────────────┐
│  ChannelManager      │    │  ChannelMessageBus       │
│  - 消息去重           │    │  - inboundQueue          │
│  - attachment 增强    │    │  - outbound subscribers  │
│  - 命令路由           │    └──────────────────────────┘
│  - binding 解析       │
│  - session/run 创建   │
│  - project 发现       │
│  - 出站消息构造        │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│  ChannelStore        │
│  - config CRUD       │
│  - binding 持久化     │
│  - message record    │
│  - delivery tracking │
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│  RuntimePersistence  │
│  Backend             │
└──────────────────────┘
```

四层各司其职：

- **ChannelAdapter**：和外部平台对接。启动连接、接收消息、把平台原生消息规范化为统一格式。出站方向负责把统一消息转换成平台 API 调用发出去。
- **ChannelManager**：所有入站消息的唯一入口，承载完整的处理链：去重、附件增强、命令路由、binding 解析、session/run 生命周期管理、出站消息构造。
- **ChannelStore**：封装持久化。channel 配置、binding 映射关系、消息记录、delivery 投递状态都在这一层落盘。
- **ChannelMessageBus**：进程内的轻量 pub/sub，不持久化。入站消息写入内部队列，出站消息广播给所有订阅者。重启后消失，不是 source of truth。

### 2.2 关键类型

在深入流程之前，先看几个贯穿始终的核心类型。

**ChannelConfig**，一个 channel 的完整配置：

```typescript
ChannelConfig {
  channelId: string;        // 唯一标识
  kind: ChannelKind;        // "slack" | "feishu" | "wechat" | ...
  label: string;            // 人类可读名称
  enabled: boolean;
  capabilities: {           // 能力声明（预留）
    supportsStreamingUpdates, supportsThreadReplies,
    supportsReactions, supportsFileInbound,
    supportsFileOutbound, supportsMessageUpdate
  };
  config: Record<string, unknown>;  // 平台特有配置（token/url 等）
  secretRefs: Record<string, string>; // 外部 secret 引用
  createdAt / updatedAt: number;
}
```

对 channel 来说，`config` 里现在还有一个与本地文件访问直接相关的高层字段：`localReadRoots: string[]`。它表示“这个渠道允许 agent 只读访问哪些宿主机绝对路径目录”。这里故意不直接持久化底层 `grantId/capabilities/source`，而是只保存用户可理解的目录列表；真正的 `hostFilesystem grants` 在 run 启动时由 `ChannelManager` 派生。

这个设计有两个边界必须同时成立：

- 非 Project channel session 可以读取这些显式授权目录下的文件，包括 `document.extract` 读取本地 PDF。
- 这些授权不会让 session 自动获得项目 authority；`repo.explore`、`shell.execute`、package 工具和项目外写权限仍然保持关闭。

敏感字段（token、secret、password 等）在通过 API 读出时会被 `ChannelStore.redactConfig` 替换为 `[redacted]`。

**ChannelInboundMessage**，入站统一消息。所有外部消息经过各自的 `normalizeXxxMessage` 函数映射为此结构：

```typescript
ChannelInboundMessage {
  id: string;                    // Ora 内部 ID
  channelId: string;
  channelKind: ChannelKind;
  externalMessageId: string;     // 外部平台消息 ID
  externalChatId: string;        // 外部对话 ID（频道/群/私聊）
  externalThreadId?: string;     // 外部线程 ID
  externalUserId?: string;       // 发送者 ID
  externalUserDisplayName?: string;
  type: "chat" | "command" | "event";
  text: string;
  attachments: ChannelAttachment[];
  receivedAt: number;
  raw?: unknown;                 // 原始平台消息
  metadata: Record<string, unknown>;
}
```

**ChannelOutboundMessage**，出站统一消息：

```typescript
ChannelOutboundMessage {
  id: string;
  channelId / bindingId / sessionId / runId?;
  externalChatId / externalThreadId?;
  inReplyToExternalMessageId?;   // 回复的外部消息 ID
  text: string;
  isFinal: boolean;
  kind: "status" | "delta" | "final" | "error" | "command_response";
  attachments: ChannelAttachment[];
  createdAt: number;
}
```

**ChannelBinding**，外部对话到 Ora session 的映射。同 channel 下的同一 `externalChatId + externalThreadId` 共享一个 session，意味着外部频道内的多条消息会进入同一个 Ora 会话历史：

```typescript
ChannelBinding {
  bindingId: string;
  channelId;
  externalChatId;          // 外部对话 ID（绑定键）
  externalThreadId?;       // 子线程 ID（二级绑定键）
  sessionId: string;       // 对应的 Ora session
  externalUserId?;
  metadata: Record<string, unknown>; // 包括 pendingProjectSelection 等状态
  createdAt / updatedAt;
}
```

**ChannelDelivery**，出站投递的耐久记录。注意它不是消息本身，而是「这条消息何时以何种状态投递到了外部平台」：

```typescript
ChannelDelivery {
  deliveryId: string;
  channelId / outboundMessageId / sessionId? / runId?;
  status: "queued" | "sending" | "sent" | "retry_scheduled" | "failed";
  attemptCount: number;
  nextAttemptAt?: number;
  lastError?: string;
  message: ChannelOutboundMessage;
  createdAt / updatedAt;
}
```

### 2.3 ChannelManager：核心处理链

`ChannelManager.ingest()` 是外部消息进入 Ora 的唯一入口。完整处理链：

```text
ingest(params)
  │
  ├─ 1. 解析 & 校验 ChannelIngestParams
  ├─ 2. 查找 ChannelConfig，检查 enabled
  ├─ 3. 构造 ChannelInboundMessage（统一模型）
  ├─ 4. 去重检查（通过 externalMessageId）
  │     └─ 重复 → 直接返回 ChannelIngestResult
  ├─ 5. publishInbound（写入 MessageBus，供观察者消费）
  ├─ 6. 入队（按 binding 串行化，maxBindingQueueSize 限流）
  │
  └─ processInbound()
        ├─ 7. attachment 增强（下载、截断、文本提取）
        ├─ 8. 命令解析（/help /status /new /project）
        │     └─ 命中命令 → processCommand() → outbound
        ├─ 9. 解析或创建 binding
        ├─ 10. 检查 pending project selection
        │      └─ 数字回复 → 确认项目 → 启动 run
        ├─ 11. 检查 interrupted run continuation
        │      ├─ needs_approval + /approve → resume
        │      ├─ needs_approval + /deny  → cancel
        │      ├─ needs_clarification + 文本 → resume
        │      └─ 无 pending → 走新 run
        ├─ 12. 显式项目发现（仅 `/project` 或待确认数字回复）
        │      └─ 返回候选列表让用户选择
        ├─ 13. 启动 run（startAndWaitForRun）
        │      └─ 等待 run 进入终态 (succeeded/failed/cancelled/interrupted)
        └─ 14. 构造 outbound message → createDelivery → publishOutbound
```

几个关键决策点：

**入队串行化**，入队键 = `bindingId`（已有 binding 时），或 `channelId:externalChatId:externalThreadId`（无 binding 时）。同一键的消息串行处理，不同键的消息并行处理。队列总数超过 `maxBindingQueueSize`（默认 20）且当前键不在队列中时，返回忙响应。

**Run 超时**，`startAndWaitForRun` 和 `resumeAndWaitForRun` 通过 `runTimeoutMs`（默认 60s）限制等待时间。超时后抛出错误，Manager 不自动重试。

**项目绑定边界**，当前主路径故意更保守：

- 普通自然语言消息不会因为命中目录名、文件名或关键词就自动触发本地项目发现
- 如果当前 session 已经绑定项目，后续普通消息只复用这个绑定
- 只有显式 `/project [keyword]`，以及用户对候选列表的数字确认，才会进入项目发现和重新绑定
- 如果 session 没有绑定项目，普通消息会按“无项目上下文”继续，不会偷偷补一个项目进来

这样做不是为了少做一步，而是为了避免 channel 层把“候选召回”误当成“绑定真相”。项目发现现在只负责找候选，不负责替用户做最终判断。

### 2.4 ChannelAdapter 接口

每个平台适配器实现这个接口：

```typescript
interface ChannelAdapter {
  readonly channelId: string;
  readonly config: ChannelConfig;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  send(message: ChannelOutboundMessage): Promise<SendResult>;
  status(): ChannelStatus;
  parseInbound?(raw: unknown): ChannelInboundMessage; // 可选
}
```

`start`/`stop` 管理连接生命周期，`send` 处理出站投递。入站方式分两类：

- **被动接收（webhook）**：http_webhook、feishu、dingtalk。HTTP server 收到 POST 后直接调用 `ChannelService.ingest()`。适配器的 `start()` 几乎为空。
- **主动拉取（poll/WS）**：slack、discord、telegram、wechat、wecom。适配器的 `start()` 启动长轮询或 WebSocket 连接，收到消息后通过 `onIngest` 回调交给 Manager。

### 2.5 ChannelMessageBus

进程内的轻量 pub/sub，不持久化。`publishInbound()` 写入内部队列，`subscribeOutbound()` 注册订阅者，`publishOutbound()` 广播给所有订阅者。`ChannelService.ensureAdapter()` 在创建 adapter 时自动注册一个出站订阅者：收到 outbound message 后调用对应 adapter 的 `send()`，并更新 delivery 状态。

### 2.6 ChannelStore

封装所有持久化操作，底层依赖 `RuntimePersistenceBackend`：

| 方法 | 功能 |
| --- | --- |
| `createConfig` / `updateConfig` / `deleteConfig` | Channel 配置 CRUD。update 后自动重启 adapter |
| `getConfig` / `getConfigOrThrow` | 读取配置（默认 redact 敏感字段） |
| `findBinding` | 按 channelId + externalChatId + externalThreadId 查 binding |
| `createBinding` | 新建 binding（如已有同键 binding 则复用 ID 更新） |
| `recordInbound` / `recordOutbound` | 记录消息（入站去重 key：externalMessageId） |
| `createDelivery` / `updateDelivery` | 投递追踪（创建、队列、发送、成功、失败、重试） |
| `listBindings` / `listDeliveries` | 列表查询 |

`recordInbound` 的去重是最前端的防线，在 `ChannelManager.ingest()` 阶段就拦截重复消息，避免重复触发 run。

### 2.7 ChannelService：生命周期管理

`ChannelService` 是外部 API 的 facade，协调 Manager / Store / Bus / Adapters：

- `create`：`store.createConfig()` + 自动启动 adapter（如果 `autoStartAdapters=true`）
- `update`：停止旧 adapter → `store.updateConfig()` → 启动新 adapter
- `delete`：停止 adapter → `store.deleteConfig()`
- `start` / `stop` / `restart`：单个 adapter 生命周期
- `startAll`：启动所有 enabled 的 adapter（容错：单个失败不阻断其他）
- `ingest`：委托给 `manager.ingest()`
- `status`：聚合所有 adapter + bus 状态

---

## 3. 具体有哪些实现

### 3.1 平台适配器

目前支持 8 种平台。

#### 连接模式

| 平台 | Kind | 入站方式 | 出站方式 | 是否有 onIngest 回调 |
| --- | --- | --- | --- | --- |
| HTTP Webhook | `http_webhook` | 外部 POST 到 HTTP server | HTTP POST callback | 否（由 http-server 直接调 ingest） |
| Feishu | `feishu` | 飞书事件订阅 webhook | Webhook URL | 否（同上） |
| DingTalk | `dingtalk` | 钉钉机器人 webhook | HTTP API (accessToken) | 否（同上） |
| Slack | `slack` | WebSocket (Socket Mode) | HTTP `chat.postMessage` | 是（WS 收到消息后回调） |
| Discord | `discord` | WebSocket (Gateway) | HTTP `createMessage` | 是（Gateway 收到消息后回调） |
| Telegram | `telegram` | Long polling `getUpdates` | HTTP `sendMessage` | 是（poll 收到消息后回调） |
| WeChat | `wechat` | Long polling `getupdates` (iLink) | HTTP `sendmessage` (iLink) | 是（poll 收到消息后回调） |
| WeCom | `wecom` | WebSocket (`aibot_subscribe`) | WebSocket (`aibot_send_msg`) | 是（WS 收到消息后回调） |

#### 消息规范化

每个平台的 `normalizeXxxMessage` 函数负责将平台原生消息映射为 `ChannelIngestParams`（缺少 `channelId` 字段，由调用方补充）：

| 平台 | 函数 | 输入 | 特殊处理 |
| --- | --- | --- | --- |
| Slack | `normalizeSlackMessage` | `SlackMessageEvent` | 跳过 bot 消息和子类型事件 |
| Discord | `normalizeDiscordMessage` | `DiscordMessageCreateEvent` | 跳过 bot 消息；Gateway resume 支持 |
| Telegram | `normalizeTelegramUpdate` | `TelegramUpdate` | 解析 `message_id`/`chat.id`/`from` |
| WeChat | `normalizeWechatMessage` | `WechatInboundItem` | 仅处理 type=1（文本）消息；提取 `context_token` |
| WeCom | `normalizeWecomCallback` | `WecomMsgBody` | 提取 `text.content` |
| Feishu | `normalizeFeishuWebhookPayload` | 原始 webhook body | 挑战/消息二态；嵌套 JSON content 解析 |
| DingTalk | `normalizeDingtalkWebhookPayload` | 原始 webhook body | 加密/明文双模式；`encrypt` 字段尝试 JSON.parse |

#### 认证配置

| 平台 | 关键 config 字段 | 认证方式 |
| --- | --- | --- |
| HTTP Webhook | `token`, `signingSecret`, `callbackUrl`, `callbackToken` | Bearer token / HMAC 签名验证；callback 同样支持 Bearer |
| Feishu | `verificationToken`, `signingSecret`, `webhookUrl` | 双重验证：verificationToken 匹配 + HMAC-SHA256 签名 |
| Slack | `botToken`, `appToken` | botToken 用于发消息；appToken 用于 Socket Mode 连接 |
| Discord | `botToken` | `Bot <token>` 头；Gateway Identify/Resume |
| Telegram | `botToken` | URL path 中的 bot token |
| WeChat | `baseUrl`, `botToken`, `wechatUin` | QR 码登录获取 botToken；每次请求带 `x-wechat-uin` + `Bearer` |
| WeCom | `botId`, `botSecret` | WebSocket 连接后发送 `aibot_subscribe` |
| DingTalk | `clientId`, `clientSecret` | OAPI gettoken → accessToken |

#### 特殊能力

- **WeChat**：QR 码绑定流程（`requestQrCode` / `pollQrCodeStatus`）；`contextTokenMap` 维护外部 chat 的上下文令牌，已持久化到 config，重启不丢失；bot session 过期自动标记 unbound
- **Slack**：Socket Mode，无需公网 URL；envelope 确认机制；WebSocket ping 心跳
- **Discord**：Gateway session resume，断线重连时优先 RESUME 而非重新 IDENTIFY；heartbeat 心跳 + jitter
- **Feishu**：URL 验证挑战（challenge）自动应答；嵌套 JSON content 解析

### 3.2 HTTP Server 入口

`http-server.ts` 在 runtime 进程中启动轻量 HTTP server，提供三个端点：

```text
GET  /channels/status              → 全部 channel 状态
GET  /channels/:channelId/health   → 单个 channel 健康检查
POST /channels/:channelId/webhook  → webhook 消息入口
```

webhook 路径的认证分派逻辑：`http_webhook` 走 `validateHttpWebhookAuth`，feishu 走 `validateFeishuWebhookAuth` + challenge 应答，dingtalk 走 `normalizeDingtalkWebhookPayload`，其他 kind 直接透传由 Manager 处理。只有 webhook 模式的平台经过 HTTP server，poll/WS 模式的平台由各自的 adapter 内部处理。

### 3.3 命令系统

渠道支持四个内置命令，通过 `/` 前缀触发：

| 命令 | 行为 |
| --- | --- |
| `/help` | 返回可用命令列表 |
| `/status` | 返回当前 binding/session/project/queue 状态 |
| `/new` | 为当前外部 chat 创建新 session，下次消息进入新 session |
| `/project [keyword]` | 显式触发项目发现，返回候选项目列表供用户选择 |

命令由 `ChannelManager.processCommand` 处理，大部分直接生成 outbound 回复，不启动 run。

### 3.4 附件处理

`enrichChannelAttachments` 对消息附带的 URL 进行下载增强：

1. 仅处理 `https?://` 开头的 URL
2. HTTP GET 下载，限制大小（默认 256KB）
3. 计算 SHA256
4. 文本类 MIME，提取 textPreview（前 16KB）
5. 二进制，提取 dataBase64
6. 超限，标记 `too_large`
7. 失败，标记 `failed` + error 信息

增强后的附件注入到 `ChannelInboundMessage.attachments`，作为 run input context 的一部分传递给 Runtime。

### 3.5 状态模型与 Source of Truth

- **ChannelConfig**：Channel 的 source of truth
- **ChannelBinding**：外部对话到 Ora session 映射的 source of truth
- **ChannelDelivery**：出站投递状态的 source of truth（不是 message 本身）
- **ChannelInboundMessage**：已接收入站消息的耐久记录
- **ChannelMessageBus**：不是 source of truth，它是瞬态的进程内事件通道，重启后消失

对项目绑定也适用同样的规则：

- **候选列表不是绑定真相**
- **`ChannelBinding.metadata` 中已经确认的项目绑定才是真相**
- **数字回复只是确认动作，不是新的语义理解器**

### 3.6 容易误解的点

**Channel 不直接调用 LLM**。Channel 层的全部职责是消息收/发和 session/run 生命周期触发。实际的 agent loop 由 Runtime kernel 执行，Channel 不知道模式图、gate、ledger 的存在。

**Binding 不是用户账号**。一个外部 chat 只有一个 binding，但多个外部 user 可能在同一个 chat 里。`externalUserId` 仅用于 metadata 记录，不参与权限判断。

**普通消息不会偷偷改项目绑定。** 现在的 channel 主路径不再根据自然语言内容自动 project auto-bind。用户如果只是继续聊天，系统只会复用当前 session 的已绑定项目；如果没有绑定，就继续在无项目上下文下运行。

**无 Project 不等于无本地文件。** 现在 channel run 即使没有绑定项目，也可以通过 `localReadRoots` 派生出的只读 host grants 访问显式授权目录。运行时会把这些目录暴露给文件类工具，并在 system prompt 中明确提示这是 host grant，而不是 project workspace。

**HTTP server 是 webhook 入口，不是 API 网关**。`/channels/:id/webhook` 只服务外部平台的回调。Ora 自身的管理 API（创建/启停 channel 等）走另一个 JSON-RPC 通道。

**Adapter 状态不等于 Channel 状态**。`ChannelService.status()` 返回 adapter 的瞬时状态（running/stopped），但 ChannelConfig 的 `enabled` 是耐久状态。adapter 可能因 token 无效而停止，但 `enabled` 仍然为 true。

**DingTalk 没有 onIngest**。`DingtalkChannelAdapter` 不主动拉取消息，仅通过 HTTP webhook 被动接收。它的 `send()` 依赖 `getAccessToken()` 自动刷新 token。

### 3.7 当前边界与可演进方向

**已实现：**

- 8 种平台适配器（http_webhook/feishu/wechat/wecom/telegram/dingtalk/slack/discord）
- 入站消息规范化 + 去重
- 附件下载增强
- 命令系统（/help /status /new /project）
- 显式项目发现（本地文件系统扫描 + 候选确认）
- Run continuation（approval/clarification 回复）
- 出站投递完整状态机（queued → sending → sent/retry_scheduled → failed）
- 投递重试：指数退避，最多 5 次，公式 `min(1000 * 2^attempt, 60000)`，耗尽后标记 failed。`applyDeliveryResult` 统一首次发送和重试的状态转换
- 敏感字段 redact
- WeChat QR 码绑定 + contextToken 持久化（重启不丢失）
- WeChat 流式出站（delta incremental messages）

**可演进方向：**

- **流式出站**：WeChat 已支持 delta streaming（`isFinal: false` 增量消息，300ms 节流 + 10 字符最小累积推送）。其他 adapter 可通过 `supportsStreamingUpdates` capability 接入
- **文件出站**：`supportsFileOutbound` 能力声明已定义，各 adapter 的 `send()` 均只发送 text
- **消息编辑/删除**：`supportsMessageUpdate` 已声明，无实现
- **Channel 级 mode/pattern 绑定**：当前所有 channel run 使用 `channelRunConfig()` 默认配置（`modeSelection: "auto"`, `permissionMode: "default"`）
- **DingTalk 主动拉取**：当前仅被动 webhook，未接入钉钉 WebSocket 推送
- **附件超限处理**：超限附件仅标记 status，不通知用户或提供裁剪策略
