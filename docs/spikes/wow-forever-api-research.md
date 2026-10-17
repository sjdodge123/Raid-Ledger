> **Source:** `planning-artifacts/WOW-FOREVER-API-RESEARCH-2026-10-04.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-10-04
> **Linear:** ROK-1562

# WoW: Forever — Battle.net API research (2026-10-04)

Research lane for ROK-1562 (spike) / follow-up to ROK-1636 (PR #1307). Read-only on repo and Linear. Code refs are against `origin/main` @ 2026-10-04.
Web content was treated as untrusted data. "Staff" means a Blizzard blue post as reported by the forum page; everything else is community.

## Summary

- **Launch date: CONFIRMED 2026-11-04** (Blizzard shop page + Wikipedia + every guide site agree; beta started 2026-09-17; early name reservation 2026-10-27 → 11-03 is on an official Blizzard news post).
- **API availability: NOT announced.** No Blizzard statement, docs page, changelog entry or staff forum reply mentions a Forever Game Data / Profile namespace, guild/roster, armory, AH or achievements. The only API-forum thread ("When will we gain API access to Forever APIs?", opened 2026-09-18) has **no staff reply** as of 2026-09-28. Every third-party tool (Guildbook, holdfast, armorywowforever, aotc.gg, Pewtro/blizzard-api) is waiting for launch and guessing.
- **Biggest structural risk for us is not the namespace — it is identity.** Forever is officially **realmless** (4 rulesets: Normal / PvP / Roleplaying / Hardcore-post-launch) and uses **two-part character names unique per region**. Our whole Armory path is keyed on `realm slug + single-word name` (`buildCharacterParams`). Even when a namespace appears, the profile URL shape (`/profile/wow/character/{realmSlug}/{name}`) may not fit.
- **Precedent says: expect lag, forum-only disclosure, and partial coverage.** Classic profile/guild endpoints were hidden for ~4 years (opened in 1.14.4, Aug 2023); TBC Anniversary's `classicann` namespace surfaced on the forum ~2–3 weeks after the realms moved and is still not in the official docs; Classic AH has been broken since Oct 2024. Plan for "no API at launch, maybe weeks-to-months after, possibly never for some endpoints".
- **Recommendation:** ship a cheap automated namespace probe + make the prefix runtime-configurable *before* 11-04, and get an operator ruling on the realmless/two-part-name identity model now; do not build sync features until the probe goes green.

## Confirmed facts (official Blizzard sources)

| Fact | Source | Date |
|---|---|---|
| Product exists, sold on Battle.net shop | https://us.shop.battle.net/en-us/product/world-of-warcraft-forever | fetched 2026-10-04 |
| Announced BlizzCon 2026-09-12; beta 2026-09-17; release 2026-11-04; level cap 60; new zones, 9 dungeons, 2 raids, Skyborne Elves, Forsaken Paladin / Dwarf Shaman; included with WoW sub; Win+macOS | https://en.wikipedia.org/wiki/World_of_Warcraft:_Forever (secondary, cites Blizzard) | fetched 2026-10-04 |
| Realmless: player picks a **ruleset** (Normal, PvP, Roleplaying, Hardcore). Hardcore "sometime after launch". Each ruleset is "a broad player ecosystem rather than a single traditional realm". No cross-ruleset dungeon/raid grouping; BGs may cross rulesets (not Hardcore). PvP ruleset = one faction per account. Dead Hardcore chars can move to other rulesets. | https://news.blizzard.com/en-us/article/24302070/choose-your-ruleset-in-world-of-warcraft-forever | article undated in fetch; Sept 2026 |
| **Two-part names** (first + second/surname), full name **unique within a region**; secondary name can be hidden in-world. Early Name Reservation 2026-10-27 → 2026-11-03. | https://news.blizzard.com/en-us/article/24304161/create-a-name-of-your-own-in-wow-forever | Sept/Oct 2026 |
| No API ever promised: the official Forever/ruleset/name posts do not mention armory, web profiles, guild pages or the developer API. | the two news posts above | — |
| API forum: thread "When will we gain API access to Forever APIs?" — 5 posts 2026-09-18 → 2026-09-28, **no staff reply**. | https://us.forums.blizzard.com/en/blizzard/t/when-will-we-gain-api-access-to-forever-apis/59595 | fetched 2026-10-04 |
| Official namespace guide (develop.battle.net) — SPA, not fetchable by this lane; ROK-1562 (2026-09-14) and ROK-1636 (2026-09-22) both recorded no Forever namespace there. Not re-verified today. | https://community.developer.battle.net/documentation/world-of-warcraft/guides/namespaces | — |

Exact launch hour: ROK-1562 says 15:00 PT; one community page (wowforever.co / search snippet) says 23:00 UTC (= 15:00 PST, consistent). Regions at launch are not enumerated in any official source fetched (names are "unique within a region", so regional split exists; KR/TW/CN unconfirmed).

## Unconfirmed / speculation / datamining

- "Blizzard has never provided an API for beta or PTR" — community post (Zalki, 2026-09-18, thread 59595). **Contradicted by precedent**: staff (Korakk) published `dynamic-classic-beta` Auction + Arena endpoints for TBC Classic beta on 2021-05-27 (https://us.forums.blizzard.com/en/blizzard/t/tbcc-api-preview-release-for-beta-realms/16695). So a beta/launch-week preview is possible but rare.
- Our own observation (ROK-1636, 2026-09-22): `dynamic-classicforever-{us,eu,kr,tw}` → **403**. Guessed prefix, not evidence of anything.
- Guildbook README: "Blizzard … hasn't published one [profile namespace] for Forever yet"; defaults to `profile-classic1x-{region}` and exposes `BATTLENET_PROFILE_NAMESPACE` / `BATTLENET_SCAN_NAMESPACES` env overrides; verification "opens when the game launches on November 4, 2026". https://github.com/Guildbook/guildbook (fetched 2026-10-04). Useful pattern: configurable + scan list.
- holdfast issue #27 (2026-09-27): rule "never substitute Retail/Era/seasonal namespace for Forever data; report unsupported instead". https://github.com/Indicaza/holdfast/issues/27 — same stance as our `blizzard.constants.ts` comment.
- Pewtro/blizzard-api #110 (2026-09-14): maintainer plans a separate `wow-forever` package; no API evidence. https://github.com/Pewtro/blizzard-api/issues/110
- armorywowforever.com: "opens at launch, as soon as Blizzard grants access to its API"; "one world per game mode, two-part character names … found by region, game mode and name". aotc.gg/forever claims "live … as soon as Battle.net character data exists". Both are pre-built shells, no data. (fetched via search 2026-10-04)
- Client/addon API: community guides say Forever runs a **modern client API** (interface 16001 reported, namespaced trade-skill calls, restricted chat/unit-identity values) — https://classicwowforever.com/guides/wow-forever-addons-api-compatibility/ , https://wowforeverguides.com/addons/developers . Unverified; relevant only as a hint that Forever is on a newer branch than Era (1.15), so its web-API namespace is unlikely to be `classic1x`.
- lfcarry (updated 2026-09-29): "Guild scope, the Auction House and the size of each ecosystem are open questions. Blizzard has not published them yet." https://lfcarry.com/guides/wow-forever-realmless
- Icy Veins / Mobalytics / Tweaktown pages returned 403 to the fetcher; only search snippets seen.

## Precedent from prior Classic launches

| Launch | Namespace outcome | Timing vs launch | Source |
|---|---|---|---|
| WoW Classic (2019) → Classic Era | Game Data on `*-classic`/`*-classic1x`; **Profile/guild endpoints hidden** | Opened in patch **1.14.4, staff post 2023-08-04** (~4 years later): `/character`, `/equipment`, `/pvp-*`, `/statistics`, `/hunter-pets`, `/guild`, `/guild/roster`, `/guild/activity`, `/guild/achievements`; achievements/specs "at a later date"; PTR on `classic-ptr` | https://eu.forums.blizzard.com/en/wow/t/new-apis-now-available-for-testing/461426 (Kaivax, staff) |
| TBC Classic (2021) | `dynamic-classic-beta` preview (AH + arena) | **During beta**, ~1 week pre-launch | thread 16695 (Korakk, staff, 2021-05-27) |
| Hardcore / Season of Discovery (2023) | **No new namespace** — share `profile-classic1x-{region}` with Era | Available via the shared namespace | search-summary of Blizzard forum + GitHub docs; not independently fetched |
| Cata Classic (2024) / MoP Classic (2025-07-21) | Progression stays on `*-classic-{region}`; realm moves flip characters between namespaces, causing 404s | n/a | thread 57076; Wikipedia/Blizzard Watch for MoP date |
| TBC Anniversary (Jan 2026) | **New prefix `classicann`** — not guessable from prior names | Users broke 2026-01-19; staff-ish "docs updated" 2026-01-29 (Macey, staff status unclear); community confirms `classicann-{region}` 2026-02-05. Community reports it is **still not in official docs**, forum-only | https://us.forums.blizzard.com/en/blizzard/t/tbc-anniversary-namespaces-and-data-refreshes/57155 ; https://us.forums.blizzard.com/en/blizzard/t/wow-classic-tbc-anniversary-realms-api-issues/57076 |
| Classic AH (all non-retail) | Broken since Oct 2024 | Still listed open by staff 2025-03-19; community still complaining 2025-07 | https://us.forums.blizzard.com/en/blizzard/t/current-open-api-issues/54410 (Korakk, staff) |
| Our own verification (2026-04-28) | Anniversary: profile/media/equipment/guild+roster OK; professions 404; guild activity/achievements empty; AH broken | — | memory `reference_blizzard_classic_api_state` (via ROK-1562) |

**Prediction for Forever:** (a) no announcement ahead of time; (b) a brand-new prefix we cannot guess reliably (classicann proves it), disclosed on the API forum, maybe weeks after launch; (c) Game Data (realm/ruleset index, playable-race with Skyborne Elf) likely before Profile; (d) Profile may need a different path because of realmless + two-part names (Blizzard's retail Profile API has no precedent for realmless characters — **unknown**); (e) AH/professions/guild-activity likely missing or broken as on other Classic flavours.

## Code impact map (origin/main, 2026-10-04)

Single source of the guess:
- `api/src/plugins/wow-common/blizzard.constants.ts:194` `WOW_FOREVER_NAMESPACE_PREFIX = 'classicforever'` (placeholder). Used by `variantToNamespacePrefix` (`:200-209`) and `getNamespacePrefixes` (`:216-229`, derives `static-/dynamic-/profile-` — assumes Forever follows the `{kind}-{prefix}-{region}` pattern; fine unless Blizzard breaks it).
- `api/src/games-lookup/seed-games.data.ts:145-152` seeds the Forever game row with `apiNamespacePrefix: WOW_FOREVER_NAMESPACE_PREFIX`; `seed-games.helpers.ts:37-38` upserts it → **the guess is persisted to `games.api_namespace_prefix`**. Changing the constant only takes effect where the seed re-runs (verify it runs on boot in prod; otherwise a data migration is needed).

Hard-coded copies of the guess on the web side (must change together):
- `web/src/plugins/wow/components/item-detail-modal.tsx:55-56` (`'wow_forever'` + `'classicforever'` cases).
- `web/src/plugins/wow/lib/wowhead-urls.ts:14-18, 29-30` (`'classicforever'` case; Wowhead DB = vanilla for now).

ROK-1636 gating (to remove when the probe goes green):
- `web/src/plugins/wow/lib/armory-import.ts:11` `ARMORY_UNSUPPORTED_VARIANTS = new Set(['wow_forever'])` (+ note `:14-15`). Hardcoded on the web → needs a deploy to flip. Proposal: drive it from an API capability flag.
- `api/src/plugins/wow-common/blizzard-upstream-error.ts:25-56` 403 → 502 + `isNamespaceRefusal`; `blizzard.service.ts:40-45, 149-200` 10-min realm-refusal memo. Keep as-is; it is also the probe's failure signal.

Identity shape (realmless + two-part names) — the real blocker:
- `api/src/plugins/wow-common/blizzard-character.helpers.ts:26-40` `buildCharacterParams(name, realm, …)`: slugifies realm, lowercases name; a name with a space ("Ana Forever") would produce a broken path, and there is no realm.
- `api/src/plugins/wow-common/blizzard.controller.ts:41-59` realms endpoint, `:63-80` character-preview requires `name` + `realm` (`BadRequest` when realm empty).
- Callers of `buildCharacterParams`: `blizzard-profile.helpers.ts:158-176`, `blizzard-equipment.helpers.ts:99-109`, `blizzard-spec.helpers.ts:110-121`, `blizzard-professions.helpers.ts:134-150` (already skips all non-retail at `:138`).
- `web/src/plugins/wow/components/wow-armory-import-form.tsx` + `realm-autocomplete.tsx` (realm + single name inputs); manual entry form and `characters` schema (realm column) — a Forever character needs ruleset + two-part name. Contract: `packages/contract/src/characters.schema.ts:260-290` (`WowGameVariantSchema` already has `wow_forever`).

Static/journal data:
- `api/src/plugins/wow-common/blizzard-instance.helpers.ts:151-160` Forever = Classic instance set only; `:44` realm index uses `dynamic-{prefix}`; `:70`, `blizzard-instance.fetch.ts:64`, `boss-data-refresh.service.ts:87-146` journal uses retail `static-{region}`.
- `api/src/plugins/wow-common/boss-data-refresh.helpers.ts:16-23` `getItemNamespace` has no Forever row (falls back to retail `static-us`) — add `forever: static-<prefix>-us` once items for new content exist.
- `boss-encounters.service.ts:31`, `dungeon-quests.helpers.ts:31`, controllers `:35/:47` — `wow_forever: ['classic']`.

Guild roster: **no guild/roster code exists in `api/src/plugins/wow*` today** (grep for `guild` finds only item data). "Sync more than Anniversary" means net-new guild-import work regardless of Forever.

Canary/probe hooks available:
- `api/src/canary/blizzard.canary.ts:1-60` (client-credentials token + retail realm index; `CANARY_BLIZZARD_CLIENT_ID/SECRET`) — reuse for the probe.
- `api/src/plugins/wow-common/wow-cron-registrar.ts:21-35` plugin cron registry — natural home for an in-app daily probe.

## Prep plan (stories to file — operator files them; report-only)

1. **chore(wow): WoW Forever namespace discovery probe (scheduled + admin-run)**
   - AC1: A probe tries a candidate prefix list (default: `classicforever, forever, classicfe, classic2x, classicplus, wowforever, classic` + config override) per region `us,eu,kr,tw` against `/data/wow/realm/index?namespace=dynamic-<p>-<r>` (also try `/data/wow/connected-realm/index`), `/data/wow/playable-race/index?namespace=static-<p>-<r>` (match = a race named "Skyborne" present), and records HTTP status per (prefix, region, endpoint).
   - AC2: Runs daily via `WowCronRegistrar` (and hourly 11-04 → 11-18), plus an admin-only "Run now" endpoint; results stored (app_settings or a small table) and shown on the admin plugin page.
   - AC3: On the first 200 whose static data contains Skyborne Elf (and Profile `/profile/wow/character/...` is reachable for a known character if supplied), it raises a Sentry *info* event / admin notification "Forever namespace found: <p>" — it does **not** auto-flip production behaviour without story 2's setting.
   - AC4: Also logs the response shape of the realm/ruleset index (are entries rulesets? slugs?) to inform story 3.
   - AC5: Unit tests with mocked fetch (403/404/200 matrix); no real Blizzard calls in CI. Add a CI canary variant (`blizzard.canary.ts`) that reports — not fails — the Forever status.
2. **feat(wow): make the Forever namespace prefix + Armory availability runtime-configurable**
   - AC1: Forever prefix resolves from an admin setting (default `classicforever`) instead of the compile-time constant; `variantToNamespacePrefix`, the games-row value and the web Wowhead/item-modal mappings read one source (API exposes it).
   - AC2: `ARMORY_UNSUPPORTED_VARIANTS` is driven by an API capability flag (`armoryImport: { wow_forever: false }`), so enabling Forever import needs no web deploy.
   - AC3: Changing the setting invalidates the realm cache + refusal memo for that variant.
   - AC4: Unit tests for the resolver; one component test that the Armory tab re-enables when the flag flips.
3. **spike(wow): realmless ruleset + two-part-name character identity for WoW Forever** (needs operator design ruling — see Open questions)
   - AC1: Decide the stored shape (ruleset in place of realm? `firstName`/`secondName` or one display name with a space?) for manual entry and Armory import; wireframe the Forever variant of the Add Character form.
   - AC2: Map how the probe's realm/ruleset index and a real Profile URL encode a two-part name (blocked on launch + probe).
   - AC3: List the contract/schema changes (`characters` realm nullability, uniqueness key region+name+ruleset) and file the implementation story.
4. **feat(wow): enable WoW Forever Armory import once the namespace is live** (blocked by 1–3)
   - AC1: Preview/import/refresh succeed for a real Forever character using the discovered namespace and identity shape; ROK-1636 note removed.
   - AC2: Auto-sync cron includes Forever characters; 403s keep the 502 mapping.
   - AC3: Integration test with recorded fixtures; fleet test plan for the modal (both colour families).
5. **feat(wow): Forever instance/boss data (9 dungeons, 2 raids)** (blocked on the static/journal namespace or a hand seed)
   - AC1: `filterByVariant` and `getItemNamespace` include Forever content once the journal or a static seed has it; `wow_forever: ['classic', 'forever']` content key.
   - AC2: Wowhead URL strategy decided (Forever DB exists? else vanilla IDs only).
6. *(optional, later)* **spike(wow): guild roster import for Classic flavours** — no guild code exists today; Anniversary `profile-classicann` guild + roster already work, so this can ship independently of Forever and later light up for Forever.

## Open questions for the operator

1. **Identity model (blocks 3/4):** for a Forever character, store "ruleset" in the realm field, or add a dedicated field? Store the two-part name as one string ("Ana Forever") or two fields? Should manual entry for Forever ask for ruleset + first/second name right now (pre-launch), ahead of any API?
2. **Probe cadence + notify target:** daily cron + admin button OK? Who gets notified on a hit — Sentry info, Discord admin channel, or the Active State doc?
3. **Probe credentials:** reuse prod Blizzard client credentials in-app, or keep it CI-canary-only (`CANARY_BLIZZARD_*`) to avoid touching prod quotas?
4. **Story 2 now or wait?** It is cheap and removes a deploy from the critical path on launch week; recommend filing before 11-04.
5. **Scope ambition:** if Blizzard ships only Game Data (no Profile) for Forever, is ruleset list + static race/class data worth anything to us, or do we hold until Profile exists?
6. Do you want ROK-1562's description updated with these findings (this lane does not write to Linear)?
