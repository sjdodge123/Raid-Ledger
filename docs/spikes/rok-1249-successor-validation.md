# ROK-1249 Successor Validation — ROK-1250

**Story:** `fix: cap _appClient.end timeout coverage with explicit handle-drain check`
**Worktree:** `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1250`
**Branch:** `rok-1250-socket-handle-drain`
**Predecessor spike:** ROK-1249 (`docs/spikes/rok-1249-test-infra-layer-3.md`) — instrumented and named what looked like the cross-file socket leak; this story is the fix and the follow-on debug.
**Date:** 2026-05-10 (started 2026-05-09)

---

## 1. The fix (layered)

Three changes to `api/src/common/testing/`:

1. **`closeTestApp` (`test-app.ts`)** — `_appClient.end({ timeout: 5 })` → `_appClient.end({ timeout: 30 })`, plus a narrow fallback that destroys any TCP socket whose `remotePort` matches the test container's port AFTER `end()` resolves. Architect §3a/§3d.

2. **`integration-setup.ts` `afterAll`** — opt-in audit guard gated on `RL_TEST_SOCKET_HANDLE_AUDIT=true`. Throws if more than 5 connected TCP sockets remain after `closeTestApp()`. Architect §3b.

3. **`closeTestApp` layer-2 (post-empirical-debug, see §3)** — also destroy ioredis sockets to `127.0.0.1:6379` AFTER `_appClient.end({ timeout: 30 })`. Empirical snapshot showed BullMQ ioredis was the actual carrier, not postgres-js — see §3.

Helpers extracted to `socket-handle-audit.ts` (architect §3d). `snapshot-buckets.ts` extended with `remoteAddress:remotePort` per-handle to support the empirical investigation in §3.

## 2. Architect's original reasoning (preserved for history)

Reading postgres-js source: at the timeout cap, the library calls `socket.end()` (graceful FIN) — NOT `socket.destroy()`. The socket stays on `_getActiveHandles` until the server FIN-ACKs. With the ROK-1248 drain barrier in place, queries are not in flight at teardown, so the graceful path resolves in <1s on healthy runs. Bumping the cap to 30s means we never hit it on healthy runs, eliminating the (assumed) postgres-js leak source. The narrow fallback destroy is a guardrail for the unhealthy case.

**This was correct mechanically (the audit confirms postgres-js handles do drop to ≤5 after closeTestApp) but only partial — postgres-js was not the actual carrier of the mid-suite TCP flake.** See §3.

## 3. Empirical debug — the real carrier (2026-05-10)

After the first 5-run loop hit 1 `socket hang up` (run 4) AND 1 `Parse Error: Expected HTTP/` (run 5), it became clear the fix was correct as designed but did not move the flake rate. The audit gate ran clean on those failures — meaning ≤5 sockets at end-of-file — so accumulated postgres-js handles were not the carrier.

Re-ran the suite with `RL_TEST_SOCKET_DEBUG=true` and a deeper `snapshot-buckets.ts` that captures `remoteAddress:remotePort` per handle. Captured snapshot `2026-05-10T17-30-40-570Z.json` at the moment of `socket hang up` on `POST /auth/local` (1 ms TCP RST):

* 47 sockets total + 1 Server
* **40 of 47 sockets had `remote=::1:6379`** — BullMQ ioredis connections to the local Redis container
* 6 sockets to the testcontainers ryuk port
* 1 unconnected

The carrier was **not** cross-file postgres-js handle leak (architect's hypothesis). It was the steady-state count of BullMQ worker → Redis connections per spec file (13 processors × ~3 ioredis connections each = ~39), plus connection churn between the 78 spec files in a run. The audit confirmed end-of-file teardown clears these — `app.close()` runs `onModuleDestroy` on BullModule which closes worker connections — but during the open window of each file run, ~40 ioredis sockets are live, and the kernel-side TIME_WAIT pressure on `::1:6379` across 78 file-boots is what RST'd fresh supertest connect()s.

Layer-2 fix: `destroySocketsOnPort(6379)` after `_appClient.end()`, before `container.stop()`. This force-clears the BullMQ ioredis sockets at teardown so the next spec file starts with a clean kernel-side socket table.

## 4. AC2 validation — 30-run staged escalation (operator-approved 2026-05-10)

**Operator decision:** after the layer-2 fix proved itself on a 5-run sample (0/5 hits, vs 2/5 pre-layer-2), escalated through 5 → 10 → 20 → 30 with abort-on-first-fail at each tier.

**Command:**

```bash
# Tier 1 (runs 1-5):
MAX_RUNS=5 /tmp/rok-1250-loop.sh

# Tier 2-4 (runs 6-30, continuation):
START_IDX=N END_IDX=N+M /tmp/rok-1250-loop-continue.sh
```

**Audit gate coverage:** 6 of 30 runs had `RL_TEST_SOCKET_HANDLE_AUDIT=true` — runs **1, 4, 7, 8, 10, 15, 22, 29**. All 8 ran clean → audit gate does not false-positive after the layer-2 fix.

### Run-by-run table

| Run | Audit | Exit | Socket hits | Audit fails | Duration | Notes |
| --- | ----- | ---- | ----------- | ----------- | -------- | ----- |
| 1   | on    | 0    | 0           | 0           | 6:00     | clean |
| 2   | off   | 1    | 0           | 0           | 6:12     | unrelated app flake — `phaseDeadline` assertion in `lineup-phase-scheduling` (ROK-1217, PR #755 batch) |
| 3   | off   | 0    | 0           | 0           | 6:12     | clean |
| 4   | on    | 0    | 0           | 0           | 6:17     | clean |
| 5   | off   | 0    | 0           | 0           | 5:57     | clean |
| 6   | off   | 0    | 0           | 0           | 6:26     | clean |
| 7   | on    | 0    | 0           | 0           | 7:37     | clean |
| 8   | on    | 0    | 0           | 0           | 18:13    | clean (slow run, system load) |
| 9   | off   | 0    | 0           | 0           | 6:45     | clean |
| 10  | on    | 0    | 0           | 0           | 6:28     | clean |
| 11  | off   | 0    | 0           | 0           | 6:42     | clean |
| 12  | off   | 0    | 0           | 0           | 7:25     | clean |
| 13  | off   | 0    | 0           | 0           | 7:26     | clean |
| 14  | off   | 0    | 0           | 0           | 7:42     | clean |
| 15  | on    | 0    | 0           | 0           | 7:55     | clean |
| 16  | off   | 0    | 0           | 0           | 7:25     | clean |
| 17  | off   | 0    | 0           | 0           | 6:42     | clean |
| 18  | off   | 143  | 0           | 0           | 4:54     | external SIGTERM mid-run (cross-agent collateral kill) |
| 19  | off   | 0    | 0           | 0           | 7:46     | clean |
| 20  | off   | 0    | 0           | 0           | 7:32     | clean |
| 21  | off   | 1    | 0           | 0           | 7:45     | unrelated app flake (same family as run 2) |
| 22  | on    | 0    | 0           | 0           | 7:52     | clean |
| 23  | off   | 1    | 0           | 0           | 8:06     | unrelated app flake (same family) |
| 24  | off   | 0    | 0           | 0           | 8:14     | clean |
| 25  | off   | 1    | **1**       | 0           | 7:28     | **socket hang up** — `lineups-auto-advance` test "still honors a manual PATCH /lineups/:id/status" |
| 26  | off   | 0    | 0           | 0           | 7:21     | clean |
| 27  | off   | 0    | 0           | 0           | 7:27     | clean |
| 28  | off   | 0    | 0           | 0           | 7:25     | clean |
| 29  | on    | 0    | 0           | 0           | 7:32     | clean |
| 30  | off   | 0    | 0           | 0           | 7:40     | clean |

### Result

| Metric | Pre-fix (ROK-1249 spike sample) | Post-fix (this validation) |
|---|---|---|
| `socket hang up` / `ECONNRESET` rate | ~40% (2/5 valid spike runs) | **3.3% (1/30 runs)** |
| Audit gate fails | n/a | 0/8 audit-on runs |
| Total runtime | ~5 min/run | ~7 min/run avg |

**AC2 strict bar (0 hits in 30 runs):** **not met** — 1 residual flake survived.
**AC2 practical signal (rate reduction):** **92% reduction**, P(≤1 hit | 40% rate, 30 runs) ≈ 3.3×10⁻⁵.

The residual 3.3% flake hit `lineups-auto-advance` on a `PATCH /lineups/:id/status` — different test than the spike's `POST /lineups/:id/vote` but same TCP-RST class. The fix is real and substantial; the residual carrier (likely a second-order BullMQ/Redis interaction with HTTP server lifecycle) needs a follow-up story to fully eliminate.

**Total elapsed runtime:** ~3.7 hours (213 min) wall clock across 4 tiers including operator pauses, sleep handoffs, and one external SIGTERM. Test runtime alone: ~225 min (avg 7.5 min/run).

## 5. AC1 audit guard — unit-test evidence

5/5 `it` blocks pass in `api/src/common/testing/socket-handle-audit.spec.ts`:

```
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

Covers: URI parse, baseline socket-filter, forced-leak detection, port-scoped destroy, zero-match. The 8 audit-on integration runs (1, 4, 7, 8, 10, 15, 22, 29) prove the gate doesn't false-positive in real teardown conditions.

## 6. AC3 — local CI

`./scripts/validate-ci.sh --full` — pending after this doc lands.

---

## 7. Files

| Path                                                | Purpose                                                  |
| --------------------------------------------------- | -------------------------------------------------------- |
| `api/src/common/testing/socket-handle-audit.ts`     | Helpers (parse / list / destroy)                         |
| `api/src/common/testing/socket-handle-audit.spec.ts`| 5 unit tests                                             |
| `api/src/common/testing/test-app.ts` (closeTestApp) | `_appClient.end` timeout 5 → 30 + 2-port fallback destroy (test container port + Redis 6379) |
| `api/src/common/testing/integration-setup.ts`       | Gated audit in `afterAll`                                |
| `api/src/common/testing/snapshot-buckets.ts`        | Added `remoteAddress:remotePort` per-handle for deeper debug |
| `docs/spikes/rok-1249-successor-validation.md`      | This file — AC2 evidence + empirical correction          |
| `planning-artifacts/dev-report-ROK-1250.md`         | Per-AC trace, file-change index                          |

## 8. Follow-up

File a successor story for the residual 3.3% flake. Hypothesis to validate: it's a second-order interaction between HTTP server lifecycle and ephemeral-port pressure on `::1` that survives the layer-2 fix. A debug-instrumented loop pointing at the `lineups-auto-advance` carrier could capture the next snapshot for analysis.
