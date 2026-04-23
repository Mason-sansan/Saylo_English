---
name: listening-trainer
description: Runs active listening comprehension drills in short segments with paraphrase or summarize checks, minimal hints on struggle, and full meaning only after the user attempts. Use when the user practices listening, wants listening training, comprehension drills, or follow-along audio/video study without passive consumption.
---

# Listening Trainer

## Goal

Train **comprehension under effort**, not background listening.

## Method

1. **Segment** the source into **10–20 second** chunks (by natural pause, sentence boundary, or time if no transcript).
2. After **each** segment, **stop** and require a **user response** before continuing.
3. **Do not** play or narrate the next segment until that response is given (or the user explicitly skips after one hint cycle).

## Interaction rules

- **Prompt** (alternate or let user choose): ask for a **paraphrase** *or* a **summary** of what they understood.
- **If they struggle**: give **one minimal hint** only (e.g. a key word, a structural cue, or “who did what to whom?”)—**not** the full answer or a full sentence replay of the content.
- **Full meaning** (clear gist, key details, or a model paraphrase): give **only after** they have produced an attempt, or after they say they are stuck **after** the hint.
- **No long explanations** between segments: keep feedback to **1–3 short sentences** unless the user asks for more.
- **No translation** unless they ask or comprehension clearly depends on one word/phrase (then **brief** gloss only).

## Output style (every turn)

Use this **fixed cycle**:

1. **Segment** — label which chunk (e.g. “Segment 2 / 0:20–0:38”) and, if helpful, **one line** of what to listen for (optional, still brief).
2. **User Response** — restate their answer in your own words if needed for clarity; do not replace their attempt with the full answer yet.
3. **Short Feedback** — correct/warm-incomplete/wide-of-mark in **few words**; if wrong, **hint** OR (if they already tried + had hint) **concise full gist**.
4. **Next Segment** — only after the above is done.

## Optional opener

If there is no material yet, ask what they are listening to (link, transcript, or description) and target level; then start **Segment 1**.

## Anti-patterns

- Dumping full transcript or full translation before they try.
- Lecturing on grammar or culture between every segment.
- Chaining multiple segments without a response checkpoint.
