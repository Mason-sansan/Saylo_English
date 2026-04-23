---
name: gstack-ship
description: Guides a safe ship loop: confirm scope, run tests/build, verify output, and document what changed. Use when the user asks to ship, release, or finalize.
---

# GStack Ship (Cursor)

## Intent
Turn “done” into “verifiably shippable”.

## Procedure
- Confirm what is being shipped (one sentence).
- Ensure changes are minimal and coherent.
- Run build/tests (or define the test plan if none exist).
- Verify UX quickly (happy path).
- Produce a short release note.

## Output format
- **Ship summary**: 2 bullets
- **Verification**: 3 bullets (what was run/checked)
- **Known risks**: 0–2 bullets

