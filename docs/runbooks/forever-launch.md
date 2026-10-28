# WoW: Forever launch day runbook (ROK-1929)

**Launch:** Tuesday 2026-11-04. **Story:** ROK-1929 (epic ROK-1905, item H12).
**Source audit:** `planning-artifacts/FOREVER-LAUNCH-READINESS-2026-10-28.md` (gitignored; main checkout only).

Owners are roles:

- **Operator**: the human who runs Raid Ledger. Owns prod, Discord, the game client and the Windows PC.
- **Lead session**: the on-call Claude Lead session for the launch window. Reads Sentry and logs, runs fleet work, writes the go/no-go table.
- **Officer**: a guild leader or officer of a real Forever guild on prod.

Every claim cites a file. Anything marked **UNVERIFIED** could not be confirmed from the code on main.

---

## 1. Ground rules (operator rulings 2026-10-28)

1. **No manual prod pull. No freeze.** Prod takes only the daily 5 AM ET Watchtower pull. Anything needed on day 1 must merge before ~04:30 ET on Nov 4. Aim for Nov 2–3, so it gets a day on prod first.
2. **One fix per outage. Revert, don't stack.** If a launch-day fix fails, revert to the last good commit. Do not push a second fix on top (CLAUDE.md "Infrastructure Changes"; memory `feedback_one_fix_per_outage`). A revert still reaches prod only on the next 5 AM pull, so the per-hub hide in §5 is the same-day fallback.
3. **Professions from the addon (ROK-1907 / H11) are post-launch.** The Guild professions widget runs on manual entry only (`web/src/plugins/wow/hub-widgets/professions.register.ts`).
4. **Dungeon quests may be empty for real events on day 1.** ROK-1908 (the alias map and full dataset) lands Nov 4–5.
5. **Companion + LedgerLink auto-sync is day 1 for the Operator only.** Other guilds paste strings by hand.
6. **Real launch strings become fixtures only after anonymisation.** No real names, GUIDs or guild names (CLAUDE.md "LedgerLink addon contract").

---

## 2. Before launch (Nov 2–3)

| # | Step | Owner |
|---|---|---|
| 2.1 | Confirm prod = main. `GET /api/system/version` returns the expected `commitSha`. | Lead session |
| 2.2 | Run the fleet rehearsal plan in §8 on a main-built env. Both `default-dark` and `default-light`, desktop and phone. | Lead session (via a `fleet-ui-verify` lane) |
| 2.3 | Install the Companion app on the Windows PC. It is unsigned, so Windows SmartScreen blocks it: click **More info → Run anyway**. Link it to your account under My Integrations (ROK-1955, commit `36fea9f87`). | Operator |
| 2.4 | Confirm LedgerLink is installed in the game client and set to auto-export on logout. **UNVERIFIED:** the auto-export-on-logout setting lives in the addon repo (`sjdodge123/ledger-link`), not here. | Operator |
| 2.5 | Name the on-call Lead session for the US launch window (§6). | Operator |

---

## 3. Launch day steps (Nov 4)

Do these in order.

### 3.1 Check the 5 AM pull landed — Lead session

1. `GET /api/system/version`. Note the `commitSha`.
2. Compare it with `origin/main` as of ~04:30 ET. If they differ, the pull did not run. Tell the Operator. Do **not** ask for a manual pull (§1.1).

### 3.2 Fill the realm → ruleset map — Operator

The Companion auto-creates characters only when the realm's ruleset is known. The import path asks this map (`api/src/plugins/wow-common/addon-import/addon-import-create.service.ts:165`, `realmRulesets.inferForPaste`).

1. Open **Admin Settings → Integrations** (`/admin/settings/integrations`, `web/src/app-routes.tsx`). The Blizzard card holds the **Forever realm rulesets** section (`web/src/plugins/wow/slots/admin-settings-integration-cards.tsx:117`, `ForeverRealmRulesetsSection`).
2. Add one row per live Forever realm, with its ruleset (Normal, Hardcore and so on).
3. Save. The API route is `PUT /api/admin/plugins/blizzard/forever/realm-rulesets` (`api/src/plugins/wow-common/forever-realm-rulesets.controller.ts:19`).
4. **UNVERIFIED:** the live realm names. They come from the game client on launch day.

### 3.3 Import a real character string — Operator

1. Log in to Forever, then log out. LedgerLink exports on logout and the Companion uploads it.
2. If the Companion does not pick it up, paste by hand. The route is `POST /api/plugins/wow/characters/addon-import` (`api/src/plugins/wow-common/addon-import/addon-import.controller.ts:35,44`).
3. **Hardcore characters can't be imported yet**, by paste or by the Companion. Creating a character with the `hardcore` ruleset is refused ("Hardcore characters can't be added from an import yet.", `assertCreatable` in `api/src/plugins/wow-common/addon-import/addon-import-create.helpers.ts`; ruling A1: refuse until Hardcore opens). If Hardcore realms are live on launch day, that refusal has to be lifted by a code change first. Until then, mark Hardcore as **off** in the go/no-go table.
4. Check the character page shows class, level and realm.

### 3.4 Import a real guild string — Officer (Operator stands in if no officer is ready)

1. In game, run the LedgerLink guild export (`/ledgerlink`; the hub card says "Install LedgerLink from CurseForge or GitHub…", `web/src/plugins/wow/slots/players-guild-card.tsx`). **UNVERIFIED:** the exact slash-command flags live in the addon repo.
2. Paste the string into Raid Ledger (same import route as 3.3).
3. Open the guild hub at `/hubs/<id>` (`web/src/app-routes.tsx:162`). The roster should list members.

### 3.5 Anonymise and keep the strings as fixtures — Lead session

1. Save the two raw strings **outside the repo** (scratch only). Never commit them raw.
2. Replace every real character name, GUID and guild name.
3. Add them to `packages/contract/ledgerlink/v1/fixtures/` in a normal Raid Ledger PR. It is a fixtures-only change: it updates `CHANGELOG.md` and says **additive** in the PR body (CLAUDE.md "LedgerLink addon contract"). Alert the LedgerLink agent (memory `feedback_alert_ledgerlink_on_contract_change`).

### 3.6 Check every MUST widget on the prod Forever hub — Lead session (a `fleet-ui-verify`-style lane can't reach prod, so the Operator screenshots if needed)

Open `/hubs/<id>` for the guild from 3.4. Check each row of the go/no-go table in §4. Every widget is declared in `packages/contract/src/plugin-hub-manifests.ts:99-105` (plugin `blizzard`, `gameSlugs: ['world-of-warcraft-forever']`).

### 3.7 Run the ROK-1716 namespace discovery probe — Lead session asks, Operator clicks

The probe is already **scheduled**. Two cron jobs exist (`api/src/plugins/wow-common/wow-cron-registrar.ts:39-51`):

- `forever-namespace-probe` — daily at 05:00.
- `forever-namespace-probe-launch` — hourly at :30, but only inside the launch window `2026-11-04T00:00Z` to `2026-11-19T00:00Z` (`forever-namespace-probe.helpers.ts:38-39`).

On launch day:

1. Open **Admin Settings → General → Cron jobs** (`/admin/settings/general/cron-jobs`). Confirm both jobs exist and the last `forever-namespace-probe-launch` run did not fail. A failed probe fails the cron run on purpose (`wow-cron-registrar.ts:96-101`).
2. To run it now, use the probe panel on the Blizzard integration card (`web/src/plugins/wow/components/forever-probe-panel.tsx`, rendered by `forever-settings-section.tsx`). The API route is `POST /api/admin/plugins/blizzard/forever-probe/run` (`forever-namespace-probe.controller.ts:29,42`). `GET` on the same base returns the last result.
3. The probe only **reports**. It never flips the Forever settings (`forever-namespace-probe.controller.ts:24-27`). If it finds a live namespace, file the follow-up (ROK-1920 / ROK-1928). Don't turn on Armory import on launch day.
4. **UNVERIFIED:** the cron timezone (server time vs ET).

### 3.8 Schedule the ROK-1748 D2 dungeon-quest dataset import — Lead session

The dataset is built **offline** and ships as a file. The app never fetches quest data at runtime (`api/scripts/prepare-forever-dungeon-quests.ts:1-18`).

1. Today the file `api/src/plugins/wow-common/data/forever-dungeon-quest-data.json` uses placeholder instance ids `90000001–90000004` (audit §2b-6).
2. Zones 5–11 in `FOREVER_WOWHEAD_ZONES` are still `null` (`api/src/plugins/wow-common/forever-quest-import/forever-quest.zones.ts:16-22`). The `--live` run refuses while any zone is null.
3. Once Wowhead lists the Forever dungeon pages, a dev lane (ROK-1908) fills the zone ids, runs `cd api && npx ts-node scripts/prepare-forever-dungeon-quests.ts --live`, and opens a PR with the new JSON. The script refuses to run under jest/CI.
4. After merge, the next 5 AM pull boots the API, and the boot seeder upserts the quests (`wow-common.module.ts:164-166`, `seedOnBoot` → `seedQuests`).
5. On launch day, check whether real Forever events' dungeon instance ids match the placeholders. If not, ROK-1908's alias map fixes it. Target: Nov 4–5.

### 3.9 Write the go/no-go table — Lead session

Fill §4 and post it in `CURRENT-STATE.md` and the Linear story.

---

## 4. Go / no-go per widget

Status: **green** = renders real data. **degraded** = renders but with gaps (say why). **off** = hidden on purpose (§5).

Each widget hides itself until it has data, through its `useVisible` hook. That is expected, not a failure.

| Widget id | Title | Self-hides when | Day-1 data source | Expected day 1 | Status | Notes |
|---|---|---|---|---|---|---|
| `forever-class-breakdown` | Class breakdown | roster has no rows (`class-level.register.ts:15-22`, `useHasRoster`) | one officer guild export | green | | |
| `forever-level-progression` | Level progression | roster has no rows (same) | one officer guild export | green | | |
| `forever-roles` | Role breakdown | no known role yet (`roles.register.ts`, `useRolesWidgetVisible`) | guild export + member characters | green or degraded | | Few members export on day 1. |
| `forever-professions` | Guild professions | roster insights carry no `professions` array (`professions.register.ts:13-14`) | manual entry only (H11 is post-launch) | degraded | | Manual only, by ruling. |
| `forever-dungeon-quests` | Dungeon quests | no upcoming guild event with planned content, or a visitor (`dungeon-quests.register.ts:20-25`) | dataset with placeholder ids | degraded | | Empty for real events until ROK-1908 (§3.8). |
| `forever-recent-dings` | Recent dings | shows an empty state instead (`recent-dings.register.ts:5`) | repeated guild exports | degraded | | Needs a second export to see a ding. |
| `forever-whos-saved` | Who's saved | gated on a key (`whos-saved.register.ts`, `useWhosSavedVisible`) | member character exports (lockouts) | degraded | | Raids are likely closed on day 1. |

Write **why** for every degraded row. A widget that throws an error or shows wrong data is **off** (§5).

---

## 5. Fallback: hiding a widget

There is **no global per-widget kill switch** on main. These are the real levers, smallest first:

1. **It hides itself.** Every Forever widget has a `useVisible` gate (§4). No data means no card. Nothing to do.
2. **Hide it on one hub.** A leader, officer or staff member uses **arrange mode** on the hub Overview to hide the widget (ROK-1918). API: `PATCH /api/guilds/:id/widget-prefs` (`api/src/guilds/hub.controller.ts:99`; service `api/src/guilds/hub-widget-prefs.service.ts`, guarded by `GuildEditorGuard`). Owner: Officer, or the Operator as admin.
3. **Revert the commit** that broke it. It reaches prod at the next 5 AM pull (§1.1). Do not stack a second fix (§1.2). Owner: Lead session opens the revert PR, Operator approves.
4. **Last resort: deactivate the `blizzard` plugin** (`POST /api/admin/plugins/blizzard/deactivate`, `api/src/plugins/plugin-host/plugin-admin.controller.ts:77`; UI at `/admin/settings/plugins`). This hides **every** WoW guild-hub widget and stops its cron jobs, the probe included (`forever-namespace-probe.controller.ts:30-31`, `RequirePlugin('blizzard')`). Only the Operator decides this.

---

## 6. Monitoring (US launch window)

| What | Where | Owner | Trigger |
|---|---|---|---|
| Named on-call Lead session | `CURRENT-STATE.md` names it | Operator names, Lead session runs | Whole US launch window |
| Sentry: addon-import errors | Sentry, routes `plugins/wow/characters/addon-import` | Lead session | Any new issue |
| Sentry: roster-insights errors | Sentry, route `GET plugins/wow/guilds/:id/roster-insights` (`api/src/plugins/wow-common/guilds/guilds.controller.ts:118`) | Lead session | Any new issue |
| Sentry: quest-readiness errors | Sentry, `event-quest-readiness.controller.ts` | Lead session | Any new issue |
| LedgerLink import reject rate | 4xx (422) from the import route; the clock-window rule is `addon-import.clock.ts` | Lead session | A cluster of rejects from one guild |
| Probe run result | Cron jobs page, `forever-namespace-probe-launch` | Lead session | A failed run |

Sentry is wired app-wide (`api/src/app.module.ts:109-110`, `SentryModule.forRoot()`). **UNVERIFIED:** whether import 4xx rejects reach Sentry at all. 4xx are usually not captured, so the reject rate may need log queries instead. **UNVERIFIED:** a ready-made Sentry saved search or alert for these routes.

If an alert fires: find the cause, ship **one** fix or a revert (§1.2), and hide the widget on the affected hub meanwhile (§5.2).

---

## 7. After launch (Nov 4–5)

1. ROK-1908 lands the dataset and alias map (§3.8). Lead session.
2. Recheck `forever-dungeon-quests` and flip its row in §4. Lead session.
3. Anonymised fixtures PR merged (§3.5). Lead session.
4. Probe results reviewed daily until `2026-11-19`. Lead session.

---

## 8. Fleet test plan (pre-launch rehearsal)

Paste into `rl_test_plan_create` on a main-built env. Seed **after** the fleet gate (gates reset the DB). Seed with `POST /api/admin/test/wow/seed-guild`, body `{"name":"Launch Rehearsal","withContent":true,"withLockouts":true,"withDings":true}` (`api/src/admin/demo-test-guild.controller.ts:125,136`). The default `gameSlug` is Forever (`demo-test-guild.helpers.ts:88`). The reply gives `guildId` and users `gm`, `officer`, `member`, `outsider` (`demo-test-guild.helpers.ts:26`). Sign in as each with `POST /api/admin/test/sign-in-link` (`demo-test-sign-in-link.controller.ts:48,70`). Check `default-dark` and `default-light`, desktop and phone.

| # | Description | Expected | Seeded user | test_url |
|---|---|---|---|---|
| 1 | Open the seeded Forever guild hub Overview. | Class breakdown and Level progression show the seeded roster. | `member` | `https://slot-N.gamernight.net/hubs/<guildId>` |
| 2 | Check Role breakdown and Guild professions on the same hub. | Roles show tanks/healers/DPS. Professions shows its manual state with no error. | `member` | `https://slot-N.gamernight.net/hubs/<guildId>` |
| 3 | Check Who's saved and Recent dings. | Who's saved lists the seeded lockouts. Recent dings lists two rows (Aldren and Corvin). Dainel's ding is seeded 31 days ago, outside the 30-day feed, so it must NOT show. | `member` | `https://slot-N.gamernight.net/hubs/<guildId>` |
| 4 | Check Dungeon quests. | Shows for the seeded content event, or stays hidden with no error if none is upcoming. | `officer` | `https://slot-N.gamernight.net/hubs/<guildId>` |
| 5 | Visitor view. | Dungeon quests is hidden for the visitor. Nothing errors. | `outsider` | `https://slot-N.gamernight.net/hubs/<guildId>` |
| 6 | Arrange mode: hide Recent dings, then show it again. | The card disappears and comes back. **reset_hint:** show the widget again. | `gm` | `https://slot-N.gamernight.net/hubs/<guildId>` |
| 7 | Admin: open the Blizzard card, add a realm ruleset row, run the probe. | The row saves. The probe returns a result with no 500. **reset_hint:** delete the row. | `admin@local` | `https://slot-N.gamernight.net/admin/settings/integrations` |
| 8 | Admin: cron jobs page. | `forever-namespace-probe` and `forever-namespace-probe-launch` are listed. | `admin@local` | `https://slot-N.gamernight.net/admin/settings/general/cron-jobs` |

**UNVERIFIED:** whether the seeded content event in step 4 is upcoming and has Forever dungeon content; check the seed reply's `raids` and `content` first.
