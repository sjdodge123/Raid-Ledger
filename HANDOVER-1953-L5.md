# ROK-1953 L5 handover: Playwright smoke + fleet test plan rows

## Handover

**Status:** spec committed `1b0de1e54`; this handover is the plan input. NOT run (no Playwright on the laptop). `npx tsc --noEmit -p scripts/smoke/tsconfig.typecheck.json` (repo root) exit 0. `scripts/smoke` has no eslint config (scoped gate = tsconfig only).

**Fleet run:** `rl_validate_ci({args:["--only-e2e"], e2e_specs:["scripts/smoke/hub-steam-stats.smoke.spec.ts"], against_env_slug, base_url:"https://slot-N.gamernight.net"})` (desktop + mobile, both projects).

**Filename:** the brief's `hub-steam-stats.smoke.spec.ts` (the spec §7 says `hub-steam-stats.spec.ts`, which `playwright.config.ts` `testMatch: /\.smoke\.spec\.ts$/` would never pick up). Reconcile §7/§8 in the spec.

## Cases (`scripts/smoke/hub-steam-stats.smoke.spec.ts`)
1. B: both cards; race A `5 / 6`, B `3 / 6`, D off the race; 1–4 `steam-unlock-row`; `steam-masked-achievement` = "Hidden achievement"; `steam-rarest` `Rarest: Hidden achievement · 2.7%`; page body never contains `Demo Secret Ending|Romance`; playtime rows A `/121/`, B `/40/`.
2. A: `steam-rarest` names "Demo Secret Ending"; zero masked rows.
3. C (private): `steam-stats-callout` has `text-warning`; no `steam-stats-link`; C off the race.
4. D (unlinked): callout "Link Steam to join the race." + `Link Steam` button.
5. Non-member (smoke invitee fixture) on `<H>`: neither cell.
6. Member B on a non-BG3 game's "Seed Crew": awaits the `/hubs/<id>/steam-stats` response = `{ available: false }`, then no `[id^="hub-widget-core-steam-"]` cell.

## Decisions (do not undo)
1. **One shared seed under a cross-worker file lock** (`mkdir` in `os.tmpdir()`, keyed by `API_BASE`; stale after 120 s; cache file `<lock>.json`). Every test is read-only. The seed is reused while `GET /hubs/<H>/steam-stats` (admin) still reports 6 achievements, A=5, B=3. Why: `seedMemberStats`/`seedAppSchema` delete and re-insert the same users' rows outside a transaction, so two projects seeding at once can hit a unique violation (500) or catch the other's delete window mid-read.
2. **Non-enabled hub** = `community-hubs/seed {gameId}` on configured non-BG3 game index `9 + parallelIndex` (community-hubs 0–2, hubs-nav 3–5, hub-invite/hub-poll 6–8). A community hub rather than the spec's Valheim server hub: no Pelican/Valheim fixture is needed, and the route's D1 rule (only BG3's app id enabled) is the same either way. Plan step 9 does use a Valheim hub (below).
3. Non-member = `getInviteeFixture()` (an existing idempotent user, in no seed hub).
4. Hours are matched loosely (`/121/`, `/40/`): the format comes from `steam-stats.helpers.ts` and is pinned by L4's vitest, not here.

## Risks to watch on the first fleet run
- **BG3 collides with another hub spec's game index.** `community-hubs/seed {}` resets BG3's fixture, so if BG3 is configured index 0–8, community-hubs / hubs-nav / hub-invite / hub-poll re-seed BG3 and delete `<H>` mid-test (or this spec deletes theirs). If that happens, the fix is server-side: a `name` (or `fixtureKey`) option on the community-hubs seed so this spec gets its own BG3 hub. Not done here (API scope).
- Case 5 asserts absence after `community-hub-kind` is visible, not after a probe response, because a non-member Overview may never fire the probe. If it ever goes green with a broken gate, add a staff check instead.
- If seed users have a display name, `displayName` ≠ username and `seedIsLive` never matches; the poll then fails with "GET /hubs/<H>/steam-stats serves the seeded race".

## Fleet test plan rows (create AFTER the fleet gate; seed AFTER it, as `admin@local`)

Seed: (1) `POST /admin/test/community-hubs/seed {}` → `hubIds.crew` = `<H>`; (2) `POST /admin/test/steam-app-stats/seed {"guildId": <H>}` → users a..d = `community-member-1..4`; (3) Valheim hub `<V>`: `POST /admin/test/valheim/link-fixture {}` (`api/src/plugins/valheim/link/valheim-link-demo-seed.controller.ts:81`; it also activates the Valheim + Pelican plugins). Read the server-hub id and a member from its response; if it has none, use `community-hubs/seed {gameId: <valheim game id>}` → its `hubIds.crew` as `<V>` with `community-member-2`. Every step: `default-dark` AND `default-light`. Reset hint on every step: "re-run the steam-app-stats seed for `<H>`". Sign-in: `rl_env_signin_link` as the named user.

| # | test_url | As | Viewport | Expect | Reset |
|---|---|---|---|---|---|
| 1 | `https://slot-N.gamernight.net/hubs/<H>#hub-widget-core-steam-achievements` | `community-member-1` (A) | desktop 1280 | Race: A 5 / 6 above B 3 / 6; C and D only in the footnote counts; A's hidden unlocks show their real names (Demo Secret Ending / Romance); a neutral "Rare" chip on the under-10% rows; "Rarest: Demo Secret Ending · 2.7%" | steam seed |
| 2 | same | `community-member-2` (B) | desktop 1280 | A's hidden unlocks read "Hidden achievement" + %; hover / tooltip / devtools text never shows "Demo Secret"; Rarest reads "Hidden achievement · 2.7%" | steam seed |
| 3 | same | `community-member-2` (B) | phone 375 | One column; rows ≥44px tall; no horizontal scroll; masked rows same as step 2 | steam seed |
| 4 | same | `community-member-4` (D) | tablet 820 | "Link Steam to join the race." + secondary "Link Steam" button; D absent from the race and playtime rows. Do NOT complete Steam OAuth (OPERATOR if a real link is needed) | steam seed |
| 5 | same | `community-member-3` (C) | phone 375 | Warning-tone private-profile line, no Link Steam button; C absent from the race; C still on Playtime if they have library hours | steam seed |
| 6 | `https://slot-N.gamernight.net/hubs/<H>#hub-widget-core-steam-playtime` | `community-member-1` (A) | desktop 1280 + phone 375 | Hours ranked A (~121 h) above B (~40 h); meter scaled to the top row; lifetime-hours footnote; no D row | steam seed |
| 7 | `https://slot-N.gamernight.net/hubs/<H>` | a non-member (smoke invitee or any user not in Seed Crew) | desktop 1280 | Neither Steam card | none |
| 8 | `https://slot-N.gamernight.net/hubs/<H>` (open Arrange) | `community-leader` | desktop 1280 | Both cards listed with descriptions, owner label "Core"; hide then show each works | Restore the default layout in Arrange |
| 9 | `https://slot-N.gamernight.net/hubs/<V>` | a member of `<V>` | desktop 1280 | No Steam cards (Valheim's app not enabled) | none |
| 10 | `https://slot-N.gamernight.net/admin/settings/plugins` (confirm the path against the ROK-1969 plugins page; UNVERIFIED) | `admin@local` | desktop 1280 | Core card's setup lists "Steam Web API key" and "Players link Steam", both marked optional | none |
| 11 | `https://slot-N.gamernight.net/dev/design-system#hub-widgets` | `admin@local` | desktop 1280 | The Steam cards sample renders in both families via the scheme switcher / side-by-side view (L4 checked tokens only) | none |

OPERATOR-only: a real Steam link plus a real BG3 profile check.

## Not done
- No Playwright run (fleet lane). No `rl_test_plan_create` (no rl_* tools); the rows above are its input.
- Step 10's admin path and step 9's Valheim seed response shape are UNVERIFIED. The plan lane confirms them before creating the plan.
