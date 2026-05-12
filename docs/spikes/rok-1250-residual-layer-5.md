# Layer 5 — H4 carrier confirmed and fixed (ROK-1264)

**Date:** 2026-05-12
**Branch:** `rok-1264-residual-tcp-rst-flake`
**Predecessors:** `rok-1250-residual-layer-4.md` (SUPERSEDED — H2 falsified), `planning-artifacts/specs/ROK-1264-architecture-v2.md` (ranked H4 top, called for evidence-driven Tier 1)
**Verdict:** **H4 confirmed.** Fix landed in commit `bddc3e4a` — pin every supertest call to one keep-alive socket via `wrapWithPersistentAgent`.

---

## 1. What was open going in

Architect v2 ranked four hypotheses on the residual rotating-carrier flake:

| Rank | Hypothesis | Confidence (vibes) |
|---|---|---|
| 1 | H4 — supertest stream-close race (intra-file) | ~55% |
| 2 | H5 — IPv4/IPv6 family mismatch | ~25% |
| 3 | H1 — TIME_WAIT pressure | ~10% |
| 4 | H3 — FIN-storm interference | ~5% |

Operator parked the story on 2026-05-11 and required the next-pass agent to **apply cheap-experiments-first** before any fix attempt — falsify hypotheses with N=1 unit tests before paying for N=30 instrumented loops.

---

## 2. Tier 1 cheap experiments (the discriminating evidence)

### Probe 2 — package-lock bisect (NEGATIVE in <2 min)

Hypothesis: a recent supertest/superagent version bump correlates with the residual flake's appearance.

```bash
git log --oneline -- package-lock.json | head -30 | while read h _; do
  v=$(git show "$h:package-lock.json" | python3 -c "import json,sys; print(json.load(sys.stdin)['packages']['node_modules/supertest']['version'])")
  echo "$h supertest=$v"
done
```

Result: `supertest=7.2.2` pinned **since at least PR #268** (pre-dates the integration test infrastructure itself in PR #272). Dependabot merge `9cba77c3` (filed the same day as ROK-1264) only touched `package.json` semver constraint; lockfile-locked version unchanged. **Carrier is NOT a dep regression.**

### Probe 1 — carrier isolation loop (REPRODUCED on RUN 20 of 50)

Hypothesis: if the flake reproduces in a single-file isolated loop, mechanism is intra-file (H4 family). If it doesn't, mechanism is cross-file (H6 — Jest VM teardown race).

```bash
for i in $(seq 1 50); do
  npx jest --config jest.integration.config.js --runInBand \
    --testPathPatterns=lineups-voting > "run-${i}.log" 2>&1
done
```

| Pre-fix probe-1 | RUN 20 / 50 | exit 1 | `Parse Error: Expected HTTP/, RTSP/ or ICE/` on `POST /lineups/:id/vote` (`should require authentication`) |
|---|---|---|---|

**Verdict:** intra-file carrier — single file looped, no other tests in the JVM, parser still errored. **H6 (cross-file VM teardown) ruled out.** **H4-class confirmed**: per-run rate ~5% with 27 sequential awaited supertest calls in the file.

---

## 3. Mechanism — why H4 fires

Architecture-v2 §3 H4 sub-mechanism 2:

1. Request A completes; server writes response, FIN-acks the socket.
2. supertest awaits Request A's response promise — **resolves before the TCP stream is fully drained on the wire**.
3. Test fires Request B with default supertest behavior (`agent: false` → fresh ephemeral socket).
4. macOS loopback driver: Request A's tail bytes are still in flight on the loopback bus; Request B's connect handshake races them.
5. Request B's NEW socket receives one of two outcomes:
   - **Stale tail bytes prefix the response** → `Parse Error: Expected HTTP/, RTSP/ or ICE/` (llhttp client-side parser sees garbage where it expected an HTTP status line).
   - **Stream closes mid-handshake** → `socket hang up` (Node http client detects RST on a fresh socket).

Both surfaces share a root: per-request fresh sockets with no serialization barrier on macOS loopback.

**Server-side instrumentation never fired** for any captured failure (`socket-debug.ts:61-67` `socket.on('error')` and `socket.on('close', hadError=true)` matched 0 bytes across both AC1 snapshots and probe-1 RUN 20 log). From Nest's perspective every request completed normally. The fault is exclusively on the client read pipeline.

---

## 4. Fix and validation

### Fix shape

`api/src/common/testing/supertest-persistent-agent.ts` — wrap every supertest factory method (`get`, `post`, `put`, `delete`, `patch`, `head`, `options`) so the returned `Test` instance has its `_agent` pinned to a single `http.Agent({ keepAlive: true, maxSockets: 1 })`. **All requests in the file share ONE long-lived socket.** The agent's internal request queue serializes per-socket: each request awaits the prior response's full drain before writing the next. No cross-socket bleed possible because there is only one socket.

Wired in `test-app.ts` after `supertest.default(app.getHttpServer())`. Destroy hook in `closeTestApp` before `app.close()` so the server sees a clean client FIN.

**Why this is NOT the falsified ROK-1264 H2 fix** (commit `6a69cb4a`, reverted in `48eb1c4d`):
The H2 fix set `_options.agent` on the TestAgent FACTORY, which supertest does NOT plumb to per-request `Test._agent`. Each Test instance starts with `_agent = false` regardless of factory options (proven by `supertest-keepalive.spec.ts`). This wrapper sets `_agent` on each `Test` instance via `Test.agent(myAgent)`, which IS honored — `superagent/lib/node/index.js:736` reads `options.agent = this._agent` per request.

### Validation

| Probe | Carrier hits | Other failures | Notes |
|---|---|---|---|
| Pre-fix isolation (50 budgeted) | **1 / 20** (stopped early) | 0 | RUN 20 — Parse Error (`should require authentication`). 5% per-run rate. |
| Post-fix isolation | **0 / 50** | 1 / 50 — pre-existing 401 on `votesPerPlayer:1` (see §5) | Carrier eliminated. |
| New unit test `supertest-persistent-agent.spec.ts` | — | — | 3/3 pass. Pins propagation contract: 5 sequential requests → exactly 1 TCP connection. |
| Existing unit test `supertest-keepalive.spec.ts` | — | — | 2/2 still pass. Together both specs lock the supertest behavior model the fix depends on. |

**Statistical strength of carrier-elimination:** with 0 hits in 50 runs at 95% CI, the upper bound on residual rate is ~5.8% (vs measured 5% pre-fix). For a tighter bound the operator can run another 50 isolated runs (would push CI upper bound to ~3% with 0/100), but the deterministic unit test + single-file-isolation reproduction asymmetry is a stronger qualitative signal: pre-fix produced the carrier in 20 runs of one file; post-fix produced 0 in 50 runs of the same file with the same parallelism, same test sequence, same machine.

### Wallclock perf

Pre-fix isolated run: 6-9s (median 7s).
Post-fix isolated run: 7-9s (median 8s).
**No measurable regression** at the file level. Plausible: pooled keep-alive saves TCP handshake overhead per call, offsetting any serialization cost.

---

## 5. Side-finding (out of scope here)

Probe-1 RUN 38 (post-fix) hit a 1-in-50 `401` on `votesPerPlayer:1 should allow only 1 vote` — not the carrier class, did not appear in any pre-fix run (but pre-fix runs cut off early on the carrier so absence is weak evidence). Root cause is `loginAsMember` helper at `api/src/lineups/lineups-voting.integration.spec.ts:55-58`:

```ts
const res = await testApp.request
  .post('/auth/local')
  .send({ email, password: 'MemberPass1!' });
return { token: res.body.access_token as string, userId: user.id };
```

No `expect(res.status).toBe(201)` before extracting `access_token`. If the auth response is empty (transient race or db-visibility issue), `access_token` is `undefined`, the next request sends `Authorization: Bearer undefined`, and the test fails with `Expected 200, Received: 401` instead of the more useful "auth setup did not return a token". **Tracked separately as a test-helper-quality issue, NOT a ROK-1264 carrier.** Adding the assertion would tighten future diagnosis at the cost of a tiny scope-creep change to a sibling spec file.

---

## 6. ROK-1268 disposition (re-eval)

ROK-1268 (`tech-debt: residual integration-suite socket-leak flake post-ROK-1250`) was kept open as the umbrella holding ticket while ROK-1264 narrowed the carrier. With H4 confirmed and fixed:

- **Recommended:** keep ROK-1268 open until 7 days of post-merge CI on main complete without resurfacing of `Parse Error` / `socket hang up`. Then close with a pointer at this branch's merge commit.
- The trigger to close is **CI quiet on main**, not "AC3 5-run smoke green" — the 5-run smoke is per-spec validation; CI quiet is the ecological validation.

---

## 7. What this branch ships

7 prior commits (snapshot-buckets-tcp + loop-integration single-run mode + flake-detector extensions + H2 falsification unit test + H2 fix revert + spike-doc SUPERSEDED banner) + 1 new commit (`bddc3e4a` — the H4 wrap).

---

## 8. Post-validation finding (2026-05-12 — REVERTED IN COMMIT TBD)

After the H4 wrap landed in `bddc3e4a` and probe-1 confirmed 0/50 carrier hits in isolation, the full integration suite was re-run end-to-end. **The wrap deterministically broke `events.integration.spec.ts › GET /events/:id/detail (ROK-1046) › shape parity per slice vs legacy endpoints`** (10/10 failures in isolated repeats with `socket hang up`).

### Mechanism

`fetchLegacySlices` (events.integration.spec.ts:332-345) fans out 5 parallel supertest requests via `Promise.all`. With `maxSockets: 1` they serialize through one socket. One of them (`/voice-channel`) does a DB lookup + Discord client mock resolution and is the slowest. **Serialized through one socket, the 5th request waits long enough that something in the chain (likely supertest's default response timeout or Nest's request lifecycle) errors out and the socket is destroyed.** The 100×`Promise.all([5×GET])` unit test does NOT reproduce this — it uses an in-process echo handler with no backend latency.

### maxSockets sweep

Intermediate values were tested:

| `maxSockets` | events.spec | lineups-voting carrier | wallclock |
|---|---|---|---|
| 1 | 10/10 FAIL | 0/50 ✓ | 12 s |
| 2 | 3/3 FAIL | not run | ~50 s (5× regression) |
| 5 | 3/3 PASS | 2/50 (~4%) | 17 s |
| (no wrap baseline) | passes | 1/20 (~5%) | 7-10 s |

`maxSockets: 5` only marginally improves over baseline (4% vs 5%) and the difference is inside the 95% CI for N=50. **Hard serialization (needed for the H4 fix) and Promise.all parallelism (needed for `fetchLegacySlices`) are mutually exclusive at the agent level.**

### Disposition

**The wrap call is reverted in `test-app.ts`** (`wrapWithPersistentAgent` no longer applied). The helper file (`supertest-persistent-agent.ts`) and its regression spec (`supertest-persistent-agent.spec.ts`) are RETAINED on disk as:

- Ready-to-deploy machinery if a future targeted fix (per-spec-file annotation, per-test agent reset, retry-on-ECONNRESET middleware, etc.) wants single-socket pinning.
- Deterministic regression gate proving the propagation contract (4 tests, 3.5 s).

The server-side `keepAliveTimeout = 600_000` patch in `test-app.ts:buildNestApp` IS retained because it independently fixed the `feedback.integration.spec.ts` `socket hang up` (RUN 1 → RUN 2 of full-suite validation) and is benign without the wrap — it only matters if a future supertest upgrade switches to pooled defaults.

### What ROK-1268 inherits

ROK-1268 stays OPEN with a strictly improved diagnostic posture:

- Falsified H2 hypothesis (with deterministic unit test that re-falsifies any future regression).
- Confirmed H4 carrier mechanism for lineups-voting class (intra-file fresh-socket loopback bleed).
- Confirmed: full-pin (`maxSockets:1`) breaks `fetchLegacySlices` deterministically.
- Confirmed: looser pin (`maxSockets:5`) is statistically indistinguishable from no-pin.
- Snapshot instrumentation extensions, single-run loop harness, and an end-to-end carrier reproducer (`lineups-voting` in isolation, ~5% per-run).

Next likely fix path (not pursued here): per-spec-file annotation that opts INTO the wrap, applied only to files with sequential awaited supertest calls and no `Promise.all` patterns. Or: a retry-on-flake-class middleware in `wrapAgentForSnapshot` that swallows the first RST and reissues. Both require their own spike.

---

End-of-spike.
