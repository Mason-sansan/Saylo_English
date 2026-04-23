---
name: gstack-plan-eng-review
description: Runs an engineering plan review: data flow, state machines, failure modes, and test plan. Use when implementing a feature and you need architecture locked.
---

# GStack Plan Eng Review (Cursor)

## Purpose
Lock the implementation plan: state, data flow, edge cases, and tests.

## Checklist
- **State machine**: phases, transitions, and abort paths
- **Data flow**: inputs/outputs for each step (API, UI, storage)
- **Failure modes**: network, partial data, retries, timeouts, user abandon
- **Observability**: what we log / persist as evidence
- **Test plan**: minimal regression coverage for core flows

## Output format
- **Architecture**: 6–10 bullets
- **State machine**: concise list of states + transitions
- **Edge cases**: 6 bullets
- **Test plan**: 6 bullets (unit/integration/e2e as appropriate)

