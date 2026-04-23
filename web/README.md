# English (local web)

This folder contains:

- **Home**: Listening first, Conversation second (voice Path A)
- **Growth**: local persistent scores + last session recap

## Run (Voice Path A)

Terminal 1 (API):

```bash
cd web
npm install
npm install --prefix ./voice-server
cp voice-server/.env.example voice-server/.env
```

Edit `voice-server/.env`:

- **豆包 / 火山方舟（对话 + 会话报告）**：在方舟控制台创建 **API Key** 和 **推理接入点**，把下面三项填好（`LLM_MODEL` 填接入点 ID，一般以 `ep-` 开头）：
  - `LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`（若控制台写的是别的区域，以控制台为准）
  - `LLM_API_KEY=`
  - `LLM_MODEL=`
- **豆包实时语音（Conversation 实时通话）**：在豆包语音控制台填写：
  - `REALTIME_APP_ID=`
  - `REALTIME_ACCESS_KEY=`
  - 可选：`REALTIME_MODEL=1.2.1.1`（O2.0）或 `2.2.0.0`（SC2.0）
  - 可选：`REALTIME_SPEAKER=zh_female_vv_jupiter_bigtts`
- **听力转写**：需要 OpenAI 兼容的 Whisper 时，再填 `WHISPER_API_KEY`（可与方舟不同）。只填方舟时，**Conversation 可用**，Listening 转写会提示缺密钥。
- 仍可使用纯 **OpenAI**：只填 `OPENAI_API_KEY`（旧方式），可不填 `LLM_*`。

```bash
npm run dev:voice-server
```

Terminal 2 (Vite):

```bash
cd web
npm install
npm run dev
```

Open the local URL shown in the terminal (often `http://localhost:5173/`).

### Server auth + saved progress (optional, for deployment)

By default, accounts and Growth data live in the browser (`localStorage`). For a **real backend**:

1. **`voice-server/.env`**: set `SERVER_AUTH=1`, `SESSION_SECRET` to a long random string, and (behind HTTPS) `COOKIE_SECURE=1`.
2. **`web/.env.local`**: `VITE_USE_SERVER_AUTH=1`, then restart Vite or run `npm run build` for production.
3. **Same origin**: serve the built site and proxy `/api` (including WebSocket `/api/realtime`) to the voice-server port so the session cookie is sent on API and WS requests.

Data is stored under `voice-server/data/` (SQLite + session files); add backups of that directory in production.

### Railway 部署（单服务：网页 + API 同一地址，推荐）

目标：**不用自己买 ECS、不用配 Nginx**，一个 HTTPS 地址同时打开网站、登录、对话。

1. **代码放到 GitHub（推荐）**  
   GitHub 是一个网站：注册账号 → 新建仓库 → 把你的 `English learning` 项目上传上去。Railway 会从这里自动拉代码部署。  
   若暂时不想用 GitHub，也可以在 Railway 里用其他方式部署镜像，但对你而言 **GitHub 最省事**。

2. **Railway（这一步漏了会报 Railpack / build plan 失败）**  
   - 打开 [railway.app](https://railway.app) 注册，新建 **Project** → **Deploy from GitHub repo**，选中你的仓库。  
   - 打开该服务 → **Settings** → **Root Directory**，填 **`web`** 并保存。（仓库根目录是 `Saylo_English`，应用和 `Dockerfile` 在 **`web`** 子目录里。）  
   - 仓库里已有 **`web/railway.toml`**，会强制用 **Dockerfile** 构建（不用 Railpack 猜）。  
   - 改完 Root Directory 后：**Deployments → Redeploy** 或推一个新 commit 触发构建。  
   - 构建日志里应出现类似 **Using detected Dockerfile**；构建时已默认 `VITE_USE_SERVER_AUTH=1`。

3. **环境变量（Railway → 服务 → Variables）** 至少设置：  
   - `SERVER_AUTH=1`  
   - `SESSION_SECRET` = 一长串随机字符（不要用简单密码）  
   - `COOKIE_SECURE=1`（Railway 对外是 HTTPS）  
   - 以及 `.env.example` 里的 `LLM_*`、`REALTIME_*` 等密钥（与本地一致）  
   - `PORT` 一般 **不用手写**，Railway 会注入；`server.js` 已读 `process.env.PORT`。

4. **持久化磁盘（重要）**  
   在 Railway 为该服务添加 **Volume**，例如挂载到 **`/data`**，再增加变量：  
   - `USER_DB_PATH=/data/users.sqlite`  
   - `SESSION_FILES_DIR=/data/sessions`  
   否则容器一重启，用户和进度会丢。

5. **自定义域名**  
   在域名购买处（阿里云、Cloudflare、Namecheap 等）把域名的 **DNS** 指到 Railway 提示的记录（或 CNAME 到 Railway 给的地址）。  
   然后在 Railway 项目里 **Settings → Networking → Custom Domain** 添加你的域名，等待证书就绪后用 `https://你的域名` 访问。

6. **部署后自检**  
   打开站点 → 注册 → **Conversation** 能连上；同一浏览器里刷新后仍保持登录。

### Playback (do this before reporting “no sound”)

1. Run **both** Terminal 1 (`dev:voice-server`) and Terminal 2 (`npm run dev` or `npm run preview`).
2. **Listening**: after the clip is prepared, tap **Play clip** once (browser autoplay rules).
3. **Conversation**: when you see **Start conversation**, tap it once (unlocks mic + Web Audio). If you see **Enable assistant sound**, tap that too.

## Preview sample sessions (Growth summaries)

Create `web/.env.local`:

```bash
VITE_DEMO_SESSIONS=1
```

Restart Vite. Open **Growth**: you’ll see six mixed listening/conversation rows (snapshot + next target each), plus **Last session** with a conversation-style recap and **evidence** quotes. To re-seed after saving real data, remove the `english.growth.v1` key from localStorage (or disable `VITE_DEMO_SESSIONS`).

Notes:

- Vite proxies `/api/*` to `http://localhost:8787`.
- If TTS fails (or no key), the browser falls back to `speechSynthesis` when available.
- **Listening** now requests a clip script from `/api/listening/script` (LLM-based by level + duration, with local fallback). Transcription uses `WHISPER_API_KEY` (defaults to `OPENAI_API_KEY` if unset). TTS uses `TTS_API_KEY` or falls back to browser speech.
- **Conversation** (Path A): now uses豆包实时语音 WebSocket (`wss://openspeech.bytedance.com/api/v3/realtime/dialogue`) via backend bridge. Browser streams mic PCM to `/api/realtime`; backend forwards binary events (StartSession/TaskRequest/FinishSession) and streams model audio back in real time.
