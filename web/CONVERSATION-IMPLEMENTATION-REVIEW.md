# Conversation 模块 — 端到端逻辑整理（供 Review）

本文只覆盖 **Conversation（实时对话）** 路径：从用户点击开始，到会话结束，再到 Feedback（评分/维度解释）的生成与展示。

目标：便于 Review 这条链路的 **用户旅程**、**每一步使用的技术/接口**、**判定条件（状态机/分支）**、以及涉及的 **prompt** / **协议消息**。

代码主要在：

- 前端：`web/src/App.tsx`（`ConversationSession`、`VoicePathA`、`buildConversationFeedback`）
- 服务端：`web/voice-server/server.js`（`/api/realtime` WebSocket、`createConversationSession`、`finishSession`）

---

## 1. 架构总览

```
┌──────────────┐   WebSocket JSON      ┌─────────────────┐   二进制协议帧      ┌──────────────────────┐
│   浏览器      │ ◄──────────────────► │  voice-server    │ ◄────────────────► │ 豆包 Realtime (ASR+TTS) │
│  VoicePathA  │   /api/realtime       │  Express + WS    │  wss://…/realtime  │  dialogue              │
└──────────────┘                       └─────────────────┘                     └──────────────────────┘
     │                                         │
     │  麦克风 PCM16 @16k (base64 JSON)         │  会话内存 sessions Map、结束时报表
     │  播放 assistant PCM 下行                 │  finishSession → LLM 报告
     └─────────────────────────────────────────┘
```

- **实时性**：语音经 **豆包 Realtime** 做双向流式对话；不是「先录完再上传」的离线模式。
- **桥接**：`voice-server` 维护 **两条连接**：浏览器 WebSocket（JSON）与上游 WebSocket（二进制协议帧），并做转发与少量业务（会话、转写拼接、结束报告）。

---

## 2. 用户旅程（User Journey）

### 2.1 入口：用户点击进入 Conversation

- **用户动作**：在主页选择 Conversation 路径（`flow === 'conversation'`）。
- **前端动作**：同一次点击内先显示全屏 **「Preparing microphone…」**（`getUserMedia` 进行中），完成后进入会话页并挂载 `VoicePathA`。
- **关键技术**：React 组件切换（`Flow`/`stage` 状态）；首页 `convoMicPreparing` 遮罩。

### 2.2 进入页：自动连接 WebSocket（目标是无感）

- **用户动作**：无（自动）。
- **前端动作**：`VoicePathA` mount 后 `useEffect` → `connectSession()` 创建 WebSocket。
- **关键判定**：
  - 初始 `convoStatus = 'connecting'`（全屏 **Connecting…**）
  - 收到 `session_started` 进入 `ready` 后，在自动开麦成功前仍显示全屏加载（**Starting session…** / **Starting…**），直至进入 `live` 且首包助手音频开始播放前可能仍为 **Preparing audio…**
  - 仅当自动开麦被浏览器拦截并写入 `convoWireError` 时，才退出加载层并展示 **「Start conversation」** 一次点击兜底
- **关键技术/接口**：
  - WebSocket：`ws(s)://{当前页 host}/api/realtime?level=…&duration=…`（同源，走 Vite 代理）
  - 45s 连接超时：若持续处于 CONNECTING/OPEN 且未握手完成则失败

### 2.3 产品意图：点击 Conversation 就等同 Start（自动解锁 + 自动开麦）

- **用户动作**：在首页点击 `Conversation`（这一次点击视为 “Start”）。
- **前端动作（同一次点击手势内）**：
  - `requestAudioPlaybackFromUserGesture()`：提前解锁播放（尽量避免 `AudioContext suspended`）
  - `getUserMedia(...)` 预取并**保留** `MediaStream`（不立刻 stop），传入会话页供消费
- **前端动作（进入会话页后）**：
  - WebSocket 收到 `session_started` 时自动调用 `beginConversation('auto')`
  - `beginConversation` 会优先消费预取的 `MediaStream` 来启动 `AudioContext/ScriptProcessor` 推流
  - 成功后 `micStartedRef = true` → `live`，开始倒计时
- **关键技术/接口**：
  - WebAudio：`AudioContext`, `createMediaStreamSource`, `createScriptProcessor(4096)`
  - 上行格式：float → downsample 16k → PCM16LE → base64 → `{ type:'audio', data }` 发送到 WS

**兼容性兜底**：若浏览器仍拦截自动开麦（权限/手势窗口丢失），会保持在 `ready`、设置 `convoWireError`（含 “Auto-start was blocked…” 等文案），此时 **needsManualMicTap** 为真，展示 **「Start conversation」** 让用户再点一次完成解锁与开麦。

**失败页 Retry**：`failed` / `no_audio_api` 下的 **Retry** 会调用 `connectSession()`：关闭当前 WebSocket、清理麦与播放状态、`convoStatus` 回到 `connecting` 并重新握手。规避方式：voice-server + Vite 正常、环境变量齐全、网络/HTTPS+wss 正确、尽量不中途杀 8787；首次即成功则不会看到该页。

### 2.4 会话中：助手音频播放、打断（barge-in）、计时

- **用户动作**：说话/停顿/打断，或等待。
- **前端动作**：
  - 收到 `{ type:'audio', data, sampleRate }` → 播放队列
  - 收到 `{ type:'barge_in' }` → 立刻停止本地播放队列（用户说话时不“压住”）
  - 倒计时仅在 `convoStatus === 'live'` 递减
- **关键判定**：
  - 收到助手 `audio` **不会**自动切 `live`；必须先成功开麦（防止“助手先说导致永远没开麦”）

### 2.5 结束：倒计时归零或 Stop early

- **用户动作**：
  - 自动：倒计时归零
  - 手动：点击 “Stop early” → 二次确认
- **前端动作**：发送 `{ type:'end' }`；进入 `ending` 并显示 “Wrapping up…”

### 2.6 完成：收到 `session_ended` → 生成 Feedback 并展示

- **服务端消息**：`{ type:'session_ended', transcript, report }`
- **前端动作**：`ConversationSession.handleConversationDone` → `buildConversationFeedback(report, transcript)` → 切到 `feedback` stage

---

## 3. 前端入口与页面结构

| 层级 | 作用 |
|------|------|
| `ConversationSession` | 两阶段：`conversation` 显示 `VoicePathA`；结束后切到 `feedback`，展示 `ListeningFeedbackPanel` 与可选 transcript。 |
| `VoicePathA` | 单条对话会话：建 WebSocket、状态机、麦克风、播放队列、计时、结束回调 `onDone({ report, transcript })`。 |

挂载位置：用户从 Home 选对话路径后进入 `ConversationSession`（见 `App.tsx` 中 `flow === 'conversation'` 分支）。

---

## 4. 浏览器端：`VoicePathA` 行为摘要

### 4.1 WebSocket

- **URL**：`ws(s)://{当前页 host}/api/realtime?level=…&duration=…`（与页面同源，由 **Vite dev / preview 代理** 到 `voice-server:8787`）。
- **挂载后**：`useEffect` 自动调用 `connectSession()`（仅一次）。

### 4.2 状态 `convoStatus`

- `connecting`：正在连 WS。
- `ready`：已收到 `session_started`，有 `sessionId`。多数情况下由全屏加载遮罩覆盖，并自动执行 `beginConversation('auto')`；**仅**在自动开麦失败且 `convoWireError` 匹配兜底文案时展示 **「Start conversation」**。
- `live`：麦克风已成功启动（`micStartedRef === true`）后的会话态；倒计时 `remainingSec` 仅在 `live` 递减。
- `ending` / `failed` / `no_audio_api`：结束或失败。

**注意（已实现逻辑）**：收到下行 **`audio`（TTS）** 时 **不会**自动切到 `live`，避免助手先出声时把「Start conversation」隐藏导致从未开麦。仅在用户点击并成功 `startMicStreaming()` 后进入 `live`；若首包 TTS 已到达，仅 `micStartedRef` 为真后的音频会再 `setConvoStatus('live')`（多数情况下 `beginConversation` 已设过 `live`）。

### 4.3 麦克风上行

- **首选**：首页 Conversation 点击已在同一次手势内 `getUserMedia` 并预取流，`startMicStreaming()` 优先 `takePrefetchedMicStream()` 消费该流，减少二次弹窗。
- **兜底**：若预取失败或浏览器仍拦截，`getUserMedia` 在 **`startMicStreaming()`** 内再次请求；必要时由用户点击 **「Start conversation」**（`beginConversation('manual')`）满足手势要求。
- **AudioContext + ScriptProcessor(4096)**（已弃用 API，但当前仍用）：`onaudioprocess` 取单声道 float → `downsampleTo16k` → `floatToPCM16LE` → **base64** 放入 JSON：`{ type: 'audio', data }` 发给 `voice-server`。
- 静音节点 `GainNode(0)` 接到 `destination`，避免扬声器回授；仍能从输入拉流。

### 4.4 助手播放下行

- 收到 `{ type: 'audio', data, sampleRate }`（默认 24000）→ `enqueuePcmPlayback` → **独立 `AudioContext`**（`playCtxRef`）队列 + `pumpPlayback`。
- 若 `AudioContext` 为 `suspended`，置 `assistantAudioNeedsTap`，在 **`ready` 或 `live`** 下可显示 **「Enable assistant sound」**。

### 4.5 客户端处理的服务端消息

| `type` | 行为 |
|--------|------|
| `session_preparing` | 延长连接超时窗口。 |
| `session_started` | 存 `sessionId`，`ready`，重置自动重试计数。 |
| `audio` | 入队播放；若 `micStartedRef` 则 `live`。 |
| `barge_in` | `stopPlaybackQueue()`（本地打断播放）。 |
| `session_ended` | 停麦、停播、`onDone(report, transcript)`。 |
| `error` | 记 `convoWireError`，停麦停播，`convoStatus = failed`；用户点 **Retry** 时 `connectSession()` 全新连接。 |

**当前未在 UI 订阅**：`user_text`、`assistant_text`、`turn_complete`、`pong`（若服务端发送）；仅影响「是否展示字幕」，**不阻止**上行/下行。

### 4.6 结束会话

- 倒计时到 0：`endSession()` → 发送 `{ type: 'end' }`。
- 用户 **Stop early**：确认后同样走结束逻辑（见 `App.tsx` 内联处理）。

### 4.7 重连

- 连接异常或 `onclose`（非手动结束）会将 `convoStatus` 置为 **`failed`**，由用户点击 **Retry** 调用 `connectSession()` 重新建连；当前实现**无**静默自动重连。

---

## 5. 服务端：`voice-server` 对话路径

### 5.1 进程与端口

- **HTTP + WebSocket 同端口**（默认 `PORT=8787`）。
- **WebSocket 路径**：`/api/realtime`（`WebSocketServer({ server, path: '/api/realtime' })`）。

### 5.2 新连接时序（概要）

1. 向浏览器发 `{ type: 'session_preparing' }`。
2. 校验环境变量：`REALTIME_ENABLED`、`REALTIME_APP_ID`、`REALTIME_ACCESS_KEY`（缺则报错并关连接）。
3. **`createConversationSession({ level, duration })`**：  
   - 用 LLM 生成随机场景 JSON（可超时失败则退回内置 `CONVERSATION_SCENES`）；  
   - `sessions.set(sessionId, { transcript 含首句 Assistant, opening, pcm16Bytes, … })`；  
   - 返回 `kickoffPrompt`（给豆包的首轮指令文本）。
4. 连接 **豆包** `REALTIME_URL`（默认 `wss://openspeech.bytedance.com/api/v3/realtime/dialogue`），带头 `X-Api-*`。
5. `protoWs` **open** 后顺序发送（二进制协议）：  
   - event 1（空 payload）；  
   - event 100：会话配置（TTS 24k PCM、ASR 16k PCM、dialog 模型与 system_role 等）；  
   - event 300：首轮 kickoff 文本 `content: kickoff`。
6. **静音保活**（解决 `DialogAudioIdleTimeout`）：
   - 服务端维护 `lastClientMicAt`。
   - 定时（80ms）尝试向上游发 **100ms 静音 PCM**（16k s16le），但有门控：
     - 若客户端音频在最近 250ms 内持续到达（`now - lastClientMicAt <= 250ms`）→ **不注入**
     - 若客户端音频未开始或断流（>250ms）→ **注入静音**，避免上游 idle timeout
   - 目标：既避免 idle timeout，又避免“静音与真实 chunk 交错”破坏识别/打断。

### 5.3 上游 → 浏览器（`protoWs.on('message')`）

| 条件 | 行为 |
|------|------|
| `messageType === 0x0f` | 错误帧 → 转 JSON `error` 给浏览器（含对 IdleTimeout 的友好文案）；清保活。 |
| `eventId === 150` | `{ type: 'session_started', sessionId, opening, scene }` |
| `eventId === 352` | TTS 负载 → `{ type: 'audio', format, sampleRate, data: base64 }` |
| `eventId === 451` | ASR 终结果 → 更新 `lastUserFinal`，可选 `{ type: 'user_text', text }` |
| `eventId === 550` | 助手文本 → 拼 `sessions[sessionId].transcript`，`{ type: 'assistant_text', text }` |
| `eventId === 450` | `{ type: 'barge_in' }` |
| `eventId === 359` | `{ type: 'turn_complete' }` |
| `eventId === 152` | 上游会话结束 → `finishSession` → `{ type: 'session_ended', transcript, report }` 并关浏览器 WS |

### 5.4 浏览器 → 上游

| JSON | 行为 |
|------|------|
| `{ type: 'audio', data: base64 }` | `buildAudioFrame`（event **200**）转发 PCM 到豆包；累计 `pcm16Bytes`；首帧时停保活。 |
| `{ type: 'end' }` | event 102，约 1.8s 后 `finishSession` → `session_ended`。 |
| `{ type: 'ping' }` | `{ type: 'pong' }`（与连接保活无关，应用层）。 |

### 5.5 会话结束与报告 `finishSession`

- 读 `sessions` 里 transcript，可选 **LLM** 生成结构化 `VoiceReport`（五维 CEFR 等），失败则启发式报告；可合并 **音频指标** `pcm16Bytes` 等做 OralFluency 相关逻辑（见 `server.js` 内 `computeAudioMetrics` / `applyAudioFluencyFromMetrics`）。
- 删除 `sessions` 中该 `sessionId`。

### 5.6 REST（与 WS 并行存在）

- `POST /api/session/start` 等可走 **仅 HTTP** 的会话创建/轮次（**当前主对话 UI 以 WebSocket 为主**）。

---

## 5.7 Prompts（服务端生成与评分相关）

### A) 场景生成 prompt（`generateRandomScenarioPack`，仅在配置 LLM key 时启用）

- **system**（要点）：
  - “You output strict JSON only. No markdown.”
  - keys: `scenarioTitle, situation, coachRole, learnerRole, firstLine`
  - `firstLine`：英语口语化、1-2 句、以问题结尾、限制字数、无舞台指令
- **user**（要点）：
  - “Randomness seed: {uuid}”
  - “Learner CEFR level (internal, never say it aloud): {level}”
  - “firstLine: max {maxWords} words”
  - 要求场景多样化、角色具体

### B) 上游 realtime system role（`startCfg.dialog.system_role` / `speaking_style`）

- `system_role`（当前实现）：
  - “You are an English conversation coach. Speak natural daily English, one concise response at a time.”
- `speaking_style`（当前实现）：
  - “friendly, concise, spoken”

### C) Kickoff prompt（`buildKickoffPrompt` → 上游 event 300）

结构（概要）：

- “Start now. Target length about {durationHint}.”
- “Scenario: {title}.”
- “You are {coachRole}. The learner is {learnerRole}.”
- “Situation: {context}”
- “Do not mention prompts, levels, training, instructions, or meta talk out loud.”
- “Speak your first line exactly as written below, then wait for the learner:”
- `{opening}`（第一句）
- `{turnRule} One question per turn.”
- “Internal difficulty: {levelCoachingGuide(level)}”

### D) 结束报告 JSON prompt（`finishSession`）

- **system**（要点）：
  - strict JSON only，no markdown
  - “Tone: calm, precise, non-generic. No praise.”
  - 允许引用 user lines 作为 evidence
- **user**（要点）：
  - 输出 keys：`snapshot`, `moved`, `held`, `evidence`, `nextTarget`
  - 维度必须是 5 个固定字符串（ListeningComprehension/OralFluency/GrammarAccuracy/VocabularyRange/InteractionQuality）
  - `delta` 只能是 `-0.1, 0, 0.1`
  - OralFluency 要结合 `audioMetrics`
  - 输入包含 transcript + `metricsBlock`（音频派生指标 JSON）

---

## 6. 配置与环境变量（对话相关）

在 `voice-server` 侧（`.env`），典型包括：

- `REALTIME_APP_ID`、`REALTIME_ACCESS_KEY`、`REALTIME_RESOURCE_ID`、`REALTIME_APP_KEY`  
- `REALTIME_URL`、`REALTIME_MODEL`、`REALTIME_SPEAKER`  
- `LLM_*` / `ARK_*`：场景生成与 `finishSession` 报告  
- `REALTIME_ENABLED=0` 可关闭实时（需代码路径仍支持）

---

## 7. Feedback（评分/解释）生成逻辑（前端）

### 7.1 输入（来自服务端）

`VoicePathA` 结束时向上层回调：

- `transcript`: voice-server 累积的文本（`User:`/`Assistant:` 行）
- `report`: `VoiceReport | null`（由 `finishSession` 生成；可能包含 `moved/held/evidence/nextTarget/audioMetrics`）

### 7.2 评分函数：`buildConversationFeedback(report, transcript)`

- **特殊 case**：若 `transcript` 中 `User:` 行数为 0 → 全维度 `warn`，总分 `0`，并标注“未捕获到回答”。
- **维度集合**：`ALL_DIMENSIONS`
  - ListeningComprehension
  - OralFluency
  - GrammarAccuracy
  - VocabularyRange
  - InteractionQuality
- **每维 tone**（基于 `report`）：
  - 若 `report.moved[dim].delta`：
    - `delta >= 0.08` → `good`
    - `0 < delta < 0.08` → `warn`
    - `delta <= -0.08` → `miss`
    - `-0.08 < delta < 0` → `warn`
  - 若 `report.held[dim]` → `neutral`
  - 否则 → `neutral`
- **tone → 分值**：
  - good: 1
  - warn: 0.65
  - miss: 0.25
  - neutral: 0.5
- **总分**：加权平均 \(\sum_{dim} CEFR\_SESSION\_WEIGHTS[dim] \times scoreFromTone(tone)\)
- **展示细节**：
  - 优先用 `report.evidence` 的用户短引用作为证据；否则使用通用说明。
  - OralFluency 维度会把 `report.audioMetrics`（estimatedWpm、speechSeconds、fillerRate 等）拼入 detail 文本。
- **下一步建议**：优先使用 `report.nextTarget`，否则默认 `Next: answer with claim -> reason -> one concrete example.`

### 7.3 UI 展示

`ConversationSession` 结束后 stage 切到 `feedback`，展示 `ListeningFeedbackPanel`（复用维度组件）与可选 transcript。

---

## 8. 与你填写的 SPEC 对照时可重点核对

1. **「先连上 → 助手先说话 → 用户再点 Start」** 与 **保活仅在首帧 mic 前** 是否一致。  
2. **打断**：上游 `450` → 浏览器只停本地队列；是否还要发额外事件给上游（当前 **无** 额外客户端消息）。  
3. **字幕/轮次 UI**：`user_text` / `assistant_text` 若产品需要展示，**当前前端未绑定**。  
4. **计时起点**：从 **`live`** 开始倒计时，不是从 `connecting` 或首包 TTS。  
5. **依赖**：Vite 代理 `/api/realtime` 到 8787；直连错误时查代理与 `voice-server` 是否启动。

---

## 9. 主要文件索引

| 文件 | 内容 |
|------|------|
| `web/src/App.tsx` | `VoicePathA`、`ConversationSession`、对话 UI 与 WS 客户端 |
| `web/voice-server/server.js` | `/api/realtime`、豆包桥接、`createConversationSession`、`finishSession`、协议帧 |
| `web/vite.config.ts` | `server.proxy` / `preview.proxy` 中 `/api` → voice-server |

**Growth 定标与成长（产品目标，非本仓库当前代码逐条实现说明）**：`web/GROWTH-PLACEMENT-SPEC.md`（前 3 次可计分会话渐稳、第 4 次起稳态等）。

---

*文档随实现更新；若你修改 SPEC，请以本文档为对照逐条标差异。*
