# ROK-1952 spike: BG3-specific hub widgets

Epic ROK-1952 (Raid Ledger Companion + BG3 hub). Companion spike: `docs/spikes/ROK-1951-companion.md`. That spike's §2 holds the verified data sources and its §7 the first six widgets. This doc goes beyond §7. Research only; no code.

**Labels.** **VERIFIED (save)** = seen in the operator's real save (ROK-1951 §2.1). **SOURCED** = a cited page says so. **UNVERIFIED** = recalled or inferred, so check it at implementation time. **Not available** = no source exists without a mod.

## Recommendation

- **Build five BG3 widgets for v1.** All five come from `SaveInfo.json`, the embedded WebP, upload history, Steam and Discord, which are already designed sources:
  1. **Next session** (merges §7 "Where we are")
  2. **Party composition and coverage** (replaces §7 "Party")
  3. **Last time on…** session recap
  4. **Achievement race**, with rarity and spoiler-safe hidden achievements (replaces §7 "Achievements")
  5. **Campaign timeline**, which absorbs the level-up timeline
- **Everything else waits.** Gold, gear, camp roster, approval, quests, per-class level splits and individual deaths need `Globals.lsf` (patch-fragile, §2.1), so they are v2. A small `meta.lsf` reader (ROK-1961 D4) unlocks a cheap middle tier: real save time, a campaign key, a mods flag and Honour status.
- **Not feasible:** dice or roll statistics. BG3's combat log is short and cannot be exported, and no logging mod exists ([Nexus forum proposal](https://forums.nexusmods.com/topic/13513094-mod-proposal-exportable-combat-log-parser-for-bg3)). Discord rich-presence detail is also out: I found no evidence that BG3 sends any.
- **Make the "to-do before next session" note a core hub widget, not a BG3 one.** It has no game data. Nothing like it is in `web/src/components/hub/layout/hub-widget-catalog.tsx` today, and every game hub would use it.
- **House style.** Register in `web/src/plugins/bg3/register.ts` through `registerHubGameWidget` (`web/src/plugins/hub-game-widgets.ts`). Each widget gets `games`, `order`, `span` 1/2/3, `audience: 'members'` and a `description` for the arrange picker (ROK-1918). Load lazily, like `web/src/plugins/valheim/hub/*-widget-lazy.tsx`. Wireframe first, in `planning-artifacts/pending-approval/`.

## Facts that shape the designs

- **No per-class level split.** `SaveInfo.Classes` lists `{Main, Sub}` per class with one total `Level`. There is no per-class level (VERIFIED (save): a level-8 Gloom Stalker Ranger / Thief Rogue has no 5/3 split). A multiclass card can show "Ranger (Gloom Stalker) + Rogue (Thief) · L8" but not the split. The split needs `Globals.lsf`.
- **XP-to-next is computable.** The save carries both `Experience Points (Total)` and `(Current level)`. The sample's 35,630 total with 5,630 in level gives a level-8 floor of 30,000. The next-level thresholds come from a static table, and the cap is 12 ([eip.gg XP table](https://eip.gg/bg3/db/experience-table/), [GamesRadar](https://gamesradar.com/baldurs-gate-3-level-cap)). The sources disagree on the cumulative figure for level 12, so verify the table against more samples.
- **`Position [x,y,z]` is in the save for every party member.** VERIFIED (save). That makes a "party is split up" hint cheap. A pin on an act map is technically possible but needs per-level coordinate calibration plus map art we may not redistribute, so it is not proposed.
- **Most achievements are hidden.** The Steam stats page shows **25 of 54**; the rest are hidden ([Steam global stats](https://steamcommunity.com/stats/1086940/achievements)). Any achievement widget must hide the names and descriptions of hidden achievements a member has not unlocked, or it spoils the story.
- **Rarity data is good.** Examples: Foehammer (Honour) 3.2%, Critical Hit (Tactician) 6.4%, Jack-of-all-Trades 3.2%, Descent From Avernus 89% ([Steam global stats](https://steamcommunity.com/stats/1086940/achievements)). Percentages drift, and early-launch values were wrong ([Gfinity](https://www.gfinityesports.com/article/baldurs-gate-3-steam-achievement-percentage-issues-looked-into)), so refresh daily and never hard-code them.
- **Unlocks are timestamped.** `GetPlayerAchievements` returns an `unlocktime` per achievement (SOURCED: [Valve wiki](https://developer.valvesoftware.com/wiki/Steam_Web_API); Valve's own page lists the parameters but not the response fields, see [Steamworks](https://partner.steamgames.com/doc/webapi/ISteamUserStats)). Unlocks can therefore be attributed to a play session.
- **Co-op unlocks are inconsistent.** Steam achievements are per player, and community reports disagree on whether co-op partners get end-game unlocks such as Foehammer ([Steam thread](https://steamcommunity.com/app/1086940/discussions/0/4141689926413125787), [Larian support](https://larian.com/support/faqs/honor-mode-achievements-not-awarding-pc-mac_111)). A "race" must not imply that a missing unlock means the member skipped the content.
- **Steam playtime is lifetime, not per campaign.** `playtime_forever` counts every playthrough. Campaign hours have to come from Discord voice or presence overlapping the campaign's save window.
- **A failed Honour run becomes Custom.** After a party wipe, an Honour run continues as a Custom-mode game ([Prima](https://primagames.com/?p=211009), [GamesRadar](https://gamesradar.com/baldurs-gate-3-honour-mode)). Whether `SaveInfo.Difficulty` changes value is **UNVERIFIED**, because the sample was `["DifficultyHard","RulesetLarian"]`. `meta.lsf` has a `HonorDifficultySelected` key (VERIFIED key exists), so a "Honour run: alive / fell on <date>" badge is feasible once we see a wiped save or can decode `meta.lsf`.
- **Level ids need a lookup table.** `Current Level` is an engine id (`SCL_Main_A` VERIFIED (save); `WLD_Main_A`, `CRE_Main_A` and camp are present as LevelCache files). The full id → act map (`BGO_*`, `CTY_*`, `IRN_*`, `END_*` …) is recalled from modding knowledge, so it is **UNVERIFIED**. Build it from real saves; no web page lists it.

## Widget evaluation

Dependencies: **ROK-1953** Steam achievements/playtime · **ROK-1957** BG3 plugin (snapshot + history store, claims, read routes) · **ROK-1960** drag-and-drop `.lsv` upload · **ROK-1961** desktop companion · **ROK-1942** gallery.

"Ingest" below means either ROK-1960 or ROK-1961. Either one feeds ROK-1957, so a widget does not depend on the companion shipping.

| # | Widget | What it shows | Data source | Status | Value for a small co-op group | Effort | Depends on | Tier |
|---|---|---|---|---|---|---|---|---|
| 1 | **Next session** (span 2; merges §7 "Where we are") | Latest save screenshot as hero; "Act 2 · Shadow-Cursed Lands"; difficulty/ruleset badge; party level; "saved 3 d ago"; the next RL event for the hub with RSVP count; a "split party" hint when member positions are far apart (*deferred, Codex 2026-10-25:* the Companion drops `Position` before upload and `bg3-save/v1` has no derived field, so this hint needs a client-computed `partySplit` flag added to the contract first, or it waits for v2) | `SaveInfo` `Current Level`, `Difficulty`, `Position`, WebP; file mtime; existing RL events | VERIFIED (save) + our id→name table (UNVERIFIED ids) | **High.** Answers "where did we leave off, and when do we play" in one glance | M | ROK-1957, ingest | **v1** |
| 2 | **Party composition and coverage** (span 2; replaces §7 "Party") | A card per member: race, class + subclass chips, level, XP-to-next bar, origin vs custom; summons collapsed. Then a coverage strip (healer, arcane caster, martial/tank, skill monkey, "face" class, Counterspell-capable) with gaps flagged ("no healer: bring potions") | `SaveInfo.Characters[]` `Classes`, `Race`, `Level`, XP, `Origin`; static class→role table (ours) | VERIFIED (save); the role table is a heuristic (UNVERIFIED design) | **High.** Co-op groups plan "who respecs into what"; coverage is the BG3 analogue of the WoW role composition (`web/src/plugins/wow/hub/role-composition.tsx`) | M | ROK-1957, ingest; names via manual claim | **v1** |
| 3 | **Last time on…** session recap (span 2) | For the latest play session (saves clustered by a ≥4 h gap): duration, area/act changes, level-ups per member, subclass picks and new multiclass dips, party roster changes, achievements unlocked in that window, who was in voice | Save-history deltas (ROK-1957); Steam `unlocktime` (ROK-1953); Discord voice | Deltas derived from VERIFIED fields; `unlocktime` SOURCED | **High.** The "previously on" recap groups actually ask for after a week's gap | M | ROK-1957, ROK-1953 (optional) | **v1** |
| 4 | **Achievement race** (span 1–2; replaces §7 "Achievements") | X/54 per linked member; the group's rarest unlock with its global %; a "group firsts" feed; hidden achievements stay masked until the viewer unlocks them; flags for Tactician (Critical Hit) and Honour (Foehammer) | `GetPlayerAchievements`, `GetSchemaForGame`, `GetGlobalAchievementPercentagesForApp` | SOURCED (API); hidden-flag handling UNVERIFIED in the schema response | **Med–high.** Light competition; rarity makes it interesting | S–M | ROK-1953 | **v1** |
| 5 | **Campaign timeline** (span 3; includes the level-up timeline) | A horizontal timeline of the playthrough: act transitions, level milestones (5 / 8 / 12), subclass picks, difficulty changes, session markers, screenshots as thumbnails | Save history (ROK-1957) + WebP + ROK-1942 media | Derived from VERIFIED fields | **Med–high.** BG3 runs last 75–150 h over months, and this is the scrapbook | M | ROK-1957; thumbnails better with ROK-1942 | **v1** |
| 6 | Act progress stepper (span 1) | Prologue → Act 1 → Act 2 → Act 3 → Epilogue with the current act lit, plus party level vs the act's usual level band | `Current Level` → act table; party level | VERIFIED field; act bands UNVERIFIED community lore | **Medium.** Overlaps #1, so fold it into #1 unless the wireframe wants it separate | S | ROK-1957 | v1 (fold into #1) |
| 7 | Difficulty / ruleset badge | Explorer / Balanced / Tactician / Honour / Custom, plus the ruleset | `SaveInfo.Difficulty` | VERIFIED field; id→label mapping UNVERIFIED (`DifficultyHard` → Tactician?) | Low on its own, so make it a chip inside #1 | S | ROK-1957 | v1 (chip) |
| 8 | Multiclass build cards | One card per member's build, "Gloom Stalker Ranger + Thief Rogue · L8", plus a link to the community build if a member pastes one | `SaveInfo.Classes` | VERIFIED, but **no per-class level split** | Medium. Without the 5/3 split it duplicates #2, so ship it inside #2 and make the split a v2 add-on | S (v1 in #2) / M (split, v2) | ROK-1957; split needs Globals | v1 in #2; split **v2** |
| 9 | Playtime | Lifetime BG3 hours per member (Steam); campaign hours (Discord voice/presence during the campaign window) | `GetOwnedGames.playtime_forever`; Discord voice | SOURCED / VERIFIED (repo) | Medium. Label lifetime vs campaign clearly | S | ROK-1953 | **v1** (§7 already) |
| 10 | Gallery source | Every save's screenshot in the hub gallery, tagged with act/area and date | WebP | VERIFIED | Medium; free once ROK-1942 lands | S | ROK-1942, ROK-1957 | **v1** (§7 already) |
| 11 | "To-do before next session" note | Shared checklist ("respec Karlach", "buy arrows", "bring Withers gold") | User-entered | n/a | Medium, but not BG3-specific | S | none, as a core hub widget | Core (not BG3) |
| 12 | Honour run status | "Honour: alive, 41 sessions" or "Honour: fell on <date>, continuing as Custom" | `meta.lsf HonorDifficultySelected` and/or a `Difficulty` change across saves | Key VERIFIED to exist; values and wipe behaviour UNVERIFIED | High for Honour groups, nil for others (hidden when not Honour) | S once decodable | ROK-1957 + ROK-1961 D4 (`meta.lsf` reader) | **v2a** (meta.lsf) |
| 13 | Campaign grouping and real save time | Correct grouping when a group runs two playthroughs; exact save time (not the mtime) | `meta.lsf GameID`, `SaveTime` | Keys VERIFIED to exist | Infrastructure for #3 and #5 rather than a widget | M | ROK-1961 D4 | **v2a** |
| 14 | "Modded" / crossplay chip | Shows when a campaign runs unofficial mods or crossplay, which helps when sessions desync | `meta.lsf HasUnofficialMods`, `ModuleSettings`, `Crossplay` | Keys VERIFIED to exist | Low–medium | S | ROK-1961 D4 | **v2a** |
| 15 | Companion roster + camp | Which origin companions are recruited, in camp, departed or dead | Active-party `Origin` only (VERIFIED); camp and recruited state in `Globals.lsf` | Party-only part VERIFIED; camp **v2** | High interest (BG3 players talk companions constantly), but only the in-party slice is v1 and #2 already covers that | L | Globals reader | **v2** |
| 16 | Approval meters | Each companion's approval of the party | `Globals.lsf DB_ApprovalRating` ([bg3-save-skill](https://github.com/hylqs97/bg3-save-skill)) | SOURCED; patch-fragile | Medium–high (romance banter), with spoiler risk | L | Globals reader | **v2** |
| 17 | Quest log / "open threads" | Active quests and recently completed steps | `Globals.lsf Journal`, `QuestVisitedSteps` ([bg3-save-tools](https://github.com/CharlesMcquade/bg3-save-tools)) | SOURCED; patch-fragile; also needs quest display names | High for "what were we doing", but a spoiler minefield | L | Globals reader + name table | **v2** |
| 18 | Gold / gear / ability scores | Party gold, equipped legendaries, ability-score spread | `Globals.lsf` ECS "NewAge" blob, which LSLib "can extract … but can't interpret" ([bg3-newage](https://github.com/marius851000/bg3-newage)) | Low confidence; drifts each patch | Medium | L+ | Globals reader | **v2 (last)** |
| 19 | Individual character deaths / downs | Who died how often (the Valheim Deaths widget analogue) | Not in `SaveInfo`; no known Globals field | Not available (UNVERIFIED for Globals) | Fun, but no source | n/a | none | **Not feasible** |
| 20 | Dice / roll fun stats | Nat 20s, nat 1s, luckiest player | No exportable roll log and no logging mod ([Nexus forum](https://forums.nexusmods.com/topic/13513094-mod-proposal-exportable-combat-log-parser-for-bg3)); the Script Extender would need our own mod | Not available | Very high fun value, sadly | n/a (our own SE mod: L, out of scope) | none | **Not feasible** |
| 21 | Live "where are they now" | The live area and act while the group plays | Discord rich presence (no evidence BG3 sends detail); the companion could watch autosaves instead, which #1 already does | Not available live | Low, given #1 updates every save | n/a | none | **Not feasible** (#1 covers it) |
| 22 | Party pin on an act map | The party's position on the act map | `Position` (VERIFIED) + per-level calibration + map art | Data VERIFIED; map art licensing and calibration unknown | Medium | L | ROK-1957 + art | **Parked** |
| 23 | "How our party compares" | Our classes and races vs Larian's published player stats (Paladin the most picked class, Gale the most picked origin) | Larian infographics ([mp1st](https://mp1st.com/news/baldurs-gate-3-opening-weekend-stats-shows-paladin-as-most-used-class-10m-hours-played-and-more-revealed), [ggrecon](https://ggrecon.com/articles/baldurs-gate-3-player-stats-have-plenty-of-surprises)) | Static 2023 data, no API | Low; a one-line flourish inside #2 at most | S | none | Skip |

## Tiers

- **v1 (save + Steam + Discord):** #1 Next session (with #6 and #7 folded in), #2 Party composition and coverage (with #8 folded in), #3 Last time on…, #4 Achievement race, #5 Campaign timeline, plus #9 Playtime and #10 Gallery source from §7.
  - Order: **#4 and #9 ship first** because ROK-1953 needs no companion. #1 and #2 follow ROK-1957 plus ROK-1960, then #3 and #5 once history has accumulated.
- **v2a (`meta.lsf`, small and stable):** #12 Honour run status, #13 campaign grouping and real save time, #14 Modded/crossplay chip. They justify ROK-1961 D4 (about 300 lines of LSF v7 reader, per ROK-1951 §2.1).
- **v2 (`Globals.lsf`, patch-fragile):** #15 camp roster, #16 approval, #17 quests, #18 gold/gear/stats, and the #8 per-class level split. Prefer the save-plus-Steam surface; revisit only after a patch-stability check.
- **Not feasible / parked:** #19 deaths, #20 dice stats, #21 live location, #22 map pin, #23 global comparison.
- **Core, not BG3:** #11 the shared to-do note.

## Open questions for the operator

1. **Spoilers.** Should hidden achievements and (v2) quest names stay masked until the viewer has unlocked them? *Recommend yes, per viewer.*
2. **Coverage heuristic.** Is a class→role table acceptable even though BG3 builds are flexible (any class can pick locks; the "face" really depends on Charisma, which we can't read in v1)? *Recommend yes, labelled "by class" with a tooltip.*
3. **Note widget.** Should it be filed as a core hub story rather than inside the BG3 epic? *Recommend core.*

## Sources

- Steam global achievement stats, BG3: https://steamcommunity.com/stats/1086940/achievements
- Steamworks ISteamUserStats: https://partner.steamgames.com/doc/webapi/ISteamUserStats · Valve wiki Steam Web API: https://developer.valvesoftware.com/wiki/Steam_Web_API
- Achievement % issues: https://www.gfinityesports.com/article/baldurs-gate-3-steam-achievement-percentage-issues-looked-into
- Co-op Honour achievements: https://steamcommunity.com/app/1086940/discussions/0/4141689926413125787 · https://larian.com/support/faqs/honor-mode-achievements-not-awarding-pc-mac_111
- Honour → Custom on wipe: https://primagames.com/?p=211009 · https://gamesradar.com/baldurs-gate-3-honour-mode
- XP table / level cap: https://eip.gg/bg3/db/experience-table/ · https://gamesradar.com/baldurs-gate-3-level-cap
- Combat log not exportable: https://forums.nexusmods.com/topic/13513094-mod-proposal-exportable-combat-log-parser-for-bg3
- Globals contents: https://github.com/CharlesMcquade/bg3-save-tools · https://github.com/hylqs97/bg3-save-skill · https://github.com/marius851000/bg3-newage
- Larian player stats: https://mp1st.com/news/baldurs-gate-3-opening-weekend-stats-shows-paladin-as-most-used-class-10m-hours-played-and-more-revealed · https://ggrecon.com/articles/baldurs-gate-3-player-stats-have-plenty-of-surprises
- Save fields: `docs/spikes/ROK-1951-companion.md` §2.1 (the operator's real save)
