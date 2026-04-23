# Office Hours (English) PRD v1

> 状态说明：本 PRD 基于当前代码实现整理，分为「已实现」与「待补充逻辑」两类，供你直接 review 和增改。

## 0) 文档约定：「当前实现」vs「产品目标」

为避免混淆，全文统一用语：

| 用语 | 含义 |
|------|------|
| **当前实现（代码）** | 仓库里已可运行的行为（`web/` + `voice-server/`）。 |
| **产品目标 / 目标方案** | PRD 中规划、但尚未全部落地的能力（模型动态素材、跨语言听力评分、Realtime、个性化 `end` prompt v2 等）。 |

**§4.2–4.3、§5.2–5.3** 中若小节标题写「目标方案」，表示以**愿景/架构**为主，不等同于当前每一行都已编码完成。具体差距见 **§12 实现差距快照**。

## 1) 产品概述

- **产品名**: Office Hours (English)
- **定位**: 面向英语学习者的高压短时训练工具，主打 `Listening` + `Conversation` 双路径训练，强调「短时输入 -> 输出 -> 反馈 -> 下次行动」闭环。
- **当前形态**: 本地 Web 应用（Vite 前端 + Node/Express voice server）。
- **核心价值**:
  - 用最短交互周期（3/10/20 分钟）完成一次可量化训练。
  - 从单次会话输出可执行的下一步（`Next target`）。
  - 用 `Growth` 页聚合历史趋势，提示下一次训练重点。

## 2) 目标用户与使用场景

## 2.1 目标用户（已实现可支撑）
- 希望提升职场/生活英语表达的用户。
- 需要“碎片化但有反馈”的学习者（3-20 分钟一轮）。

## 2.2 核心场景（已实现）
- **Listening 训练**: 听**英语**短语料后用 gist 总结（目标：允许**多语言**回答，便于无法开口说英语的用户练理解）。
- **Conversation 训练**: **英文口语**场景下的多轮语音对话（用户**仅使用英语**回应），结束后由模型 + 规则给出结构化分析与 Growth 更新。
- **Growth 复盘**: 查看本月变化、维度分值、历史会话证据，发起下一次聚焦训练。

## 2.3 待补充逻辑（你可补）
- 用户分层（学习目标、行业、考试/职场导向）及差异化路径。
- 新手引导/首次体验策略（首次 session 的目标与成功定义）。
- 连续使用机制（提醒、节奏计划、阶段目标）。

## 3) 信息架构（IA）

- **一级导航（已实现）**
  - `Home`
  - `Growth`
- **会话流（已实现）**
  - `Home -> Listening` 或 `Home -> Conversation`
  - 完成后自动进入 `Growth`
- **会话中导航（已实现）**
  - 隐藏底部 Tab，仅保留当前训练流程，减少分心。
- **Conversation（当前实现）**：前端仅 **`start` → 计时 → `end`**（与 Listening「播放中」同构的安静界面）；**不在此屏做** `upload`/`turn` 多轮交互。服务端仍初始化含开场白的 transcript；完整多轮口语应走 **GPT Realtime** 或后续在独立 UI 中接入 **`upload` + `turn`**（见 **§4.7**）。

## 4) 核心用户流程

## 4.1 Home 流程（已实现）
- 显示 `overall level` 与 `this month delta`。
- 选择时长：`3m / 10m / 20m`。
- 进入路径：
  - `Listening`: 听短片段并总结。
  - `Conversation`: **全英文**多轮语音对话并获取反馈（口语练习）。

## 4.2 Listening 流程（目标方案：统一模型语音接口）
- 阶段 0: `preflight`
  - 根据用户最近能力画像读取当前 `English Level`（模型评估结果，不再用纯规则分）。
  - 选择训练场景（v1: `life/work` 随机切换）。
- 阶段 1: `material generation`
  - 调用语音模型生成 `x 分钟` 听力素材（长度、语速、词汇密度、句法复杂度与当前 level 匹配）。
  - 素材与 level 匹配遵循 `i+1`（可理解输入略高于当前能力）原则。
- 阶段 2: `playing`
  - 统一通过语音模型接口播报（可由实时语音模型或 TTS 子接口完成）。
  - 倒计时、支持提前结束（Stop early）。
- 阶段 3: `recall`
  - 用户语音或文字总结（**允许多语言**，如中文；材料仍为英语），统一走转写 + **跨语言语义**评分链路。
- 阶段 4: `feedback + scoring`
  - 模型输出：gist 质量、信息覆盖（决策/原因/下一步）、语言维度表现、下一步动作。
  - 结果写入 Growth，并刷新用户能力画像。

## 4.3 Conversation 流程（目标方案：统一模型语音接口）
- 阶段 0: `preflight`
  - 读取用户当前能力画像（本次会话起点 level）。
  - 选择训练场景（v1: `life/work` 随机切换）。
- 阶段 1: `session bootstrap`
  - 调用语音模型生成开场问题与会话目标（按 level 控制难度；**助手侧全程英语**）。
- 阶段 2: `live dialogue`
  - 用户与模型进行 `x 分钟` **全英文**语音对话：用户轮次**仅接受英语产出**（口语练习定位）；模型按轮追问，保持单问题推进。
  - 追问难度与语速动态跟随用户表现，目标是保持在 `i+1` 区间。
  - **与 Listening 的分工**：Listening 允许母语总结以测「理解」；Conversation 强制英语以测「口头表达与互动」。
- 阶段 3: `analysis`
  - 在**英文转写全文**上，用与 Listening **同构**的思路做评估：**模型语义判断 + 规则校准**（见 **5.4.1a E)**），输出结构化报告（维度变化、证据引用、误区、next target）。
- 阶段 4: `feedback + growth writeback`
  - 展示反馈（维度变化、证据、next target），并更新 Growth 历史与能力画像。

## 4.4 Growth 流程（已实现）
- 展示：
  - 总分与本月变化。
  - 本月日历热度/次数。
  - 4 维能力条。
  - `Next focus` 卡片（根据最弱维度和月变化自动生成 CTA）。
  - 历史会话列表（可展开查看证据和扩展信息）。
- 一键从 Focus CTA 回到 Home 并启动对应模式。

## 4.5 待补充逻辑（你可补）
- Session 中断恢复策略（断网/刷新/关闭标签页）。
- 连续失败兜底（例如多次转写失败后的替代流程）。
- 会话内“最小成功标准”定义（什么时候算有效训练完成）。

## 4.6 能力评估流程（新增）
- **评估对象**
  - `Comprehension`（听懂并抓主线）
  - `ResponseFit`（回答是否贴题）
  - `VocabularyUse`（词汇精度和范围）
  - `SentenceControl`（句法稳定性与可理解性）
- **评估输入**
  - Listening: 英语素材文本 + 用户复述转写（**可多语言**）+ 时长/停顿等行为特征；评分侧以**跨语言语义对齐**为主（见 **5.4.1a B)**）。
  - Conversation: **全英文**对话转写 + 每轮问题-回答对齐结果；非英语轮次：**软提示（英文）+ 影响 `ResponseFit`**（见 **5.4.1a E)**）。
- **评估方法（v1 建议）**
  - 模型先做维度分项评分（0-5），再映射到 CEFR 档位（A2/B1/B2）。
  - 单次会话得分不直接覆盖用户档位，采用 `EMA` 平滑（例如最近 5 次加权）。
  - 若分数波动超过阈值，触发二次校验 prompt（避免一次异常输入导致等级跳变）。
- **理论依据（用于你后续补详细）**
  - 输入难度匹配：`Krashen i+1`（略高于当前能力）。
  - 任务难度控制：词频等级 + 句长 + 从句层级 + 语速四因子联合。
  - 等级稳定性：滚动窗口 + 置信区间，避免短期噪声。
- **评估输出**
  - `session_score`（会话即时）
  - `profile_level`（用户长期）
  - `dimension_deltas`（各维变化）
  - `next_material_band`（下次素材难度带）

## 4.7 Conversation：实时语音两条技术路径（澄清「录音」）

- **路径 A — ASR + Chat（后端已具备；前端 Conversation 主界面未接入）**  
  每一轮用户发言 = 麦克风采集一段音频 → **`/api/session/upload`**（Whisper）→ 文本 → **`/api/session/turn`**。**打分仍在会话结束后的 `end`**，依据完整 **transcript**。若产品上要在当前 App 内走该路径，需在 UI 上单独接好轮次，避免与「仅计时」的极简会话屏混用。

- **路径 B — GPT Realtime（产品目标）**  
  对话中为**连续音频流**，通常不再按「每轮一个 webm 文件」交互；会话结束后仍用 **transcript**（或会话日志）做 **`/api/session/end` 同类分析**。

- **共同点**：**结束后再打分**；差异在于**中间如何产生 User 文本**（转写流 vs 实时会话导出）。

## 5) 功能模块总表

## 5.1 训练入口模块（Home）
- **已实现**
  - 时长选择（3/10/20 分钟）。
  - 双路径入口（Listening/Conversation）。
  - 顶部等级信息展示。
- **待补充**
  - 动态推荐训练时长（按用户近 7 天行为）。
  - 个性化入口排序（按弱项或近期表现）。

## 5.2 Listening 引擎模块
- **已实现（当前代码）**
  - 场景库：work/life/travel；按日期决定 scene（非 PRD 所述 life/work 随机）。
  - 按时长裁剪脚本长度（2/3/5 句）。
  - 语音输入 → 转写 → **overlapScore（英英词重叠）**；会话内反馈另含锚点规则（**5.4.1a**）。
  - 反馈生成（Comprehension 为主 + 其余维度 na/轻提示）。
- **待补充（产品目标）**
  - 改为模型动态出题（按 level + 时长实时生成素材）。
  - 场景先收敛为 `work/life` 随机切换（v1）。
  - 难度控制器（词汇等级、句长、语速、信息密度）。
  - 评估从关键词匹配升级到语义理解 + 证据引用。
  - 重复尝试策略（一次 session 多次回答的记分逻辑）。

## 5.3 Conversation 引擎模块
- **已实现（当前代码）**
  - 会话生命周期管理：start/end。
  - **前端 `VoicePathA`**：仅 **连接会话 + 计时 + 结束**（与原先「安静播放页」一致）；**不在此屏调用** `upload` / `turn`。
  - 服务端仍提供 **`/api/session/upload`**、**`/api/session/turn`**，供后续 Realtime 或独立多轮 UI 使用。
  - 会后 report（snapshot/moved/held/evidence/nextTarget）；若 transcript 仅含开场白，报告信息量偏少。
  - AI 或 heuristic 追问在 **turn** 路径上生效（当前主流程不触发）。
- **待补充**
  - **多轮口语**：**GPT Realtime**，或单独页面/流程接入 **`upload` + `turn`**，避免破坏极简会话壳（见 **§4.7**）。
  - **英语-only 策略**：会话内语言检测、软提示与对 `ResponseFit` 的评分联动（与 **5.4.1a E)** 一致）。
  - 多轮上下文管理策略（超时、跑题、空回答）。
  - 对话目标控制（v1 先收敛为 work/life；后续扩展面试/旅行等）。
  - 安全/合规与内容边界（不可回答内容处理）。

## 5.4 Feedback 模块

### 5.4.1 统一 UI 壳（`ListeningFeedbackPanel`）
- **共用结构**
  - 区块 1：**Next to do** — 展示 `summaryNext`（见下「Next move 逻辑」）。
  - 区块 2：**总评** — 根据 `gistScore`（0–1）给出 verdict 文案 + 百分比。
  - 区块 3：**Dimension breakdown (full analysis)** — 四条维度行（Listening / Conversation 共用同一标题），每行含 pill（tone 标签）、headline、detail。
- **Listening vs Conversation 在壳上的差异（当前实现）**
  | 位置 | Listening | Conversation |
  |------|-----------|--------------|
  | 总评副标题 | `This listening check` | `This conversation check` |
  | 总评标题（三档） | Gist Is Clear / Partially Clear / Needs More Detail | Conversation Strong / Mixed / Needs Tighter Control |
  | 百分比标签 | `Comprehension {n}%` | `Conversation quality {n}%` |
  | 非 Comprehension 行 | 显示小字 `Not assessed in this listening card`（仅 listening） | 无此提示 |

### 5.4.1a 总评 `gistScore`（0–1）与「Comprehension % / Conversation quality %」

UI 把 `gistScore` 显示为 **0–100 的整数百分比**（`Math.round(gistScore * 100)`），再用同一阈值切三档总评：**≥0.45 → 偏强，≥0.25 → 中间，&lt;0.25 → 偏弱**（Listening / Conversation 共用阈值，文案不同）。

---

#### A) Listening：当前实现（代码：`overlapScore`）

- **用途**：单段复述时，`gistScore` = 对该段脚本算出的 `overlapScore(script, attempt)`；多段时取 attempts 分值的**算术平均**（当前产品多为单段）。
- **`overlapScore` 精确定义**（`web/src/lib/coach.ts`）：
  1. 从**脚本**取关键词：小写、去标点、按空格切词，去掉长度 &lt;4 的词，并去掉一批停用词（the, and, we, …）；按频次取前 **8** 个词，得到集合 `seg`。
  2. 从**用户复述**用同样规则取前 **16** 个关键词，得到集合 `att`。
  3. 统计 `att` 中有多少个词也出现在 `seg` 里，记为 `hit`。
  4. 得分：`hit / min(6, |seg|)`，再**截断到 [0, 1]**。
- **性质**：这是**词表重叠率**，不是语义相似度；同义改写、语序变化可能得分偏低。
- **与「多语言回答」的冲突（产品需注意）**：脚本为英文词时，若用户用**中文等其它语言**复述，英文关键词几乎不可能在 `att` 中命中，分数会系统性偏低。**当前实现未支持**「英听 + 母语/多语复述」的公平评估；要满足该目标，必须走 **B) 的模型语义对齐**，不能依赖 `overlapScore`。

#### B) Listening：目标（产品预期 — 模型语义 + 规则）

- **输入语言策略（v1 原则）**
  - **听力材料**：固定为**英语**（训练输入语言一致）。
  - **用户回答**：允许**多语言**（例如中文、英文或用户自选）。面向**暂时无法或不愿开口说英语**的学习者：仍可通过「听懂 → 用母语/任意语言总结含义」完成 comprehension 练习，降低表达门槛。
- **语义层**：由模型在**跨语言**条件下对「英文脚本要点」与「用户回答」做语义对齐（是否覆盖决策、原因、下一步、关键实体等），输出 **0–1 的 comprehension 分**或分项再合成；评估的是**理解是否到位**，不要求用户用词与原文同语言。
- **规则层**：保留可解释的硬规则作约束或校准（例如：要点覆盖 checklist、与锚点 Decision/Reason/NextAction 的一致性）；规则应基于**语义/结构化抽取**后的表示，而非英英词面重叠。
- **展示与文案**：总评与 Comprehension % 仍映射到同一套三档；可在 UI 上标明「可用母语总结」，避免用户误以为必须英文复述。与 Growth 维度对齐规则在实现时单独定稿。

---

#### C) Conversation：当前实现（代码：`buildConversationFeedback`）

1. 先为四个维度各算一个 **tone**：`good` | `warn` | `miss` | `neutral`（来自 `moved.delta` 阈值，或 `held`/默认 stable）。
2. 将 tone **映射为数值**（`scoreFromTone`）：
   - `good` → **1.0**
   - `warn` → **0.65**
   - `miss` → **0.25**
   - `neutral` → **0.5**
3. **`gistScore` = 四个数值的简单算术平均**（四维等权）。
4. 该分数再进入与 Listening **相同的三档阈值**（0.45 / 0.25），驱动总评标题与百分比条。

**设计含义（为何是这四档数值）**：把有序类别粗映射到 0–1 区间，使「四维平均」有可比性；**等权**表示当前产品假设四维对「本轮对话综合表现」同等重要。

#### D) Conversation：产品待定（若不想用固定映射 + 平均）

可选方向（需你拍板其一或组合）：

- **加权平均**（暂定，Comprehension / ResponseFit 权重大于 Vocabulary / SentenceControl），后续如发现问题再考虑其他方案。

#### E) Conversation：目标（产品预期 — 与 Listening **同构**的评估逻辑 + **仅英语**输出）

与 **5.4.1a B) Listening** 对齐：**语义层（模型）+ 规则层（可解释校准）** 共同决定四维判断与总评；差异在于 **Conversation 面向英文口语产出**，不做跨语言「理解即可」的豁免。

- **输出语言策略（v1 原则）**
  - **助手**：全程 **英语**（提问、追问、收束）。
  - **用户**：在对话场景中**只使用英语**（语音或文本输入均视为口语练习的一环）。产品定位是 **spoken English**，不是多语总结测理解。
  - **违规处理（v1 已定）**：若 ASR/检测发现用户**大量非英语**，只做**软提示**：助手用**英文**提醒（例如 *Please answer in English*），**不强制重试该轮**、不设单独标签。该条在评估上计入 **`ResponseFit`**：未按场景要求用英语完成回应，视为**贴题/任务约束**未满足，下调 `ResponseFit`（具体幅度由模型 + 规则在实现时定；「大量」的阈值可单独校准）。
- **语义层**：在**英文转写**上评估四维——是否听懂英文问题（Comprehension）、是否贴题（ResponseFit）、用词与搭配（VocabularyUse）、句子结构与连贯（SentenceControl）；证据引用仍以 transcript 中的 **User** 行为主。
- **规则层**：与 Listening 类似，用可解释约束校准模型（例如：是否答满双问题、是否含 claim-reason-example、禁用套话阈值等）；规则作用于**英文文本**，不依赖「英英词重叠」作为唯一信号。
- **总评合成**：可先沿用 **5.4.1a C)** 的 tone→数值→平均，或改用 **D)** 中某一方案；与 Listening 共用同一套 UI 三档阈值时，含义是「本轮英文对话综合表现」而非「听力理解」。
- **和 Listening 的一句话对照**：Listening = **听懂英语材料**（复述可多语）；Conversation = **用英语完成轮次**（产出必须英）。

---

### 5.4.2 反馈覆盖的四个维度（Growth model）
四条固定维度名（与 Growth 存盘一致）：
1. **Comprehension** — 听懂/抓住主线与关键信息（Listening 主评；Conversation 由报告中的 moved/held/stable 描述）。
2. **ResponseFit** — 回答是否贴题、是否覆盖问题约束；在 Conversation 中还包含**是否按口语练习要求用英语回应**（非英语且达触发阈值时见 **5.4.1a E)**）（**仅 Conversation 在本轮有实质评估**；Listening 卡上为 `na` 或说明性文案）。
3. **VocabularyUse** — 用词准确度与搭配（**仅 Conversation** 为主；Listening 里仅可能给 `quickCorrections` 的轻量提示，标为 optional）。
4. **SentenceControl** — 句子结构、清晰度、多轮压力下是否散（**仅 Conversation** 为主；Listening 里仅可能对「两句/一句」形状给 neutral 提示）。

### 5.4.3 Listening：衡量什么、怎么展示
- **多语言回答（产品目标）**：听力材料为英语时，用户仍可用**中文等任意语言**做总结（见 **5.4.1a B)**）。当前实现里锚点比对与 `overlapScore` 偏英英词面；落地多语言后，Comprehension 与「缺哪类信息」应以**跨语言语义**为准。
- **会话内即时反馈（`buildListeningFeedback`，含 script + attempt）**
  - **Comprehension**：结合 `gistScore` + 脚本锚点（Decision / Reason / NextAction）与复述的重叠度，判断 missing/vague/got；headline/detail 会点名缺哪类信息。
  - **ResponseFit / VocabularyUse**：默认 **na**（标明在 Conversation 评）；若命中 `quickCorrections` 规则，Vocabulary 可为 **neutral** 给一条替换建议。
  - **SentenceControl**：按句数与词数启发式，可能为 **neutral**（建议拆成两句）或 **na**。
  - **summaryNext（Next move）**：由锚点覆盖情况决定优先级 —— 优先补 **Next action**，其次 **Reason**，再 **Decision**，否则压缩为两句模板；格式为 `{title} Use: {template}`。
- **结束写入 Growth / 历史卡片的简化版（`buildListeningFeedbackFromAttempts`）**
  - 仅用 attempts 的 **平均分** 驱动 Comprehension 三档文案；其余三维一律 **na**（「Not assessed in this Listening card」）。
  - **原因**：历史列表与 Growth 回放走轻量结构，避免存完整 script；若产品要求历史与当次屏一致，需存 `SessionFeedbackPayload` 全量或锚点摘要。
- **Listening 用户在屏上应理解的优先级**
  - 先看 **Comprehension %** 与 **Next to do**（可执行下一步）。
  - 再看四维表：除 Comprehension 外多为「本模式不测」或轻提示，避免误以为四维都已打分进 Growth。

### 5.4.4 Conversation：衡量什么、怎么展示
- **产品目标（评估逻辑）**：与 Listening 一样走向 **模型语义 + 规则**（见 **5.4.1a E)**）；当前代码仍为「报告 JSON → 映射 tone → 总评平均」路径（**5.4.1a C)**）。
- **语言**：用户轮次**仅英语**；反馈与证据引用均基于**英文对话**语境。
- **数据来源**：会话结束后 `VoiceReport`（`moved` / `held` / `evidence` / `nextTarget`），经 `buildConversationFeedback` 转成四维行。
- **每维展示逻辑**
  - 若该维在 **moved**：展示 `±delta` 与 reason；tone 由 delta 阈值映射（如 ≥0.08 → good，≤-0.08 → miss 等）。
  - 若该维在 **held**：tone **neutral**，说明本维未漂移。
  - 若既无 moved 也无 held：**neutral**，「Stable in this session」类文案。
  - **Evidence**：若该维有 evidence，detail 中带 `quote` + `note`；否则为通用说明。
- **总评百分比**：见 **5.4.1a C)** — 四维 tone → 数值 → **等权算术平均** 得到 `gistScore`，体现「整段对话综合表现」，不是单独听力理解分。
- **summaryNext（Next move）**：优先用模型返回的 `report.nextTarget`；缺省为固定句：`Next: answer with claim -> reason -> one concrete example.`

### 5.4.5 「Next move / Next to do」：生成逻辑、模型输入与输出格式

#### 1) 当前实现（代码级，偏**确定性**）

| 模式 | UI 字段 | 写入 Growth / 历史的字段 | 来源 |
|------|---------|---------------------------|------|
| Listening（会话内反馈屏） | `summaryNext` | 同次若存 `feedback.session.summaryNext` 则一致 | `sessionFeedback.nextMoveFromStatuses`：**规则优先级** — 先看锚点 **NextAction** 是否 missing/vague，再看 **Reason**，再看 **Decision**；命中则生成固定英文 `title` + 填空 `template`，拼接为 `{title} Use: {template}` |
| Listening（收尾 `onDone`） | — | `nextTarget` | 前端写死默认句：`Next: summarize as decision + reason + next action in two sentences.`（与即时 `summaryNext` 可能不一致，除非后续改为同一来源） |
| Listening（仅 attempts 的简化回放） | — | `nextTarget` 可选 | `buildListeningFeedbackFromAttempts`：无自定义时用同上默认句 |
| Conversation（反馈屏） | `summaryNext` | `report.nextTarget` + 映射后的 `feedback` | **`/api/session/end` 返回的 JSON** 中的字符串字段 `nextTarget`；前端缺省：`Next: answer with claim -> reason -> one concrete example.` |

**小结**：Listening 的「下一步」在 v0 主要是 **规则模板**；Conversation 的 `nextTarget` 在 **有 API Key** 时由 **模型** 与其它报告字段**同一次 JSON** 产出（见下「模型 prompt」）。

---

#### 2) Conversation：当前模型如何被要求输出 `nextTarget`（已实现，`web/voice-server/server.js`）

会话结束时，模型收到 **system + user** 指令，要求**只输出严格 JSON**（无 markdown）。其中 **`nextTarget` 为同一 JSON 的键之一**，与 `snapshot`、`moved`、`held`、`evidence` 一并生成。

- **System（摘要）**：要求 strict JSON only、语气冷静精确、不空洞表扬、允许引用用户原话作 evidence。
- **User（摘要）**：要求分析「本次」英语练习对话，产出包含下列键的 JSON：  
  `snapshot`, `moved[]`, `held[]`, `evidence[]`, **`nextTarget`**；并约束：四维名、`delta` 枚举、evidence 条数、quote 须来自 transcript 中 User 行等。

**当前缺口（相对你的产品预期）**：prompt **未传入**「历次表现 / Growth 历史 / 用户弱项摘要」——因此今天的 `nextTarget` 本质上是 **单会话 transcript 条件**下的下一步建议，不是长期个性化总结。

**附录（便于对齐实现）**：`server.js` 里 **user** 侧指令字面要求如下（与代码一致时可逐字复现）：

```
Analyze this English practice dialogue and produce JSON with keys:
{snapshot:string, moved:Array<{dimension:string,delta:number,reason:string}>,
held:Array<{dimension:string,reason:string}>,
evidence:Array<{dimension:string,quote:string,note:string}>, nextTarget:string}.
Dimensions must be one of: Comprehension, ResponseFit, VocabularyUse, SentenceControl.
delta must be one of -0.1, 0, 0.1. Keep evidence length <= 4 items.
Quote must be short excerpts copied from the transcript User lines.

Transcript:
${transcript}
```

（**system** 侧另要求：只输出 strict JSON、无 markdown、语气冷静、无空洞表扬、允许引用用户短句作 evidence。）

---

#### 3) Listening：目标方案——模型生成 `nextTarget` / `summaryNext`（与历次表现相关）

**产品预期**：「下一步」由模型根据 **本次理解表现 + 可选历史** 生成，**措辞不完全可控**，但需 **可解析、可质检**。

**建议输入上下文（拼进单次评估 prompt）**

| 信息块 | 说明 |
|--------|------|
| 本次 | 英语脚本要点（或结构化要点）、用户复述转写、Comprehension 分项、锚点覆盖结论 |
| 用户画像 | 当前 level、四维分或弱项标签 |
| 历史（可选） | 最近 `k` 条同模式 session 的 `snapshot` + `nextTarget` 或短摘要（避免塞全文） |

**建议对模型的硬性要求（与 Conversation 对齐风格）**

- 输出仍为 **严格 JSON**（或至少 `nextTarget` 为独立字段），便于校验与降级。
- `nextTarget`：**一句**、可执行、**英文**（或与产品统一反馈语言一致）、长度上限（如 ≤240 字符）。
- 内容聚焦：**下一次**具体练什么（而非重复本次摘要）；若引用历史，需显式「延续上次未稳住的点」类表述（由模型生成，规则可后验检查关键词）。

**落地位置（建议）**：新增或扩展 **`/api/listening/evaluate`**（或与统一 `/api/session/evaluate` 合并），与前端「会话结束」对齐；当前前端 Listening **未**走该接口时，仍保留规则 `nextMoveFromStatuses` 作降级。

---

#### 4) Conversation：目标方案——在现有 `end` 报告上增强 `nextTarget`

- **保留**现有 JSON 外壳（`nextTarget` 仍为 `string`），避免 UI 大改。
- **扩展 user prompt**：在 `Transcript` 之外追加 `User profile summary`、`Recent session summaries (k)`，并明确要求：`nextTarget` 必须结合 **本轮证据 + 弱项 + 与历史一致的递进**。
- **可控性**：模型输出仍非 100% 可控；用 **JSON schema 校验 + 长度截断 + 缺省回退句** 保证体验不破。

---

#### 5) 输出格式（约定）

| 层级 | 字段 | 类型 | 说明 |
|------|------|------|------|
| 协议（当前 Conversation） | `report.nextTarget` | `string` | 与 `VoiceReport` 一致；UI 映射为 `SessionFeedbackPayload.summaryNext` |
| 协议（Listening 目标） | `nextTarget` 或 `session.summaryNext` | `string` | 与上同，便于 Growth / Last session 统一存 |
| 可选扩展（分析用） | `nextTarget_rationale` 或 `focus_dimension` | `string` / `enum` | 不展示给用户或次要展示，用于调试与 A/B |

---

#### 6) Prompt 草案（v2，可直接贴进 `voice-server` 或统一 evaluate 服务）

以下为 **英文** 指令模板（与现有 `server.js` 风格一致，便于直接接入 Chat Completions）。占位符由服务端拼接：`${...}` 表示运行时注入。

##### 6.1 Conversation：`POST /api/session/end` 增强版（ transcript + 画像 + 近期会话）

**System**

```
You output strict JSON only. No markdown.
Tone: calm, precise, non-generic. No praise.
The user allows quoting short user excerpts as evidence. Quotes must be short lines copied from User: turns in the transcript.

You may receive USER PROFILE and RECENT SESSION SUMMARIES. Use them only to make analysis and nextTarget progressive and non-repetitive. If a block is empty, rely on the current transcript only.

Rules for nextTarget:
- One English sentence, max 240 characters.
- Must be the single most actionable practice step for the NEXT session.
- Ground it in evidence from THIS transcript; when profile or history indicates a recurring weak dimension, align the advice (do not name internal dimension codes to the user—write plain coaching language).
```

**User**

```
USER PROFILE (JSON; omit fields if unknown):
${userProfileJson}

RECENT CONVERSATION SESSIONS (newest first; max ${k} entries). Each entry: ISO date, one-line summary of what happened, previous nextTarget if available:
${recentSessionsText}

CURRENT TRANSCRIPT (Assistant/User lines):
${transcript}

Analyze this English practice dialogue. Produce JSON with exactly these keys:
{
  "snapshot": string,
  "moved": Array<{ "dimension": string, "delta": number, "reason": string }>,
  "held": Array<{ "dimension": string, "reason": string }>,
  "evidence": Array<{ "dimension": string, "quote": string, "note": string }>,
  "nextTarget": string
}

Constraints:
- dimension must be one of: Comprehension, ResponseFit, VocabularyUse, SentenceControl.
- delta must be one of: -0.1, 0, 0.1.
- evidence: at most 4 items; quote must be from User lines only.
- nextTarget must follow the System rules above.
```

**`userProfileJson` 建议最小字段**（与 Growth 对齐，由服务端从 `english.growth.v1` 等序列化）：

```json
{
  "overall": 2.7,
  "level": "B1",
  "dimensions": { "Comprehension": 2.8, "ResponseFit": 2.5, "VocabularyUse": 2.6, "SentenceControl": 2.7 },
  "weakest_dimension": "ResponseFit"
}
```

**`recentSessionsText` 建议格式**（每行一条，便于模型扫读）：

```
2026-04-16 | Mixed performance under follow-up pressure | Next: answer with claim -> reason -> one concrete example.
2026-04-14 | ...
```

---

##### 6.2 Listening：建议 `POST /api/listening/evaluate`（本次材料 + 复述 + 可选历史）

**System**

```
You output strict JSON only. No markdown.
The listening script was in English. The user's recap may be English or another language—evaluate comprehension by semantic alignment to the key points, not by word overlap with the script.

Tone: calm, precise, no empty praise.

You may receive USER PROFILE and RECENT LISTENING SESSIONS. Use them only to make nextTarget specific and progressive.

Rules for nextTarget:
- One English sentence, max 240 characters.
- Describe what to do in the NEXT listening/recall attempt (not a repeat of the script summary alone).
```

**User**

```
KEY POINTS (from the English script; structured):
${keyPointsJson}

USER RECAP (verbatim transcription):
${userRecap}

OPTIONAL SIGNALS (from rules engine; may be empty):
${anchorSignalsJson}

USER PROFILE (JSON):
${userProfileJson}

RECENT LISTENING SESSIONS (newest first; max ${k}):
${recentSessionsText}

Produce JSON with exactly these keys:
{
  "comprehension_score": number,
  "snapshot": string,
  "nextTarget": string
}

Constraints:
- comprehension_score must be between 0 and 1 inclusive.
- snapshot: one or two sentences on what the user demonstrated this attempt.
- nextTarget: follow the System rules; must be in English.
```

**`keyPointsJson` 建议**（可由脚本解析或模型预处理生成）：

```json
{
  "decision": "short phrase or sentence",
  "reason": "short phrase or sentence",
  "next_action": "short phrase or sentence",
  "entities": ["optional", "key", "names"]
}
```

**`anchorSignalsJson` 建议**（来自现有规则层，可为空对象）：

```json
{ "decision": "got|vague|missing", "reason": "got|vague|missing", "next_action": "got|vague|missing" }
```

---

##### 6.3 校验与降级（两端共用）

- **解析**：对模型返回做 `JSON.parse`；失败则回退到当前 **heuristic** 或固定 `nextTarget` 默认句。
- **长度**：对 `nextTarget` 做 `slice(0, 240)`；可选拒绝含换行。
- **schema**：可选引入 zod / JSON Schema 校验 `dimension`、`delta` 枚举后再写入 `VoiceReport`。

---

### 5.4.6 待补充（产品向）
- 个性化反馈语言（按用户常见错误、风格偏好）。
- 历史对比反馈（本次 vs 上次同模式）。
- Listening 历史卡与当次反馈一致性（是否持久化完整四维或仅 Comprehension）。
- 模型评估落地后：Listening 四维是否升级为「全维可评」及与 Growth 条目的对齐规则。
- Conversation **非英语轮次**的「大量」判定阈值（与软提示触发一致）；`ResponseFit` 下调幅度与是否累计多轮（与 **5.4.1a E)** 联动）。

## 5.5 Growth 模块
- **已实现**
  - 本地持久化（localStorage）。
  - 总分与维度分值（1.0-5.0）。
  - 历史记录（最多保留 30 条）。
  - Focus 计划生成（buildFocusPlan）。
- **待补充**
  - 趋势分析升级（周/月多粒度 + 异常波动解释）。
  - 成长目标系统（阶段目标、达成率、提醒机制）。
  - 数据导出/同步（跨设备、账号体系）。

## 5.6 语音与模型服务模块（voice-server）
- **已实现**
  - `/api/session/start`
  - `/api/session/upload` (Whisper 转写)
  - `/api/session/turn` (聊天追问)
  - `/api/session/end` (结构化报告生成)
  - `/api/tts` (文本转语音)
  - 缺 key 的 graceful fallback（heuristic reply/report）
- **待补充**
  - 将 **`/api/session/end`** 的 prompt 升级为 **5.4.5 节 6.1**（画像 + 近期会话）；Listening 侧实现 **5.4.5 节 6.2** 对应路由。
  - 增加统一编排接口（建议）：`/api/session/init`、`/api/session/live`、`/api/session/evaluate`。
  - 统一模型路由（素材生成、实时对话、转写、评分使用同一 provider 管理）。
  - 会话并发与资源回收策略（长会话、异常退出）。
  - 接口级鉴权、限流、审计日志。
  - 模型调用错误分类与告警。

## 5.7 模型策略建议（新增）
- **主路径（推荐）**
  - 实时语音对话：`GPT-4o Realtime`（低延迟双向语音）。
  - 结构化评估与反馈：`GPT-4.1 mini`（成本更稳，结构化 JSON 约束更好）。
  - 转写：`Whisper` 或同 provider 语音识别接口（按成本/延迟切换）。
- **备选路径**
  - 若实时语音成本高：会话层先用 ASR + 文本模型 + TTS 级联。
  - 若弱网：降级到“录音分段上传 + 回合制反馈”。

## 6) 数据模型（当前实现）

## 6.1 核心维度
- `Comprehension`
- `ResponseFit`
- `VocabularyUse`
- `SentenceControl`

## 6.2 GrowthStateV1
- `version: 1`
- `overall: number (1.0-5.0)`
- `dimensions: Record<Dimension, number>`
- `history: HistoryEntryV1[]`

## 6.3 SessionCardPayload / HistoryEntryV1
- `mode: listening | conversation`
- `snapshot: string`
- `nextTarget?: string`
- `report?`（conversation 结构化报告）
- `listening?`（attempts 列表）
- `feedback?`（统一反馈结构）
- `minutes?`
- `overallDelta?`

## 6.4 持久化
- `english.growth.v1`
- `english.last-session.v1`

## 6.5 待补充逻辑（你可补）
- 数据版本迁移策略（v1 -> v2）。
- 指标埋点模型（事件命名、漏斗定义、A/B 字段）。
- 隐私与数据生命周期策略（保留期限、删除机制）。

## 7) 评分与升级逻辑

### 7.0 当前代码（已实现）

- **Listening**
  - 使用 `overlapScore`（**英英词重叠**，见 **5.4.1a A)**）计算 gist 分；**与 PRD「多语言复述 + 模型语义」目标不一致**，母语复述会系统性偏低。
  - `avg >= 0.55`: Comprehension +0.1；`avg <= 0.25`: Comprehension -0.1；否则 0。
- **Conversation**
  - 从 `report.moved` 读取维度增减，单维 delta clamp 到 `[-0.1, +0.1]`；无 moved 则 Growth 本条不加分。
- **全局**
  - `overall = 4 维均值`，保留 1 位小数；`history` 最多保留 30 条。

### 7.1 产品目标（与 §4.6 对齐，尚未全量实现）

- 模型分项、EMA、抗抖、二次校验、`profile_level` 与 **§4.6** 一致时，再替换或并行于 **7.0** 的简单规则。

## 7.2 待补充逻辑（你可补）
- 升降分抗抖策略（冷却时间、平滑窗口）。
- 模式差异权重（Listening 与 Conversation 对 overall 的权重）。
- 异常分值校正（短时极端输入导致的大幅波动保护）。

## 8) API 清单（当前 voice-server）

## 8.1 `POST /api/session/start`
- 输入: `level`, `topic`
- 输出: `sessionId`, `opening`
- 作用: 初始化会话并创建 transcript。

## 8.2 `POST /api/session/upload`
- 输入: `audio` 文件
- 输出: `text`（转写文本） + `raw`
- 作用: Whisper 转写音频。

## 8.3 `POST /api/session/turn`
- 输入: `sessionId`, `userText`
- 输出: `assistant`, `turn`
- 作用: 生成下一轮追问。

## 8.4 `POST /api/session/end`
- **输入（当前实现）**: `sessionId`
- **输出**: `transcript`, `report`（含 `nextTarget` 等，见 **5.4.5**）
- **作用**: 结束会话并给出结构化评估。
- **输入（产品目标 / v2）**: 在 `sessionId` 之外可选 `userProfileJson`、`recentSessionsText`（或 `k`），用于个性化 `nextTarget` 与报告，见 **5.4.5 节 6.1**（**尚未在 `server.js` 接入**）。

## 8.5 `POST /api/tts`
- 输入: `text`
- 输出: `audio/mpeg`
- 作用: 合成播报音频。

## 8.6 `POST /api/listening/evaluate`（**未实现**；见 **5.4.5 节 6.2**）

- **预期作用**: 在听力复述完成后，用模型对「英文要点 + 多语言复述」做语义评分，返回 `comprehension_score`、`snapshot`、`nextTarget`（及后续与 Growth 对齐的字段）。
- **现状**: 前端仍用本地 `overlapScore` + 规则；需新增路由并与 Vite 代理对齐。

## 8.7 待补充逻辑（你可补）
- API 错误码标准化（业务码 + 可观测字段）。
- 接口 SLA 定义（超时阈值、降级链路）。
- 风险控制（重复请求、重放、防滥用）。

## 9) 非功能需求（建议版）

## 9.1 已体现
- 本地离线可查看历史（localStorage）。
- 无 key 场景可退化为 heuristic，不完全阻断体验。

## 9.2 待补充（建议你 review 决策）
- 性能:
  - 关键交互首屏与会话切换时延目标。
- 可用性:
  - 麦克风权限拒绝时的完整替代流程。
- 可观测:
  - 前后端日志、错误聚合、会话成功率指标。
- 安全:
  - API 鉴权、用户数据隔离、输入安全审查。

## 10) 里程碑建议（用于后续排期）

- **M1（当前）**: 双路径训练 + 基础反馈 + Growth 闭环；Conversation 为 **计时 + 结束** 的轻量会话壳（见 **§5.3**）。
- **M2**: 评分稳健化 + 个性化 `end` / `listening/evaluate` + 错误恢复（建议优先）。
- **M3**: 用户系统 + 云端同步 + 目标管理。
- **M4**: 自适应课程编排 + 教练策略引擎。

## 11) 打开给你补充的重点清单

- 用户分层与核心任务定义（谁最值得先服务）。
- 评分策略（稳定性、公平性、可解释性）。
- 训练内容生产机制（场景、难度、话题覆盖）。
- 会话中断与失败兜底规范。
- 数据与隐私规范（长期可运营前置条件）。
- 商业化或长期留存机制（如目标计划、周报、订阅）。

## 12) 实现差距快照（二次 review，便于对齐代码）

| 主题 | 当前实现 | PRD 目标 | 优先级 |
|------|----------|----------|--------|
| Conversation 多轮 | **未接入主 UI**；后端有 `upload`/`turn` | Realtime 或独立多轮 UI | P1 |
| `session/end` 个性化 | 仅 `sessionId` | profile + 近期会话（**5.4.5 §6.1**） | P1 |
| Listening 评分 | `overlapScore`（英英） | 跨语言语义 + `/api/listening/evaluate` | P1 |
| 听力素材 | 本地 scene 库 | 模型按 level/时长生成 | P2 |
| 英语-only | 未做检测 | 软提示 + `ResponseFit`（**5.4.1a E)**） | P2 |
| 用户画像 EMA | 未实现 | **§4.6 / §7.1** | P2 |
| 账号与同步 | localStorage | 云端 | P3 |

**本次已修正的文档问题**：补充 **§0** 约定；**§4.7** 澄清录音/Realtime；**§7** 区分当前代码与产品目标；**§8** 标注 `end` v2 与 `listening/evaluate`；**§5.3** / **§10** 与 **Conversation 极简 UI** 对齐。

**说明（Conversation UI）**：曾尝试在 `VoicePathA` 内嵌持麦多轮，布局与体验与产品预期冲突，已**恢复为仅 orb + 计时 + 结束**；多轮能力仍以 **Realtime 或后续独立交互** 为准（见 **§4.7**）。

