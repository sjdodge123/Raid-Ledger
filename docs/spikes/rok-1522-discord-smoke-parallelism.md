# ROK-1522 spike — Discord smoke parallelism on one shared guild

Status: spike output, no code. Author: spike lane, 2026-09-25. Base: `origin/main` @ `8e0b7452f`.

## 1. Measured current state

### 1.1 Evictions (all `discord-smoke.yml` runs, 2026-09-11T14:18Z → 2026-09-25T22:18Z)

Source: `gh api …/workflows/discord-smoke.yml/runs?created=>=2026-09-11` (674 runs) plus
`…/runs/<id>/jobs` for each run. A run is "guild-holding" when its `discord-smoke` job was
not `skipped`. The Lead's 200-run sample (29 cancelled / 24 failed / 147 ok) is a subset of this window.

| Bucket | Runs |
|---|---|
| All runs | 674 |
| `discord-smoke` job skipped (PR touched no Discord path) | 259 |
| Guild-holding | 415: 267 success, 56 failure, **92 cancelled** |
| Cancelled while **pending**: the job never ran a step, so the concurrency queue evicted it | 91 |
| Cancelled while running (one probe branch, `tech-debt/rok-1527-ci-probe-3`, 09-25) | 1 |

The 91 evictions, split by the next guild-holding run to arrive (that run is the evictor):

| Victim ← evictor | Runs | Is it this bug? |
|---|---|---|
| Same branch ← newer push on that branch (superseded) | 9 | No. Harmless. |
| main push ← a PR run | 47 | Partly. Nothing blocks, but main loses its post-merge smoke. |
| PR ← another PR | 22 | **Yes** |
| PR ← a main push | 13 | **Yes** |

**35 PR runs on 20 distinct branches lost their required `discord-smoke` context** to another
ref's run. None of those 35 SHAs ever got a completed run; each PR recovered only through a new
push or rebase. Caveat: the evictor is inferred as the next guild-holding run created after
the victim. GitHub does not record which run caused a cancellation.

### 1.2 Duration and demand

- `discord-smoke` job wall time (n=320 completed runs that executed smoke steps): **median 17.2 min**,
  p90 19.1, max 60.4.
- Queue wait (run created → smoke job started): median 0.3 min, p90 17.5 min, max 526 min.
- Peak demand: **61** guild-holding runs on 09-12 and **60** on 09-23. At 17 min each that is about
  17 h of strictly serial guild time in one day. On busy days the contention comes from the
  demand itself. It is not an occasional collision.
- **Every** push to main holds the guild (`.github/workflows/discord-smoke.yml:72-75`,
  `github.event_name == 'push' ||` ignores `detect-changes`): 199 guild-holding push runs. Yet
  only **71 of 190** main commits in the window touched a `detect-changes` Discord path.

### 1.3 What the workflow and suite share

The workflow side:

- `.github/workflows/discord-smoke.yml:64-66`: `concurrency: group: discord-smoke-shared-guild`,
  `cancel-in-progress: false`. It is repo-wide and holds at most one pending run.
- `:118-123`: every run uses the **same** API bot (`DISCORD_BOT_TOKEN`/`DISCORD_CLIENT_ID`),
  the same companion bot (`TEST_BOT_TOKEN`) and the same `TEST_GUILD_ID`.
- `:130`: `SMOKE_CONCURRENCY: '1'`. `:245-278`: five category steps, each a separate process.
- Postgres and Redis are service containers, so **each run already has its own DB and API**.
  All contention is on the Discord side.

What that Discord side consists of:

| Shared thing | Where | Why two runs collide today |
|---|---|---|
| Bot identity / gateway session | workflow `:118-119` | Two API processes on one token both receive every interaction and slash command. A click on run A's button can reach run B's API, which has no such event (a 404). ROK-1469 hit the same thing on the fleet: "last container to connect owned the socket" (`rl-infra/README.md:711-714`). |
| Text channels (non-slot) | `tools/test-bot/src/smoke/channel-set.ts:35,55`; `setup.ts:247-248` | Every run posts into the same `general`/`gamernight`/`wow-channel`. The author filter (`helpers/bot-author.ts:1-14`, `helpers/messages.ts:4`) pins reads to the API bot's user id. With **one** identity, run A's card passes that filter for run B. This is the 2026-09-06 duplicate-card / extra-hands failure. |
| Default voice channel and Scheduled Events | `smoke/setup.ts:278-288` sets `voiceChannels[0]` as default | Discord allows **one ACTIVE scheduled event per voice channel** (memory `feedback_fleet_env_bot_shares_ci_guild.md`). Two runs on the same default voice channel break ROK-944's Scheduled→Active→Completed. |
| Guild Scheduled-Event cap (100) | cleanup `smoke/fixtures.ts:305-330`, called `setup.ts:293` | Cleanup is already owner-scoped ("skipped — not ours"), so it is safe across identities. The 100 cap is guild-wide, though, and fleet envs share it. |
| LFG forum board | `smoke/tests/lfg-board.test.ts:220` (`forumPreexisting`), `:646-650` | CI's DB is fresh, so each run creates its **own** forum channel and deletes it in `finally`. Forums are addressed by id (`fixtures-lfg-board.ts:9,84`). This is isolated per run already. |
| Board toggle (global setting) | `smoke/lfg-surface-lock.ts:1-20` | Stored in the per-run DB, so there is no cross-run effect. The lock is in-process only. |
| Game→channel bindings | `smoke/channel-pool.ts:30-67` | Rows live in the per-run DB. The **channels** they bind to are shared (see text channels above). |
| DMs to the companion bot | `helpers/dm.ts` | A DM channel belongs to a (bot, user) pair. With one API bot, two runs' DMs land in one channel. |
| Roles | none found | `grep` for `roles.`/role mutation in `tools/test-bot/src` finds nothing. |

## 2. Options

Throughout this section, the hard constraints hold:

- no new `ci-*` channels;
- no `SMOKE_CHANNEL_SET` for CI;
- `slot-*` channels are not spare;
- no weakened assertions.

Acceptance bullets (AB) from the issue:

- AB1: two simultaneous PRs both get a conclusion.
- AB2: no cross-run interference.
- AB3: the suite still passes when it runs alone.
- AB4: smoke traffic stays out of the operator's forum.

### (a) Waiting instead of eviction: self-hosted rl-infra runner, or a GitHub-side lease

**a1. Self-hosted runner on rl-infra.**

- **How:** a single runner labelled `discord-smoke`, with the concurrency group dropped. GitHub queues
  jobs for a busy runner (up to 24 h) instead of evicting them, which gives FIFO order at parallelism 1.
- **Setup (operator):**
  - install and register the runner on the VM;
  - give it Docker, which service containers need;
  - make the Discord secrets reachable from the VM.

  Agents cannot SSH to the VM.
- **Risk:** the repo is **PUBLIC** (`gh repo view`: `PUBLIC`, user-owned). GitHub advises against
  self-hosted runners on public repos because a fork PR runs arbitrary code on them. That would need
  a fork guard plus required approval. The runner also competes with fleet RAM.
- **Interference:** none, because it stays serial.
- **Effort:** M.
- **Satisfies:** AB1 and AB3. It gives no throughput gain.

**a2. GitHub-side lease (recommended Phase 1).**

- **How:**
  - Replace `concurrency:` with a first step that acquires an atomic lock and a final `always()`
    step that releases it.
  - The lock is created with `POST /repos/{repo}/git/refs` for `refs/locks/discord-smoke`. The API
    returns 422 if the ref exists, which makes creation a compare-and-swap.
  - The ref's commit message records the run id and a timestamp.
  - A waiter polls every 30 s. It takes over a lock whose holder run is `completed` or older than
    90 min, so a crashed run cannot wedge the queue.
  - The job shows **in progress** while it waits, so the required context never vanishes.
  - `timeout-minutes` stays bounded (about 150).
- **Setup:** `permissions: contents: write` on the job. Fork and Dependabot PRs get a read-only
  token, but they already skip the live steps (`:189-197`), so they also skip the lease. No
  operator Discord work is needed.
- **Interference:** identical to today, because it stays serial.
- **Effort:** S. It is about 60 lines of `scripts/ci/discord-lease.sh`, or the third-party
  `ben-z/gh-action-mutex` (operator Q2).
- **Satisfies:** AB1 and AB3. Waiting time stays: a queue 3 deep waits up to about 50 min, but
  nothing is silently lost.

### (b) Per-run identity leasing that reuses the fleet slot bots

- **How:** a CI run leases a slot N whose bot is idle, uses its token and releases it at the end.
- **Blockers:**
  1. **The tokens never leave the VM** (`rl-infra/README.md:745-748`). CI would need all four
     tokens duplicated as GitHub secrets, and that doubles the leak surface.
  2. **The lease authority is the orchestrator's `bot_identity_in_use` claim**
     (`README.md:722-735`). It lives on the LAN, and GitHub-hosted runners cannot reach it.
     Exposing it publicly is a new attack surface.
  3. **Sharing a slot bot with a live or preserved env is unsafe.** It creates two gateway sessions
     on one token, so interactions split between them (§1.3 row 1). The env's reconciliation cron
     also keeps creating scheduled events under the same owner id, so CI's owner-scoped cleanup
     would delete the env's events and count them as its own. Memory
     `feedback_fleet_env_bot_shares_ci_guild.md` shows that a preserved env's bot already
     pollutes CI's guild through scheduled events.
  4. Slot bots are meant to pair with `slot-N-*` channels, which CI may not use.
- **Interference:** unsafe unless the fleet guarantees the slot has no env. Preserved envs sit for
  up to 24 h (`reference_fleet_env_ttl_reaps_plans.md`), so that guarantee rarely holds.
- **Effort:** L.
- **Verdict: reject.** Keep the *pattern* (one bot identity per concurrent consumer) and give CI
  its **own** identities instead (option c).

### (c) Dedicated CI identity pool, isolated inside the one guild, concurrency > 1

- **How:**
  - The operator registers K extra Discord applications for CI (K = 1 or 2, so a pool of 2–3
    including today's bot) and invites them to the test guild.
  - Their tokens become secrets `DISCORD_BOT_TOKEN_1..K` / `DISCORD_CLIENT_ID_1..K` /
    `DISCORD_CLIENT_SECRET_1..K`.
  - The a2 lease generalises to K+1 refs (`refs/locks/discord-smoke/<i>`). A run takes the first
    free index and exports `SMOKE_POOL_INDEX=i` plus the matching token.
- **Isolation, mechanism by mechanism:**
  - Interactions and slash commands are per application, so they are isolated.
  - Channel reads are isolated by the **existing** author filter (`bot-author.ts`). A different
    bot user id means run A's cards are invisible to run B. This directly kills the 2026-09-06 mode.
  - DMs are isolated because the DM channel belongs to the (bot, user) pair.
  - The LFG forum was already per run (§1.3).
  - Scheduled-event cleanup was already owner-scoped (`fixtures.ts:305`).
- **Remaining collision:** the default voice channel (one ACTIVE scheduled event per channel). The
  fix is small and suite-level: `setup.ts:278-288` picks `voiceChannels[SMOKE_POOL_INDEX %
  voiceChannels.length]` instead of `[0]`. There are 3 non-slot voice channels
  (`General`/`GamerNight`/`WoW`), so **the pool size is capped at 3**. This rotates within the
  existing non-slot set. It is not a channel set and creates no channels (operator Q4).
- **Residual risks to verify in the PR:**
  - the companion bot (`TEST_BOT_TOKEN`) opens two gateway sessions. Discord allows that for a
    bot that only reads, but it needs a check;
  - ephemeral-voice `⏰ … — Playing now` channel names could collide. The voice-join tests are
    skipped in CI (`:127`), but creation paths may still run;
  - the guild-wide 100-event cap now has up to 3 CI runs plus the fleet drawing on it.
- **Effort:** M (the lease pool, a token-select step and the voice rotation) plus operator portal work.
- **Satisfies:** AB1, AB2 and AB3, and it roughly halves or thirds the serial guild time.
- **Why namespacing alone fails:** tagging artifacts per run without separate identities does not
  work. Product embeds carry no run tag, "exactly one card per group" assertions count every card
  from the bot, and interactions still split across two gateways.

### (d) Cheaper levers

- **d1. Gate main pushes on the path filter too.** Change `:72-75` so a `push` also needs
  `discord == 'true'`, and add `package.json`/`package-lock.json` to the filter so dependency
  bumps (e.g. discord.js) still get post-merge smoke. Dependabot PRs cannot run it, so today the
  push run is their only validation (`:185-188`).
  - Of 190 main commits, 119 touched no Discord path. That would have removed about 60% of
    guild-holding push runs, including most of the 13 main-push evictors and the 47 main-push victims.
  - Effort: S. Satisfies AB1 partially. Zero interference change.
- **d2. Auto re-run evicted runs** (a `workflow_run` trigger on `conclusion == cancelled` that
  calls `gh run rerun` when the head SHA is still current). The re-run re-enters the one-slot queue
  and evicts whoever is pending, which ping-pongs. **Reject.**
- **d3. Merge queue.** GitHub merge queue is not offered on user-owned repos (believed; unverified
  for this plan). Even where it exists, it serialises merges, not PR-time checks. **Reject.**

## 3. Forum-clutter sub-problem (Chao Chao threads)

- **`lfg-board.test.ts` cleans up after itself.**
  - `cleanup()` at `tools/test-bot/src/smoke/tests/lfg-board.test.ts:624-651` deletes its tracked
    thread, its probe message and every retired thread (`:637-640`). Helpers:
    `fixtures-lfg-board.ts:183-205`.
  - It deletes the forum itself only when this run created it (`:646-650`).
  - This has been in place since the original board PR (`3ab490ab6`, #1102, 2026-09-05).
  - It also avoids Chao Chao: `GAME_SCAN_OFFSET = 8` (`:133`) skips the last 8 games.
- **`lfm-embed.test.ts` and `lfm-playing.test.ts` do not.** They pick from the reversed registry
  with **no offset** (`GAME_SCAN_LIMIT = 8`, `lfm-embed.test.ts:74`), so they land on Chao Chao,
  the last seeded game (`api/src/games-lookup/seed-games.data.ts:270`). Their `cleanup()`
  (`lfm-embed.test.ts:427-439`) withdraws intents, aborts the lineup and deletes the binding. It
  **never deletes the Discord post/thread.**
- **Inference (not reproduced):**
  - In GitHub CI the board toggle starts off in the fresh DB, so LFM posts go to text channels, not
    to a forum.
  - The Chao Chao threads therefore come from runs against an env whose board is **on and
    pre-existing**: a fleet env or a local env with the operator's synced settings. There, since
    ROK-1505, every hand posts to the forum ahead of the text binding
    (`lfg-surface-lock.ts:4-9`).
  - That is the operator's board.
- **Fix (independent of parallelism, S):**
  - LFM tests record any forum thread their hands spawned and delete it in `finally`, as
    `lfg-board.test.ts` does. That needs one `withLfgSurface`-aware "threads created since" helper.
  - Add a `GAME_SCAN_OFFSET` so they stop converging on one game.
- **Satisfies:** AB4.

## 4. Recommendation

**Phase 1 (one PR, S): stop losing runs.** Contents:

- the a2 ref lease in place of `concurrency:` on the `discord-smoke` job;
- d1, push runs gated on the path filter with `package*.json` added;
- the §3 LFM thread teardown.

This PR is workflow and test-bot only. It touches no API, contract or migration code. Evictions
go to 0, because a waiting run shows *in progress*, never vanishes. The 2026-09-06 interference
cannot recur because the lease is still exclusive.

- **Proof:** open two throwaway Discord-path PRs at once and confirm both reach a conclusion.
- **Watch:** the lease step's log of wait time.

**Phase 2 (M, after the operator creates bots): buy throughput.**

- Option c with a pool of 2 at first: one new CI application plus today's bot, which the lease
  generalises to.
- `SMOKE_POOL_INDEX` voice-channel rotation.
- Verify the three residual risks listed under (c).
- Prove it with the same two-PR test, and with a `grep` of both logs showing no foreign bot author
  ids read.

Option b is rejected. Option a1 only gives the same result as a2, with worse security on a public repo.

## 5. Operator questions

1. **Accept the phased plan, with Phase 1 serial and eviction-free first?**
   Recommended: yes. It fixes the vanishing required check without any Discord-side setup.
2. **Should the lease be an in-repo script or the third-party `ben-z/gh-action-mutex` action?**
   Recommended: an in-repo script (about 60 lines, `refs/locks/...`, no supply-chain dependency on
   a job that holds bot tokens). If the action is used, pin it by SHA.
3. **May main pushes that touch no Discord path skip smoke (d1)?**
   Recommended: yes, with `package.json`/`package-lock.json` added to the filter so dependency
   bumps keep post-merge coverage.
4. **Does rotating CI's *default voice channel* across the existing non-slot voice channels via
   `SMOKE_POOL_INDEX` comply with the 2026-09-25 channel ruling?**
   Recommended: yes. It creates no channel, names no set, and never selects `slot-*`.
5. **Will you register one extra Discord application for CI (Phase 2, pool = 2) and add its
   token, client id and secret as GitHub secrets?**
   Recommended: yes, one now. Consider a third only if the Phase 1 wait-time logs show queues
   deeper than 2.
6. **Should fleet slot bots stay strictly fleet-only (option b rejected)?**
   Recommended: yes. Sharing them with CI splits gateways and crosses scheduled-event ownership
   with preserved envs.
7. **Separate from this story: should fleet envs stop joining CI's guild, or default scheduled
   events off?** Memory records three CI outages from fleet-env scheduled events filling the
   guild's 100-event cap or its active-event-per-channel slot.
   Recommended: file it as its own story. It is the biggest remaining shared-guild risk even after
   Phase 2.

## Handover

**Done:**

- eviction data measured over the full 09-11→09-25 window (674 runs, per-job API);
- shared-resource map with `file:line` citations;
- options a–d assessed;
- forum-clutter root cause traced to the LFM tests' missing thread teardown plus the no-offset
  game scan;
- phased recommendation and operator questions.

**Uncertain:**

- evictor attribution is the next guild-holding run, an inference;
- the 526-min max queue wait was not inspected (possibly a re-run attempt);
- the Chao Chao source environment is inferred, not reproduced;
- merge-queue availability for user-owned repos was not verified against current GitHub docs;
- the companion bot's two concurrent gateway sessions, and ephemeral-voice channel name
  collisions, are unverified for Phase 2;
- whether GitHub has since added a deeper concurrency queue (which would make a2 unnecessary)
  was not checked.

No code was written.
