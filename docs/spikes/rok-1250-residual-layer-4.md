# ROK-1264 — Layer-4 Spike: Residual Carrier Diagnosis

> ⚠️ **SUPERSEDED (2026-05-12 evening — Lead).** The "H2 confirmed" verdict below was based on a misread of the snapshot evidence: 3 active sockets to the test server port was interpreted as keep-alive pool depth, but supertest defaults to non-pooled (`agent: false`) — there is no pool to reuse from. The unit test in `api/src/common/testing/supertest-keepalive.spec.ts` (commit `b91b418a`) deterministically falsifies the H2 mechanism (2 sequential supertest requests open 2 distinct sockets WITHOUT any agent override).
>
> The "3 sockets" was actually 3 recent un-GC'd handles in various close states — fresh-socket-per-request behavior, not pool reuse.
>
> The H2 fix from this spike (commit `6a69cb4a`) was reverted in commit `48eb1c4d`.
>
> **Updated diagnosis lives at `planning-artifacts/specs/ROK-1264-architecture-v2.md`.** Top candidates after the falsification: H4 (supertest client-read stream-close race) and H5 (IPv4/IPv6 dual-stack loopback mismatch). H1 (TIME_WAIT) and H3 (FIN storm) remain demoted by the snapshot evidence.
>
> **Resolution (2026-05-12 — Tier-1 Lead):** H4 confirmed by single-file isolation reproducer (`lineups-voting`, 1 hit / 20 runs = ~5%). Fix landed in commit `bddc3e4a` — pin every supertest call to one keep-alive socket. Post-fix isolation: 0 carrier hits / 50 runs. **The wrap was subsequently REVERTED** after full-suite validation showed it deterministically breaks `events.integration.spec.ts › shape parity per slice` (10/10) due to a Promise.all-on-pinned-socket interaction. The helper + regression unit tests are retained on disk for future opt-in deployment. ROK-1268 stays open. See `docs/spikes/rok-1250-residual-layer-5.md` §8 for full disposition.
>
> **What's still useful in this doc:** §3 run-by-run summary, §4 confounders (Docker orphan compounding, host resource pressure, Bash harness 10-min reap, loop hit-detection regex too narrow). Those remain valid.
>
> **Original "H2 confirmed" verdict preserved verbatim below for audit-trail continuity.**

---

**Date captured:** 2026-05-12
**Snapshot:** `planning-artifacts/test-infra-snapshots/snapshot-2026-05-12T03-54-02-146Z.json`
**Failure:** `socket hang up` on `GET /events?page=1&limit=2`, elapsed 1ms, in `events-dashboard.dashboard.integration.spec.ts` › `Events Dashboard — findAll › should paginate correctly`
**AC1 budget consumed:** 6 of 30 (1 FLAKE_DETECTED at RUN 6, 4 prior CLEAN, 1 NON_FLAKE_FAIL at RUN 5 — see §3).

---

## Verdict (SUPERSEDED — see notice above)

**H2 confirmed: HTTP keep-alive socket reuse via supertest's superagent globalAgent.**

The architect's hypothesis #2 (`planning-artifacts/specs/ROK-1264-architecture.md` §4) matches the snapshot evidence exactly. H1 (macOS TIME_WAIT pressure) is ruled out by the per-port TIME_WAIT distribution. H3 (accept-queue / FIN-storm) is a stable bystander, not the carrier.

---

## 1. Evidence from snapshot

### Active handles (43 sockets total)

```
40 sockets → ::1:6379  (BullMQ ioredis worker connections — stable, long-lived)
 3 sockets → ::1:56309 (THE current test server — pagination test in flight)
```

Peer-port histogram from snapshot:
```json
"peerPortHistogram": {
  "total": 43,
  "byPeerPort": [
    { "port": 6379, "count": 40 },
    { "port": 56309, "count": 3 }
  ]
}
```

**The 3 sockets to `::1:56309` is the carrier signal.** Each supertest request opens a new client TCP connection to the in-process Nest HTTP server (which bound port 56309 via `app.listen(0)`). At RST time, three sockets exist on that single server port — meaning the keep-alive pool is holding stale connections from the test's earlier requests in addition to the current one.

### TIME_WAIT distribution

```
Total TIME_WAIT: 592
By peer port:
  6379  →  91  (prior closeTestApp's destroySocketsOnPort(6379) FINs)
  56304 →  10  (prior spec file's test server port, now closed)
  56302 →   9
  56307 →   8
  56303 →   5
  56305 →   5
  56306 →   5
  56308 →   5
  443   →   4  (HTTPS — unrelated, prob mdns)
  56309 →   2  (current test server port — healthy)
```

**Current test server port `:56309` has only 2 TIME_WAITs.** Far below any kernel-pressure threshold (macOS default range is 16K ports, 60s 2MSL). This rules out H1: there's no ephemeral-port exhaustion or per-4-tuple TIME_WAIT pressure on the test server port range.

### Failure context

```json
{
  "method": "GET",
  "url": "/events?page=1&limit=2",
  "elapsedMs": 1
}
```

**RST'd within 1 ms.** The architect's §4: *"the bad-socket reuse is detected on first byte"*. An RST that fast cannot be application-layer — it's the TCP stack rejecting the SYN/data on a stale 4-tuple, OR the HTTP client immediately failing to parse a half-FIN'd response. Both are H2's mechanism.

---

## 2. Hypothesis classification per architect §6 step 3

| Architect criterion | Observed | Verdict |
|---|---|---|
| Multiple sockets share `remote=<server_eph_port>` AND TIME_WAIT count healthy → H2 | 3 sockets to `::1:56309`, only 2 TIME_WAITs there | ✓ **H2 confirmed** |
| `netstat` TIME_WAIT > 1000 on test server port range AND handle count healthy → H1 | 592 total, but only 2 on the current server port; rest are PRIOR spec files' ports | ✗ H1 ruled out |
| ≥5 sockets to `::1:6379` mid-test → H3 partial-confirm | 40 sockets to `::1:6379`, but these are stable BullMQ workers (`isRunning: null` = workers are idle-listening, not churning); no in-flight `closeTestApp(6379)` from current file | ⚠ H3 stable bystander, NOT carrier |

The architect's pre-dev §4 explicitly predicted: "Second PATCH after a sequence of other requests — exactly the pattern keep-alive reuse exploits." The pagination test makes multiple sequential GET requests (`?page=1`, `?page=2`, …) against the SAME server port. The carrier hit was on the second-or-third request in the sequence — exactly the H2 trigger pattern.

---

## 3. Run-by-run summary

| Run | Result | Duration | Failure / Notes |
|-----|--------|----------|-----------------|
| 1 | CLEAN | 397s | — |
| 2 | CLEAN | 392s | — |
| 3 | CLEAN | 388s | — |
| 4 | CLEAN | 370s | — |
| 5 | NON_FLAKE_FAIL | 342s | `Parse Error: Expected HTTP/, RTSP/ or ICE/` in `game-taste.integration.spec.ts › runAggregateGameVectors`. NOT canonical `socket hang up` — HTTP parser-level error. Surfaced an instrumentation gap (see §5). |
| 6 | **FLAKE_DETECTED** | 353s | Canonical `socket hang up` in `events-dashboard.dashboard.integration.spec.ts › Events Dashboard — findAll › should paginate correctly`. Snapshot captured. **STOP signal.** |

**Carrier file rotates per run:** RUN 5 hit `game-taste`, RUN 6 hit `events-dashboard`. This matches ROK-1268's observation: the same root cause manifests in different carrier tests each time the suite runs, depending on which test file happens to be the one whose first request lands on a stale pooled socket. The rotating-carrier behavior is a strong second-order indicator that the cause is in shared infrastructure (the supertest globalAgent pool), not in any individual test.

---

## 4. Confounders ruled out during diagnosis

Documenting the false leads so future debuggers don't repeat them:

### (a) Docker orphan compounding (first AC1 attempt, pre-park)

Prior `validate-ci.sh` runs in adjacent worktrees left orphan `pgvector/pgvector:pg16` testcontainers alive on the Docker daemon, causing `PostgreSqlContainer.start()` to time out on the testcontainers internal 10s port-bind. Symptom looks similar (mid-test failure, exit 1) but is **environmental, not a flake of our system under test**.

Fix: per-RUN orphan cleanup in `scripts/loop-integration.sh` (commit `e77f2689`), using name-exclusion (NOT image-ancestor — that would collateral-kill `raid-ledger-db`; see memory `feedback_docker_cleanup_name_filter.md`).

### (b) Host resource pressure under co-tenancy

When another worktree's `validate-ci.sh --full` was concurrent, the host load hit 8.88 (88% of 10-core) and free RAM dropped to 0.6 GB. This pushed pgvector spinups past the 10s port-bind budget. Symptom: `testcontainers` timeouts cascade across 79 spec files.

Workaround for this story: serialize work via the `env_lock` queue and wait for a quiet host (Path 1a per `planning-artifacts/resume-plan-ROK-1264.md`). Permanent fix would be a separate test-infra story (Path 1c or 1d).

### (c) Bash harness 10-min reap

The Claude Code Bash tool's `run_in_background: true` reaps at ~10 min regardless of the `timeout` param. A 30-run tier (~3.5 hr) is impossible from a single Bash call.

Workaround: single-run mode in `scripts/loop-integration.sh` (`START_RUN=N MAX_RUNS=1`). Lead drives one run per Bash call (~7 min each, fits in the harness window). Run-table at `$LOG_DIR/table.tsv` accumulates across invocations.

### (d) Loop's original hit-detection regex was too narrow

The original loop only matched `(socket hang up|ECONNRESET)`. RUN 5's `Parse Error: Expected HTTP/, RTSP/ or ICE/` (HTTP parser-level error from node's llhttp) is in the same TCP-RST class but wasn't caught. Extended in commit `8ea14dae` to also match `Parse Error: Expected HTTP` and `HPE_INVALID`. The wrapped supertest agent's `isFlakeError` was extended to the same predicate so `dumpFailureSnapshot` fires for the broader class.

This is non-trivial guidance for future flake hunts: TCP-level errors in node manifest with multiple surface codes (`ECONNRESET`, `socket hang up`, `HPE_INVALID_CONSTANT`, `EPIPE`, etc.) depending on which side detects the bad state first. Match the class, not just the canonical message.

---

## 5. ROK-1268 disposition

[ROK-1268](https://linear.app/roknua-projects/issue/ROK-1268) was filed during `/fix-batch` on 2026-05-11T23:32Z when 3 consecutive `validate-ci.sh --full` runs flaked on 3 different unrelated tests. The rotating-carrier behavior matches this AC2 evidence exactly: same root cause (H2 pool reuse), different victim test per run.

Per the revised recommendation in `planning-artifacts/resume-plan-ROK-1264.md`, ROK-1268 stays open until ROK-1264's AC3 5-run smoke is green AND a week of post-merge CI on `main` accumulates without the flake re-surfacing. If both hold, close ROK-1268 with link to ROK-1264's merge commit.

---

## 6. AC3 plan (handoff to fix application)

Per architect §8 H2 fix shape:

1. **Modify `api/src/common/testing/test-app.ts`** (around line 171, where the supertest agent is constructed). Build a `new http.Agent({ keepAlive: false, maxSockets: Infinity })` and assign it via `request._options.agent` so every supertest request opens a fresh TCP connection AND every response triggers a kernel-side FIN. No stale-socket reuse possible.
2. **In `closeTestApp`** (around line 242), call `keepAliveOffAgent.destroy()` to flush any residual sockets the agent held.
3. **5-run smoke loop** with `RL_TEST_SOCKET_DEBUG=false` (production-equivalent flag). Append run-table to `docs/spikes/rok-1249-successor-validation.md`.
4. **Performance regression gate** per resume plan: capture pre-fix wall-clock from this AC1 run table (~370-397s = mean ~376s) and post-fix from the smoke. If post-fix is ≥20% slower (mean >450s/run), revert and pivot to architect §8 "H1-only fix" alternative (`destroySocketsOnPort(testServerPort)` in closeTestApp, ~3 lines).

Total surface for AC3: ~10 lines in `test-app.ts`, no other files. Within the spec's `api/src/common/testing/**` envelope.

---

## 7. References

- Architect findings: `planning-artifacts/specs/ROK-1264-architecture.md` (§4 H2, §6 ranked recommendation with 2026-05-12 CORRECTION, §8 fix shape)
- Resume plan: `planning-artifacts/resume-plan-ROK-1264.md` (Phase 3 with DO NOT SKIP AC1 guard and perf-regression gate)
- Predecessor: `docs/spikes/rok-1249-successor-validation.md` (ROK-1250 the architect's path-1 fix, layer-2 BullMQ ioredis destroy)
- ROK-1268: `tech-debt: residual integration-suite socket-leak flake post-ROK-1250` (Backlog; same flake family — keep open until ROK-1264 AC3 + 7 days CI clean)
- Snapshot file: `planning-artifacts/test-infra-snapshots/snapshot-2026-05-12T03-54-02-146Z.json`
- AC1 run logs: `/tmp/rok-1264-ac1-runs/run-{1..6}.log` (RUN 6's log contains the canonical failure trace)
- Commit `e77f2689` — Phase 2 loop refactor (single-run mode + cleanup + INCONCLUSIVE)
- Commit `8ea14dae` — extended FLAKE detection (Parse Error + HPE_*)
