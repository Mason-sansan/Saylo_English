# 回退「定标 / placement net cap」改动

在引入 **前 3 场渐稳的净步上界** 之前，以下文件有完整副本：

- `web/voice-server/backup-pre-calibration-2026-04-22/quickReport.js`
- `web/voice-server/backup-pre-calibration-2026-04-22/server.js`
- 同目录下 `README.md` 有简短说明

## 一键恢复（覆盖当前工作区文件）

在仓库的 `web` 目录下执行：

```bash
cp voice-server/backup-pre-calibration-2026-04-22/quickReport.js voice-server/quickReport.js
cp voice-server/backup-pre-calibration-2026-04-22/server.js voice-server/server.js
```

然后需**手工撤销**对 `web/src/App.tsx`（`placementPriorScored`、`client_state`、end 消息）及 `GROWTH-PLACEMENT-SPEC.md` 等文档的编辑；若用 Git，可用 `git checkout -- path` 更省事。

## 与 Git 二选一

若你本地后来初始化了 Git，还可以在改动前为当前提交打 tag，例如 `pre-placement-2026-04-22`；本备份目录不依赖 Git。
