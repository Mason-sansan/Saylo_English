# Snapshot: Draft_4.20_v1

- **Label**: `Draft_4.20_v1`
- **Created**: 2026-04-20 (local)
- **Workspace root**: `/Users/babyshark/Desktop/English learning`
- **Included paths**: `web/` (entire directory at snapshot time)
- **Archive**: `snapshots/Draft_4.20_v1.tar.gz`
- **SHA-256**: `abb582d0c4263d7915afaa5487d539846a4a4bc321ec1fbe76fba6531b71d903`

## Purpose

Pre-change checkpoint before implementing **C2 Quick Report + fallback B + G1 Growth tags**. Restore this archive if you want to roll `web/` back to this state.

## Restore (replace current `web/`)

From workspace root:

```bash
cd "/Users/babyshark/Desktop/English learning"

# Optional: keep a copy of current web before overwriting
mv web "web.backup.$(date +%Y%m%d-%H%M%S)"

tar -xzf "snapshots/Draft_4.20_v1.tar.gz"
```

Then reinstall deps if needed:

```bash
cd web && npm install
```

## Verify archive

```bash
shasum -a 256 "snapshots/Draft_4.20_v1.tar.gz"
# Expect: abb582d0c4263d7915afaa5487d539846a4a4bc321ec1fbe76fba6531b71d903
```
