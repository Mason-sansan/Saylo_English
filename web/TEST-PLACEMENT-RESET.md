# 5 局对话定标自测

## 1. 清空成长数据

任选其一：

- 在**开发环境**打开应用根 URL 并加参数：  
  `http://localhost:5173/?resetProgress=1`  
  （若打包预览端口不同，换成你的 `origin`；生产环境会 `confirm` 一次。）

- 或在浏览器开发者工具 **Application → Local Storage** 中删除键：

  - `english.growth.v1`
  - `english.last-session.v1`

若启用了 `VITE_DEMO_SESSIONS=1`，请确认未处于 demo 覆盖模式（可 localStorage 设 `english.demoOptOut=1` 或按你项目里已有逻辑先关掉 demo），否则 `resetProgress` 可能不作用。

## 2. 跑 5 局 Conversation

1. 打开 Growth，确认 **Overall 约 2.0、History 空**（或从默认开始）。
2. 连续完成 **5 局** 对话，每局正常结束、进入 growth。
3. **预期**（在 evidence 与模型/规则较「满」的局）：

   - 第 **1** 场：服务端日志 `[growth] cefr session` 中 `net_cap: 0.5`（`report.placement.netCap` 在客户端为 0.5，`phase: calibrating`）。
   - 第 **2** 场：`net_cap: 0.35`。
   - 第 **3** 场：`net_cap: 0.28`。
   - 第 **4、5** 场：`net_cap: 0.2`，`placement.phase: steady`（prior≥3 时）。

4. 若第 1 场未带 `client_state` / `end` 的 placement，整局会按 **0.2** 稳态 cap（与旧行为一致）——可检查 **voice-server 控制台** 与浏览器 Network/WS 是否发出 `client_state`。

## 3. 细节说明

- `placementPriorScored` = **本局开始前** 的 `growth.history.length`；每完成一场并写入 history 后，下一场 prior 会 +1。
- 被 **language gate** 掉、未增加 history 的局**不会**增加 prior（与产品说明「可计分会话」一致）。
