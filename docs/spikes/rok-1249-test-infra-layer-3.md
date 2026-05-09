# Test Infra Layer 3 Diagnostic — 2026-05-09

**Story:** ROK-1249
**Predecessors:** ROK-1248 (Layer 3a drain barrier — `300c55b1` and PR #748), ROK-1246 (Layer 2 audit — `planning-artifacts/test-infra-diagnostic-layer-2-2026-05-08.md`), ROK-1245 (Layer 1 module-singleton reset)
**Mode:** Evidence-only spike. No production-code change. Instrumentation lives behind `RL_TEST_SOCKET_DEBUG` (off in CI).
**Goal:** Name the rotating-suite `socket hang up` / ECONNRESET carrier with a captured process-state snapshot.

---

## 1. Reproduction Recipe

```bash
cd /Users/sdodge/Documents/Projects/Raid-Ledger--rok-1249/api

# Single-run repro (~7 min/run, ~33% rate observed in this spike)
RL_TEST_SOCKET_DEBUG=true \
  npx jest --config jest.integration.config.js --runInBand --detectOpenHandles

# Or use the loop helper that bails on first hit:
/tmp/rok-1249-loop.sh
```

The instrumentation:

* Wraps `app.getHttpServer()` with `connection` / `close hadError=true` / `clientError` listeners that log per-request URL, method, and elapsed ms (`api/src/common/testing/socket-debug.ts:43`).
* Wraps the supertest agent so any HTTP-method rejection that includes `socket hang up` or `ECONNRESET` calls `dumpFailureSnapshot(reason, { method, url, elapsedMs })` before re-throwing (`socket-debug.ts:135`). This is the trigger that fired in the captured snapshot — the global `uncaughtException` / `unhandledRejection` handler in `integration-setup.ts:43` does NOT see these, because Jest catches them through the awaited supertest promise before they reach the process error events.
* Snapshots write to `planning-artifacts/test-infra-snapshots/snapshot-<iso>.json` and capture five state buckets defined in `snapshot-buckets.ts`: postgres-js pool, BullMQ workers, active handles + requests, SchedulerRegistry, redis-mock store.

## 2. Reproduction Outcome

Three loops were run during the spike. Only the third produced a captured snapshot — the first hit `socket hang up` before the supertest interceptor was wired (only the global handler was hooked at that point, which Jest masks); the second was operator-error (loop directory deleted mid-run).

| Loop | Runs | Hit on | Failing test | Snapshot? |
|---|---|---|---|---|
| 1 (instrumentation v1, `daf1404f`..`22488e2f`) | 2 | run 2 | `characters.integration.spec.ts › character delete › should auto-promote next alt to main when main is deleted` | No (global handler did not fire) |
| 2 (interceptor commit `dde27301`) | — | — | (operator deleted log dir mid-run; no valid runs) | No |
| 3 (re-run of v2) | 3 | **run 3** | `lineups-voting.integration.spec.ts › POST /lineups/:id/vote — configurable limit (ROK-976) › should reject the 6th vote when lineup has votesPerPlayer: 5` | **Yes** — `snapshot-2026-05-09T18-06-17-432Z.json` |

**Empirical rate this spike:** 2 of 5 valid runs ended in `socket hang up` (40%). Layer 2 §1b's prior 5-run window observed 1 of 5 (20%). Both observations were on the rotating-suite flake; the carrier sits below the §3a worker-teardown race that ROK-1248 closed.

## 3. Captured Snapshot — Decoded

`planning-artifacts/test-infra-snapshots/snapshot-2026-05-09T18-06-17-432Z.json`

### 3a. Failure context

* Method: `POST`
* URL: `/lineups/24/vote`
* **Elapsed: 2 ms** (two milliseconds — TCP-level rejection, not request-handler timeout)
* Reason: `socket hang up`

### 3b. Server-side socket events

`server.on('connection' | 'clientError')` produced **NO logs** for this request. The only `[SOCKET] instrumented …` entry was the first-request-after-boot at `T+0` (`POST /auth/local`). The failing request never reached the HTTP server's `connection` event — supertest's TCP connect() was reset before the server saw it.

### 3c. Process state at the moment of failure

| Bucket | Reading | Implication |
|---|---|---|
| postgres-js pool | `configuredMax: 10`, probe `count: 8` | Pool alive and responsive — NOT the carrier. |
| BullMQ workers (13) | All `isRunning: null, isPaused: null` | Reader limitation — `WorkerHost.worker` accessor likely undefined or different in this NestJS version. Compatible with "no worker active" but not conclusive. |
| **Active handles** | **49 Sockets + 1 Server** | Smoking gun. See §4. |
| Active requests | 0 | No outbound HTTP in flight from this process. |
| SchedulerRegistry | 38 cron jobs, ALL `isActive: false` | ROK-1232 fix is intact — crons did NOT fire. |
| Redis mock | 4 keys, all `lineup-*` prefixed for lineup id 24 | Only the current spec's keys; no cross-file leak via redis. |

### 3d. The 49-socket signal

Forty-nine `Socket` handles are open in the test process at the moment a fresh `POST /lineups/24/vote` from the SAME process rejects in 2 ms with `socket hang up`. Combined with:

* Postgres pool healthy (8 of 10 active per probe)
* No BullMQ worker active
* No cron firing
* Server `on('connection')` never seeing this request

…this points to **OS-level ephemeral-port or socket-backlog pressure**, not application-layer state pollution. The Layer 2 diagnostic §2 already noted Docker port-allocator exhaustion as one observed surface; the captured handle count corroborates that the process holds enough socket fds to push the kernel toward RST'ing fresh connect()s.

The 49 are not all from this spec file. supertest opens a fresh TCP per request and the postgres-js pool caps at `max: 10` per app — meaning ~30+ of these sockets are leaked from prior spec files' app instances that `closeTestApp()` did not fully tear down. The `_appClient.end({ timeout: 5 })` 5-second cap (`test-app.ts:240`) is a deliberate trade documented at `test-app.ts:218` — at the cap, postgres-js stops awaiting in-flight queries and leaves sockets to the OS. After 4-5 spec files those sockets accumulate.

## 4. Named Carrier

**Cross-file socket-handle leak from `_appClient.end({ timeout: 5 })`'s 5-second cap.**

Each integration spec file (the suite has 77) re-provisions a NestJS app + a postgres-js pool with `max: 10`. `closeTestApp()` runs `_appClient.end({ timeout: 5 })` between files. When in-flight queries don't complete within 5 s — which can happen if a worker's `process()` callback was still draining a query mid-`afterAll` despite the ROK-1248 drain barrier — postgres-js short-circuits and the underlying TCP sockets enter `TIME_WAIT` or remain half-closed. Across 4-5 spec files this accumulates to the ~49 sockets observed.

Once the process holds enough open socket fds, the kernel's per-process file-descriptor budget AND/OR the host's ephemeral-port pool can RST new client-side connect() calls. The next supertest request to the freshly-bound test server fails at the TCP layer in ~2 ms with `socket hang up` — exactly the captured signature.

This is consistent with — but distinct from — the §3a teardown race that ROK-1248 closed. ROK-1248 ensured queues drain before `app.close()`; it did NOT change `_appClient.end({ timeout: 5 })`. The drain barrier reduces the rate at which queries are in flight at teardown but does not guarantee zero. Any non-zero residual rate produces the leak; over 77 spec files the leak compounds.

### 4a. Why the BullMQ-worker hypothesis (Layer 2 §3a) is incomplete

Layer 2 named the BullMQ teardown race as the dominant carrier. ROK-1248 closed it. The flake persists. The captured snapshot shows zero in-flight requests and no cron firing — the process at the moment of failure is NOT actively running a worker job. The carrier therefore cannot be "a worker job racing the pool"; it must be **state already-leaked** from prior teardowns. The 49 socket handles are that state.

### 4b. Out-of-scope alternative — Docker port-allocator pressure

Layer 2 §2 raised Docker ephemeral-port exhaustion. The current snapshot does NOT directly probe Docker daemon state, so we cannot rule it out. But: Docker pressure would manifest as Testcontainers `start()` failures or `pg_dump` connect failures — neither was observed in the failing run. The test that failed (`POST /lineups/:id/vote`) hits the in-process NestJS HTTP server on `127.0.0.1:<random>`, not a Docker-mapped port. So Docker is unlikely to be the layer-3 carrier even if it remains a co-factor for adjacent failures.

## 5. Successor Story — Falsifiable AC

A follow-up Linear story is filed (AC4 of this spike) with this fix scope and falsifiable AC:

> **Title:** `fix: cap _appClient.end timeout coverage with explicit handle-drain check (ROK-1249 successor)`
>
> **Carrier (per ROK-1249 snapshot):** ~49 socket handles accumulate across the integration suite because `_appClient.end({ timeout: 5 })` short-circuits any in-flight query at 5 s and leaves the underlying TCP sockets to the OS. Over 77 spec files this pushes the process into ephemeral-port / fd pressure, surfacing as `socket hang up` on a fresh supertest request from a mid-suite spec file (~2 ms RST).
>
> **Falsifiable AC:**
> 1. After every spec file's `closeTestApp()`, `process._getActiveHandles().filter(h => h.constructor.name === 'Socket').length` must be ≤ 5 (margin for redis-mock + jest-internal sockets). Add a `process._getActiveHandles` assertion in `integration-setup.ts`'s `afterAll` (gated on `RL_TEST_SOCKET_HANDLE_AUDIT=true`).
> 2. Run the integration suite 30 times sequentially. **0** runs may exit with `socket hang up` or `ECONNRESET`. Run via the existing `/tmp/rok-1249-loop.sh` recipe but with `MAX_RUNS=30`.
>
> Two viable fix approaches (architect's call):
> * Replace `timeout: 5` with `timeout: 30` and rely on workers having drained via the ROK-1248 barrier (low-risk; trades teardown latency).
> * Add an explicit post-`end()` handle-audit + force-destroy of any lingering `Socket` whose `_httpMessage` matches the test app's port.

## 6. Files (this spike)

* `api/src/common/testing/dump-failure-snapshot.ts` — entry point
* `api/src/common/testing/snapshot-buckets.ts` — five bucket readers (each `safeRead` + 500 ms `Promise.race` timeout)
* `api/src/common/testing/socket-debug.ts` — server-side instrumentation + supertest interceptor
* `api/src/common/testing/dump-failure-snapshot.spec.ts` — 4-test unit suite
* `api/src/common/testing/test-app.ts` — exports `getTestAppInstance`, calls `instrumentHttpServer` + `wrapAgentForSnapshot` when `RL_TEST_SOCKET_DEBUG=true`
* `api/src/common/testing/integration-setup.ts` — global `uncaughtException` / `unhandledRejection` handler (kept as a backstop; supertest interceptor is the primary trigger)

## 7. Out of Scope (unchanged from spike charter)

* Any code-side fix — that is the successor story.
* `forceExit: true` change.
* `_appClient.end({ timeout: 5 })` change (this is what the successor will adjust).
* `maxWorkers` change.
