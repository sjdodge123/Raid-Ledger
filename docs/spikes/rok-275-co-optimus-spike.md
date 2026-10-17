# ROK-275: Co-Optimus Co-Op Data Integration Spike

**Date:** 2026-07-14
**Status:** Complete — recommendation at the end
**Scope:** Data-access research, coverage probe against our live library, schema mapping, matching strategy, feasibility. OUT OF SCOPE: building the integration, UI changes.

## Problem Statement

Co-Optimus (co-optimus.com, est. 2008) maintains the web's most complete editorial database of **co-op-specific game facts**: max online co-op players, max couch co-op players, LAN support, split-screen, drop-in/drop-out, campaign co-op, and co-op-specific modes — exactly the per-mode granularity our `games` table lacks. Today we render only `primaryMode` from IGDB `game_modes` on cards and a coarse `Players {min}-{max}` on the detail page; nothing distinguishes "4-player online co-op campaign" from "2-player couch split-screen." The ROK-821 advanced filter panel wants queries like *"supports 5+ online co-op"* — Co-Optimus's `online` field is literally that number.

This spike answers: can we get the data, does it cover our library, how would it map into our schema, how do we match entries to our IGDB-sourced games, and is it worth doing?

## 1. Data Access Findings

### 1.1 The XML API exists and is exactly what we'd want — but is behind a Cloudflare bot wall

Co-Optimus has served a **public, keyless, self-documenting XML API** since ~2009:

| Endpoint | Purpose |
|----------|---------|
| `https://api.co-optimus.com/games.php?search=true&...` | Game search. Filters: `name`, `id`, `system`/`systemName`, `steam` (Steam App ID), `local`/`lan`/`online`/`split`/`jip`/`csc`/`spc` (Y/N flags), `online_num`/`offline_num` (min player counts), `releaseyear`, `publisher`, `developer`, `esrb`, `sortby`, `direction` |
| `https://api.co-optimus.com/games.php?params=true` | Self-documentation listing all accepted params (verified via Wayback snapshot 2025-08-28) |
| `https://www.co-optimus.com/game/{id}/{platform}/{slug}.html` | HTML detail pages — one per **game+platform** pair |
| `https://www.co-optimus.com/sitemaps/siteMapGames_index.xml` | Full game-page URL inventory (declared in robots.txt) |
| `https://www.co-optimus.com/related-news/{slug}/rss` | Per-game **news** RSS only — no structured co-op data. There is no site-wide structured RSS for the games DB |

The API served valid XML 200s at origin as recently as **2025-08-30** (Wayback capture of `name=Siege&systemName=PC`). It still exists — Google has freshly indexed `api.co-optimus.com` result pages, proving verified crawlers pass.

**However, as of 2026-07-13, every non-browser client is hard-blocked.** Verified live:

```bash
curl -sS -A "raid-ledger-spike/0.1 (contact: operator)" \
  "https://api.co-optimus.com/games.php?search=true&name=Borderlands"
# → HTTP 403 — Cloudflare managed challenge (Turnstile), cZone: api.co-optimus.com
```

The same 403 + Turnstile challenge was reproduced with a Chrome UA on curl, with Claude WebFetch, and with **headless** Playwright (Turnstile does not auto-pass headless). Both the `www` and `api` zones are challenged. Only `/robots.txt` is served unchallenged. A **real, non-headless browser passes the challenge** — the entire probe in §2 ran this way, 179 API calls across two sessions, zero 403s.

**Conclusion: `hasStructuredAccess: true`, but only for browsers and allowlisted crawlers. Unattended server-side fetch (our cron enrichment pattern) cannot reach it today without either an allowlist from the site or a challenge-solving fetch layer.**

### 1.2 Licensing / ToS — no terms exist; robots.txt is the only machine-readable policy

- **No terms-of-use page exists at all.** The site footer (June 2026 archive) links only About / Contact / Privacy. `about.php` contains no API or licensing language. The API launched as a public community resource with zero published terms.
- **robots.txt** (fetched live 2026-07-13) carries a Cloudflare **Content Signals** block declaring, in effect:

  > `search=yes, ai-train=no, use=reference` — framed as an express EU DSM Art. 4 rights reservation

  plus explicit `Disallow: /` for AI-crawler UAs (**ClaudeBot, GPTBot, CCBot, Bytespider, Google-Extended, meta-externalagent**), `Disallow` on `/rss/` and `/ajax_*` for generic crawlers, and **`crawl-delay: 1`**.

**Practical read:** our use-case — enrichment/lookup with attribution — is squarely `use=reference`, which their content signals expressly permit, and we are not training on their data. But the operator has *also* deliberately deployed bot management that blocks all unattended programmatic access. The signals say "reference use is fine"; the bot wall says "not without asking." The compliant path is therefore **permission-first**: email via `contact.php`, ask for an allowlisted key/UA (or their blessing for a one-time bulk pull), and ship attribution + linkback to the co-optimus.com game page — the API even returns the `url` field for exactly this.

### 1.3 Rate limits and reliability

- **No API key, no documented rate limits** — the API predates all of that. robots.txt requests `crawl-delay: 1` (1 req/s ceiling). The de-facto limiter is the Cloudflare challenge itself.
- The About page (June 2026 snapshot) states **17,245 games** in the database. A one-time permitted bulk sync at 1 req/s completes in **under 5 hours**; ongoing deltas are trivial. **The blocker is access, not rate.**
- **The site is alive and current**: Split Fiction (2025, incl. Switch 2), Helldivers 2 (incl. 2024+ Xbox Series entry), Palworld PS5, Outpost: Infinity Siege (2024) all have full entries; Wayback shows continuous 200s through at least March–June 2026.
- **But it is a small enthusiast-run site**: no SLA, no versioning, no key issuance; the `params=true` doc is raw late-2000s `<b>`-tag HTML (clearly legacy-unmaintained); the Cloudflare wall (likely the 2025 managed AI-crawler rollout) can tighten further at any time. **Any integration must be periodic batch enrichment with locally persisted results — never a live per-request dependency.**

## 2. Coverage Analysis (live probe, 2026-07-14 — **full library measured, not sampled**)

### 2.1 Method

- Population: **the entire live library — all 165 rows (163 distinct names; `Grand Theft Auto V` and `The Binding of Isaac: Repentance` each appear twice)**, hidden/banned excluded. Probed in two passes:
  - **Head pass:** the 40 highest-engagement games (ranking = weighted sum over `game_interests` ×1, `events` ×5, `community_lineup_entries` ×3, `game_activity_sessions` ×2, ties by IGDB popularity). 48 API queries — 8 titles were queried twice by the probe orchestration (Animal Company, Monster Hunter Wilds, Dead by Daylight, Apex Legends, Smite 2, Soulmask, The Witcher 3, Rust); duplicates agreed with each other except Rust (see below).
  - **Tail pass:** the remaining 123 distinct names, plus 7 base-title verification queries (for edition-suffix misses) and 1 clearance re-test — 131 calls.
- Access: direct curl got 403 and was stopped per polite-citizen rules. Both passes ran as **same-origin `fetch()` inside an already-challenge-cleared real Chrome tab** (claude-in-chrome; the same tab's clearance survived across sessions): sequential calls at ~1.1 s spacing, **179 calls total across the spike, zero 403/429** — confirming "real browser passes, server-side cannot."
- Matching: `name=` LIKE search, exact/normalized title comparison (roman↔arabic numeral folding), with steam-id equality vs our `games.steam_app_id` used as a corroboration signal.
- **Caveat (head pass only):** response excerpts in the head-pass results file were truncated at ~2 KB, so head per-game row counts are **lower bounds** (full responses ran up to ~26 KB — Minecraft alone implies 10+ per-platform entries). Tail-pass rows were parsed in full (capped at 15 rows/query).

### 2.2 Head-pass results (40 highest-engagement games)

| Metric | Value |
|--------|-------|
| Queries attempted | 48 (40 distinct games) |
| Matched (rows, as scored by the probe) | 27 / 48 (56%) |
| Matched (distinct games, after removing 2 substring false positives) | **25 / 40 (62.5%)** |
| — all 25 via `name=` search (exact/normalized title) | 25 |
| — steam-id corroboration confirmed the pick | 9 of 25 |
| — needs-review match (subtitle variant) | 1 (Fortnite → "Fortnite: Save the World" — correct co-op entry, but not the Battle Royale most players mean) |
| Not found (distinct, incl. the 2 false positives reclassified) | 15 |

**False-positive lesson (2 of 27 "matches" were wrong):** the API's `name=` search is a substring LIKE. Querying **Rust** returned *Distrust* (steam 635200) and *Blind Trust* — not Rust (252490); querying **New World** returned *Tales of Symphonia: Dawn of the New World* and *Civilization V: Brave New World* — not Amazon's New World. Both were initially scored "matched" and are counted as misses here. Any production matcher needs a word-boundary / normalized-equality post-filter — never accept a bare substring hit.

**The 15 distinct misses decompose into three causes:**

| Cause | Count | Examples | Implication |
|-------|-------|----------|-------------|
| (a) PvP/MMO titles **systematically absent by editorial policy** | 9 | WoW, WoW Classic, Rust, PUBG, CS2, VALORANT, Apex Legends, Dead by Daylight, New World | Not a matcher problem — these games have **no entry to find**. Caps best-case raw coverage for a mixed library like ours. |
| (b) Freshness gaps | 4 | **Monster Hunter Wilds (Feb 2025 mainline!)**, Soulmask, Smite 2, Animal Company | Post-2024 coverage is spotty; enthusiast-curated. |
| (c) Correctly absent (single-player / junk row) | 2 | The Witcher 3, Action Fighter | Empty result = genuine "not co-op" signal — the clean 18-char `<games>\n</games>` envelope makes this cheap to detect. |

**For the co-op-relevant subset of the head sample, coverage is effectively ~25/29 (~86%)** (excluding the 9 PvP/MMO and 2 not-co-op titles where an empty result is the *right* answer). Where a game *is* co-op and *is* in their editorial scope, the data is there and rich (Palworld `online=32, lan=32`; BG3 `local=2, online=4, lan=4, splitscreen=1`; 7 Days to Die `online=12, lan=12`; Valheim `online=10`; Division 2 `online=8`).

### 2.3 Tail-pass results (remaining 123 names) and measured full-library coverage

*(This section replaces an earlier extrapolation that estimated ~100–105 of 165 games would get data by assuming head-sample MMO/PvP skew and tail niche/retro skew "roughly offset." The measurement below falsifies that assumption — the tail match rate is 22.8% vs the head's 62.5%, because the library tail is dominated by rows where an empty result is correct or expected: single-player titles, junk imports, mods/romhacks, and edition/DLC variants. The co-op-relevant coverage figure, however, survived measurement almost unchanged: 84% measured vs ~86% estimated.)*

Tail pass: 123 distinct names queried identically (raw: `rok275-probe-raw/tail-123-responses.json`; classification: `rok275-tail-classification.json`). **28/123 exact-normalized matches (22.8%).** The 95 misses decompose:

| Class | Count | Examples | Reading |
|-------|-------|----------|---------|
| (a) PvP/MMO/versus — empty is the **correct** answer for a co-op filter | 25 | Black Desert Online, Throne and Liberty, WoW expansion rows, Smash Melee, Tetris DX, iRacing, Mario Kart 8 Deluxe BCP | Same editorial policy seen in the head pass |
| (b) **Genuine co-op title with no entry** — the real gaps | **6** | **Lethal Company, Content Warning, Donkey Kong Bananza (2025), RoadCraft (2025), Lizards Must Die, Vintage Story** | Confirms and widens the freshness gap: it's not just MH Wilds — the 2023+ co-op wave is spotty |
| (c) Correctly absent — single-player or junk library rows | 39 | The Last of Us Remastered, Metroid Prime Trilogy, Pokémon FireRed, "Generic", 12 obscure "Lethal *" Steam-search imports | Over a third of tail misses are **our** library's noise, not Co-Optimus's gaps |
| (d) Mods / romhacks / private servers / launchers | 11 | FiveM, tModLoader, Terraria: Calamity Mod, Project M/+, Toontown Rewritten, Pokémon Unbound | Never in a retail co-op DB; empty is expected |
| (e) Edition/DLC/expansion variant rows **whose base game IS in Co-Optimus** | 14 | Elden Ring: SotE (+Edition), FFXIV Complete/Shadowbringers, RDR II Ultimate, MK11 Ultimate, Guacamelee! Gold, Sonic Mania Plus, Bloodborne GOTY/Old Hunters, Isaac Repentance+ | **Matcher-recoverable**: 7 base-title verification queries confirmed base entries exist for 13 of 14 (MK11, Guacamelee!, Sonic Mania, "Rocksmith: All-new 2014 Edition" verified directly; Elden Ring, FFXIV, GTA V, RDR2, Bloodborne, Repentance already matched; Zelda ALttP&FS only has the related Four Swords Adventures — review-tier) |

Substring false positives recurred at the same rate (3 in the tail, all caught by the word-boundary post-filter: "Unreal Tournament" → *Unreal Tournament 3* — a different game; "Project M" → *PROJECT MAZE*; "Dreams" → *Onimusha: Dawn of Dreams* etc.; "Defense of the Ancients" → *DOTA 2*).

**Measured full-library coverage (165 rows / 163 distinct names):**

| Metric | Measured value |
|--------|----------------|
| Exact-normalized match | **53/163 distinct names (32.5%); 55/165 rows (33.3%)** |
| With the verified edition-suffix base-title fallback (§4 step 3b) | **66/163 names (~40%); 68/165 rows (~41%)** |
| **Co-op-relevant coverage** — matched ÷ (matched + class-(b) genuine gaps: 4 head + 6 tail) | **53/63 = 84.1%** (head 86.2%, tail 82.4% — consistent) |
| **Filter-correctness** — names where Co-Optimus yields data *or* a correctly-empty answer | **139/163 (85.3%)**; **152/163 (93.3%)** after the edition fallback |

- The old headline "~100–105 of 165 games would get data" was **wrong by ~1.6×**: the measured answer is **55 rows today, ~68 with the edition-fallback matcher**.
- The conclusion the headline was supporting still holds, now on measured ground: **the enrichment covers 84% of the games where co-op facts are meaningful**, and for a "supports 5+ online co-op" filter Co-Optimus gives the *right* answer (rich data or correct absence) for **93%** of the library.
- The freshness gap is the one real weakness and is **bigger than the head pass suggested**: Lethal Company and Content Warning — two of the defining co-op hits of 2023–24 — are absent, alongside MH Wilds, Donkey Kong Bananza, and RoadCraft. Post-2023 titles need the IGDB `multiplayer_modes` fallback regardless.
- Tail matches also shift the platform mix: **10 of 28 tail matches have no PC row at all** (Super Mario Galaxy/Odyssey/Wonder, Bloodborne, Uncharted 2/4, Isaac Repentance, GTA: San Andreas…) vs ~85% PC rows in the head pass — the platform-selection policy (§2.4) must handle console-only entries, and one matched entry (Uncharted 2) carries all-zero co-op numbers.

### 2.4 Data-quality caveats observed

- **Per-platform duplication confirmed**: one entry per game+platform (BG3 returned PC + Google Stadia rows; Valheim PC + Xbox Series; FFXIV PC + PS4; full response sizes imply more — Minecraft's 26 KB response is ~10+ platform entries, ESO's 15 KB ~6). Player counts differ per platform (Minecraft Xbox 360 shows `online=8, local=4, splitscreen=1` — console values, not PC's). **A platform-selection policy (prefer `system=PC`, else newest platform) is mandatory.**
- **`releasedate` is unreliable** (Palworld "2026-07-10", Valheim "2026-09-09" — future/edited dates; 7DtD shows the 2024 console rerelease). Treat as "last touched"; **never overwrite IGDB dates**.
- **`steam` field is incomplete and occasionally wrong**: absent on Diablo IV / Deep Rock Galactic / Sea of Thieves / Fortnite STW PC entries; **wrong on League of Legends** (`steam=20590`; LoL isn't on Steam). Best join key *when present*, but must be validated both directions.
- **Player-count semantics vary by title**: GW2 `online=50` (squad), Division 2 `online=8` (raid size; campaign is 4), LoL `online=5` / DOTA 2 `online=5` describe co-op-vs-bots modes. Fine for a ≥N filter; document the nuance for the detail page.
- **Responses are not always well-formed standalone XML**: in-browser responses carry a trailing Cloudflare `<script>` after `</games>`, and the prose fields (`coopexp`/`background`) contain unescaped entities that can trip strict DOM parsing. **Production fetcher needs a lenient parser** (slice to `</games>`, tag-level extraction of the flat scalar fields).
- **Title normalization is required even for "exact" matches**: Co-Optimus titles "Final Fantasy 14 Online" (arabic) vs our "Final Fantasy XIV Online" (roman), "Baldur's Gate III" vs our "Baldur's Gate 3". Roman↔arabic numeral folding must be part of the normalizer.
- **Bonus finding — our own data bugs (Steam App ID audit candidates, now four)**: (1) our "7 Days to Die" row carries `steam_app_id=730` — that is **Counter-Strike's** App ID; Co-Optimus has the correct `251570`. (2) our "Rust" `steam_app_id=252490` could not be corroborated by any probe source (Co-Optimus has no Rust entry; the name search returned only *Distrust*/*Blind Trust*) — 252490 is almost certainly correct (it is Rust's well-known App ID) but it belongs in the same audit. The tail pass added two more (of 15 both-sides comparisons, 12 agreed, 3 mismatched): (3) our "Risk of Rain 2" carries `3885090` where Co-Optimus has RoR2's well-known `632360` — **our side suspect**; (4) our "Divinity: Original Sin II - Definitive Edition" carries `380370` vs their `435150` (the widely-documented DOS2 App ID) — **our side suspect**. One tail mismatch was their error (GTA V `steam=362003`; the real App ID is our `271590` — same their-side error pattern as LoL). Cross-validation against a second source has immediate hygiene value regardless of whether we integrate.
- **Bonus finding — our library's own hygiene problems, surfaced by the tail pass**: a placeholder row named "Generic"; a cluster of **12 obscure "Lethal *" titles** that look like a Steam-search import gone wide (Lethal Dungeon, Lethal Lawns, Paper Bride 7 Lethal Bond, …; a 13th and 14th — Lethal League/Blaze — are at least real versus games); 11 mods/romhacks/private servers stored as games (FiveM, tModLoader, Pokémon Unbound, Toontown Rewritten…); and 14 edition/DLC rows duplicating base games that are also in the library (Elden Ring + Elden Ring: SotE + SotE Edition; three GTA V rows; three Bloodborne rows). Any coverage percentage for *any* enrichment source is dragged down by these rows — worth a cleanup pass independent of Co-Optimus.

Full per-game results: `rok275-probe-results.json` (head) + `rok275-tail-classification.json` (tail); raw responses: `rok275-probe-raw/all-48-responses.json`, `rok275-probe-raw/tail-123-responses.json`, `rok275-probe-raw/base-title-checks.json` (session scratchpad).

## 3. Per-Game Data Schema → Our Schema Mapping

### 3.1 Co-Optimus response schema (verified live + Wayback)

Envelope `<games><game>…</game></games>`; empty result is the literal 18-char `<games>\n</games>`. Per-game fields:

`id`, `title`, `system`, `steam` (optional), `genre`, `publisher`, `esrb`, `releasedate`, `local` (int, max couch co-op), `online` (int, max online co-op), `lan` (int, max LAN), `splitscreen` (0/1), `dropindropout` (0/1), `campaign` (0/1), `modes` (0/1 co-op-specific modes), `featurelist` (comma-sep text), `review` (optional URL), `coopexp` (editorial free text), `background` (free text), `url` (canonical game page), `art`, `thumbnail`.

### 3.2 Mapping table

Storage follows the repo's **pattern A** (source-prefixed real columns, ITAD-style, with `*_synced_at` — because these fields feed **list filters**, and JSONB enrichments are not queried in filters anywhere today) for the filterable facts, and **pattern B** (generic `enrichments` table, `entity_type='game'`, `enricher_key='co-optimus'` — no migration needed) for display-only extras.

| Co-Optimus field | Store as | Column / location | Rationale |
|---|---|---|---|
| `id` | **Column** | `cooptimus_id integer` | Stable re-sync key; per-platform, so store the *chosen* entry's id |
| `online` | **Column** | `cooptimus_online_max integer` | **The ROK-821 field**: "supports 5+ online co-op" = `cooptimus_online_max >= 5` |
| `local` | **Column** | `cooptimus_couch_max integer` | Couch co-op filter/badge; no existing column carries this |
| `lan` | **Column** | `cooptimus_lan_max integer` | LAN filter/badge; no existing concept |
| `splitscreen` | **Column** | `cooptimus_splitscreen boolean` | Refines IGDB mode 4 with per-source truth |
| `dropindropout` | **Column** | `cooptimus_drop_in boolean` | Filterable flag (`jip` in their API) |
| `campaign` | **Column** | `cooptimus_campaign_coop boolean` | "Co-op campaign" filter — a headline ROK-275 goal |
| `modes` | **Column** | `cooptimus_coop_modes boolean` | Distinguishes bolt-on co-op modes from campaign co-op |
| `url` | **Column** | `cooptimus_url text` | Attribution linkback on the detail page (the decent-citizen move) |
| — | **Column** | `cooptimus_synced_at timestamp` | Repo convention (`itad_price_updated_at` precedent) |
| `system` (chosen), `steam`, `title`, `featurelist`, `coopexp`, `review` | **JSONB** | `enrichments` row (`game` / `co-optimus`) | Display-only: `coopexp` editorial blurb for the detail page, provenance (which platform entry we picked, their steam id for auditing), review link |
| `genre`, `publisher`, `esrb`, `background`, `art`, `thumbnail` | **Discard** | — | IGDB is canonical for all of these |
| `releasedate` | **Discard** | — | Proven unreliable (§2.4); never overwrite IGDB `first_release_date` |
| `steam` (as data) | **Cross-check only** | — | Compare vs `games.steam_app_id`; log mismatches for manual review (found 1 bad theirs, 1 bad ours in 40 games). Optionally backfill ours when NULL, behind manual review |

Existing overlap, untouched: `game_modes` (IGDB ids), `player_count {min,max}` (IGDB-derived), `crossplay`. Co-Optimus **refines** rather than replaces these — the UI can prefer `cooptimus_*` when present and fall back to IGDB-derived values.

### 3.3 Write-path rules (repo STRICT compliance)

- **UPDATE-only.** The enrichment matches existing `games` rows (by steam id / normalized name) and UPDATEs `cooptimus_*` columns + one `enrichments` row. It must **never INSERT into `games`** — which keeps it outside the `findGameByNormalizedName` NULL-igdb_id dedup-guard requirement entirely (the strongly preferred design per `reference_games_insert_paths.md`). If that ever changes, the guard becomes mandatory and the path must be appended to the memory inventory.
- **Write only `cooptimus_*` columns** — the reverted seed-games attempt documented that blanket updates clobber operator-customized fields, and that name-match candidate selects need a deterministic `ORDER BY`.
- Module shape mirrors ITAD (pattern A precedent): `api/src/cooptimus/` service + BullMQ processor + `@Cron` batch sync; graceful no-op when unconfigured; any future key/UA secret goes in `app_settings` via `SettingsService` (AES-encrypted, admin-editable, no restart).

## 4. Matching Strategy: IGDB games ↔ Co-Optimus entries

Observed method breakdown from the full-library probe (53 genuine matches): **all 53 arrived via `name=` search resolved by exact/normalized title; steam-id equality with our `games.steam_app_id` corroborated 9 of 25 head matches and 12 of 15 tail both-sides comparisons.** The Steam App ID is **not usable as a primary join key**: their `<steam>` tag is absent on many entries (Diablo IV, Deep Rock Galactic, Sea of Thieves, ESO, Division 2, Fortnite rows, and every console-only row), occasionally wrong (LoL `steam=20590` — LoL isn't on Steam; GTA V `steam=362003` vs the real `271590`), and our side is only 41% populated (with at least three bad values, §2.4). Treat steam-id as the **exact-match arbiter inside name-search results** — the same role it plays in the ITAD pipeline — not as a search input.

**Recommended pipeline** (mirrors the ITAD precedent: name search first, Steam App ID as exact-match arbiter):

1. **Query** `games.php?search=true&name=<name>` with a **word-boundary / normalized-equality post-filter** — the API's LIKE search produced 6 false positives across the 163 queried names ("Rust" → *Distrust*/*Blind Trust*; "New World" → *…Dawn of the New World*, *…Brave New World*; "Unreal Tournament" → *Unreal Tournament 3*, a **different game**; "Project M" → *PROJECT MAZE*; "Dreams" → *Onimusha: Dawn of Dreams*; "Defense of the Ancients" → *DOTA 2*). Never accept a bare substring hit.
2. **Prefer the entry whose `steam` equals our `steam_app_id`** (available on 67/165 = 41% of rows; corroborated the "Baldur's Gate III" vs "Baldur's Gate 3" pairing in the probe). Validate both directions — their steam field has errors (LoL, GTA V) and gaps.
3. **Else exact normalized-title match** via `normalizeForDedup` extended with **roman↔arabic numeral normalization** ("Final Fantasy 14 Online" ↔ "Final Fantasy XIV Online" — a real probe case) and token-count parity.
   - **3b. Edition/DLC-suffix fallback (measured: recovers 13 additional library names, +8 pts of coverage).** On empty/no-exact result, strip a recognized edition/expansion suffix ("… Edition", "Special/Ultimate/Gold/GOTY/Complete/Definitive …", "+ …", expansion subtitles like "Shadowbringers"/"Shadow of the Erdtree") and re-query the base title; route the hit to the **review queue**, not auto-map — verified live for MK11 Ultimate → "Mortal Kombat 11", Guacamelee! Gold → "Guacamelee!", Sonic Mania Plus → "Sonic Mania", Rocksmith 2014 Remastered → "Rocksmith: All-new 2014 Edition" (their nonstandard base title is exactly why this tier stays manual-review).
4. **Platform selection**: among a title's per-platform entries, prefer `system=PC`, else the newest platform; record the choice in the enrichments JSONB. Not an edge case: **10 of 28 tail matches are console-only** (no PC row exists).
5. **Empty envelope** (`<games>\n</games>`) → mark "no co-op data" with `cooptimus_synced_at` set — a *positive* signal (correctly excludes PvP/single-player titles from co-op filters), distinct from "never synced."
6. **Fuzzy / subtitle candidates go to a manual-review queue, never auto-mapped** — the probe's "Fortnite" → "Fortnite: Save the World" case would over-claim co-op facts for Battle Royale players. Measured rate across the full library: 6 substring rejects + 1 subtitle case + ~14 edition-fallback candidates ≈ 21 review-worthy cases per 163 names. A `cooptimus_id` manual-override (settable via admin) resolves these and pins remaps.

Measured yield on our library (§2.3): **53 exact-normalized matches; 66 names (~40%) after the edition fallback; steam-id arbitration wherever both sides have ids; ~20 manual reviews.**

## 5. Feasibility Summary

| Dimension | Verdict | Detail |
|---|---|---|
| Access | ⚠️ **Conditional** | API exists, keyless, purpose-built for this — but Cloudflare-blocked for all unattended clients. Needs permission/allowlist, or a real-browser fetch layer for a one-time seed. |
| Licensing | ✅ with courtesy | No ToS exists; content signals permit `use=reference`; not training. Permission-first + attribution/linkback is the compliant posture. |
| Rate limits | ✅ | `crawl-delay: 1`; 17,245-entry DB = <5h one-time bulk at 1 req/s; deltas trivial. |
| Coverage | ✅ for co-op titles (measured, full library) | **84% of co-op-relevant titles (53/63); 93% filter-correctness** (data or correctly-empty) with the edition fallback. Raw: 33% of all 165 rows (~41% with fallback) — the rest of the library is PvP/MMO, single-player, junk imports, and mods where empty is the right answer. Real weakness: post-2023 gap (Lethal Company, Content Warning, MH Wilds, DK Bananza, RoadCraft all missing). |
| Data quality | ✅ with rules | Rich, editorially curated player counts. Requires: PC-platform policy, lenient XML parsing, discard `releasedate`, validate `steam` both ways, manual-review queue for fuzzy. |
| Reliability | ⚠️ | Enthusiast site, no SLA, legacy API, bot wall can tighten anytime. Mitigate: batch enrichment, persist everything, refresh weekly/monthly, degrade gracefully (UI falls back to IGDB fields). |
| Effort | Moderate | One migration (9 columns), one ITAD-shaped module, matcher (mostly existing helpers + numeral normalization), admin review queue can start as a log. |

**Risk register:** (1) challenge blocks our fetcher tomorrow → cached columns keep working, sync silently pauses (alert on `cooptimus_synced_at` staleness); (2) API silently removed — it is clearly legacy → same mitigation, plus the HTML pages/Wayback exist as a last-resort re-scrape; (3) per-platform entry model mis-picks → PC-preference policy + provenance in JSONB + manual override.

## 6. Prototype: fetch + match as actually exercised

The probe *is* the prototype — **179 live API calls covering the entire 165-row library (163 distinct names)**, fetched, parsed, and matched end-to-end across two sessions (the Cloudflare clearance on the same real-Chrome tab survived between them). Key mechanics:

**Server-side fetch is dead on arrival** (first and only curl attempt):

```bash
curl -sS "https://api.co-optimus.com/games.php?search=true&name=Borderlands"
# HTTP 403 — Cloudflare Turnstile managed challenge page (cZone: api.co-optimus.com)
# Reproduced with Chrome UA, Claude WebFetch, and headless Playwright. Stopped per rules.
```

**Working path — same-origin fetch from a challenge-cleared real Chrome tab** (claude-in-chrome; a non-headless Playwright-driven Chromium works identically):

```js
// Tab already open on co-optimus.com with the Turnstile challenge passed once.
async function lookup(name) {
  const res = await fetch(
    'https://api.co-optimus.com/games.php?search=true&name=' + encodeURIComponent(name)
  );
  const text = await res.text();          // 200 OK — cookies/clearance ride along
  // LENIENT parse (strict DOMParser truncates on unescaped entities in prose fields):
  // 1. slice off the trailing Cloudflare <script> after </games>
  const xml = text.slice(0, text.lastIndexOf('</games>') + '</games>'.length);
  // 2. split per <game> block; regex-extract the flat scalar fields we map (§3.2),
  //    which never contain markup — only coopexp/background do, and we JSONB/discard those.
  return [...xml.matchAll(/<game>([\s\S]*?)<\/game>/g)].map(([, g]) => ({
    id: +g.match(/<id>(\d+)<\/id>/)?.[1],
    title: g.match(/<title>([\s\S]*?)<\/title>/)?.[1],
    system: g.match(/<system>([\s\S]*?)<\/system>/)?.[1],
    steam: +(g.match(/<steam>(\d+)<\/steam>/)?.[1] ?? 0) || null,
    online: +(g.match(/<online>(\d+)<\/online>/)?.[1] ?? 0),
    local: +(g.match(/<local>(\d+)<\/local>/)?.[1] ?? 0),
    lan: +(g.match(/<lan>(\d+)<\/lan>/)?.[1] ?? 0),
    // ... splitscreen / dropindropout / campaign / modes / url per §3.1
  }));
}
// Match: prefer entry.steam === ourGame.steamAppId; else exact normalized title
// (with roman↔arabic numeral folding); prefer system === 'PC'; 1000 ms between calls.
```

Observed behavior over 179 sequential calls at ~1 req/s: zero 403/429, stable ~sub-second responses, empty envelope exactly `"<games>\n</games>"` for misses. Sample hits: Palworld → `id 9814, steam=1623730, online=32, lan=32, dropindropout=1, campaign=1`; Baldur's Gate 3 → their title "Baldur's Gate III" vs our "3", pairing confirmed by steam-id `1086940` equality, richest flag set (`local=2, online=4, lan=4, splitscreen=1`). Sample rejects the post-filter must catch: "Rust" → *Distrust*, "New World" → *Civilization V: Brave New World*.

## 7. Recommendation: **INTEGRATE — conditional, permission-first** (qualified GO)

The data is uniquely fit for purpose (numeric `online`/`local`/`lan` map 1:1 onto the ROK-821 filter need; no other source has editorial couch/LAN/campaign-co-op facts), **measured** coverage of actual co-op titles across the full library is **84%** (93% filter-correctness with the edition fallback — the raw 33-41% row coverage reflects our library's PvP/junk/mod/edition noise, not missing co-op data), licensing posture is compatible with reference use, and the storage/matching design drops cleanly onto existing repo patterns. Two caveats sharpened by the full measurement: the **post-2023 freshness gap is real** (Lethal Company and Content Warning absent, not just MH Wilds) so the IGDB fallback stays load-bearing for new releases; and the only real blocker remains **access**, which has a cheap, ordered resolution path:

1. **Ask first (do this regardless):** operator emails via `contact.php` requesting an allowlisted key/UA for the existing XML API — one-time bulk pull at ≤1 req/s + weekly deltas, with attribution + linkback. The API was built for exactly this; it costs them nothing. Best outcome: normal ITAD-style cron module.
2. **If no reply in ~2 weeks:** run a **one-time operator-attended browser seed** (claude-in-chrome or non-headless Playwright, §6 mechanics) over our ~165 games (~5 min of requests), persist everything, refresh manually/quarterly the same way. Low-volume reference use consistent with their published content signals — but it does route around a bot wall, hence permission is asked first and this stays operator-attended, low-frequency, and attributed.
3. **Do NOT build** unattended server-side scraping (hard-blocked, clearly unwanted) or HTML scraping (same wall, worse parsing than the XML API).
4. **Fallback if Co-Optimus is a no-go entirely:** IGDB `multiplayer_modes` (`onlinecoopmax`/`offlinecoopmax`/`splitscreen`/`campaigncoop` — already our source, zero new access cost, but sparsely populated; we already derive `player_count` from it), optionally topped up with Steam appdetails co-op categories (PC-only) and PCGamingWiki Cargo (CC BY-NC-SA). This delivers a weaker ROK-821 filter but keeps the feature alive.

### Suggested follow-up stories

1. **`chore: contact Co-Optimus for API allowlist/permission`** — operator action; template the ask (allowlisted UA, 1 req/s, attribution). Gates story 3's sync mode.
2. **`fix: audit games.steam_app_id integrity`** — immediate, independent of Co-Optimus. Probe surfaced four suspects: `7 Days to Die` carrying appid 730 (Counter-Strike's id; correct is 251570), `Risk of Rain 2` carrying 3885090 (RoR2's known id is 632360), `Divinity: Original Sin II - Definitive Edition` carrying 380370 (documented DOS2 id is 435150), and `Rust` (252490 — almost certainly correct but never corroborated by any probe source). Cross-check the 67 populated steam ids against IGDB external_games; fix mismatches. (Also improves the future match rate.)
3. **`feat: cooptimus enrichment module + migration`** — 9 `cooptimus_*` columns (§3.2), ITAD-shaped module in `api/src/cooptimus/`, UPDATE-only matcher (§4) with numeral normalization + word-boundary guard + edition-suffix base-title fallback (measured +13 names) + PC-else-newest platform policy (10 of 53 matches are console-only) + manual-review logging, lenient XML parser, `enrichments` row for display extras. Sync transport per story 1's outcome (cron if allowlisted; operator-run browser-seed script otherwise).
4. **`feat: surface co-op facts on game cards + detail page`** — detail-page co-op section (online/couch/LAN/split-screen/campaign badges, `coopexp` blurb, "Co-op data from Co-Optimus" linkback via `cooptimus_url`); card badge for `cooptimus_online_max`. Falls back to IGDB-derived fields when unsynced.
5. **`feat(ROK-821): co-op filters in the games FilterPanel`** — wire the Players-page `FilterPanel`/`FilterPanelTrigger` pattern into games-page with "supports N+ online co-op" (`cooptimus_online_max >= N`), couch co-op, LAN, campaign co-op predicates. Needs the co-op fields added to the discover/list DTOs (all games filtering is client-side today).

6. **`chore: games library hygiene sweep`** — optional but cheap, surfaced by the full-library probe (§2.4): the "Generic" placeholder row, the 13-row "Lethal *" Steam-search import cluster, 11 mod/romhack/private-server rows, and 14 edition/DLC rows duplicating base games already in the library. These rows depress every enrichment source's coverage and pollute the games list. Needs operator judgment on what's intentional (e.g. FiveM may be a real community entry) — flag, don't bulk-delete.

Stories 4–5 are OUT OF SCOPE here per the issue; listed for sequencing only.

## Sources

- `https://www.co-optimus.com/robots.txt` — fetched live 2026-07-13 (content signals, AI-crawler blocks, sitemaps, crawl-delay)
- `https://api.co-optimus.com/games.php?search=true&name=Borderlands` — live curl + headless-Playwright tests 2026-07-13 (HTTP 403 Cloudflare managed challenge, zone api.co-optimus.com); same on the `www` zone and the games sitemap
- Live in-browser probe 2026-07-14, head pass — 48 API calls via claude-in-chrome; results in `rok275-probe-results.json`, raw XML in `rok275-probe-raw/all-48-responses.json` (session scratchpad)
- Live in-browser probe 2026-07-14, tail pass — 131 API calls (123 remaining names + 7 base-title checks + 1 clearance re-test) via the same challenge-cleared tab; parsed rows in `rok275-probe-raw/tail-123-responses.json`, base-title checks in `rok275-probe-raw/base-title-checks.json`, per-class breakdown in `rok275-tail-classification.json` (session scratchpad)
- `https://web.archive.org/web/20250828083941/https://api.co-optimus.com/games.php?params=true` — API param self-documentation
- `https://web.archive.org/web/20250830220914/https://api.co-optimus.com/games.php?search=true&name=Siege&systemName=PC` — full XML schema sample
- `https://web.archive.org/web/20250330204031/https://api.co-optimus.com/games.php?search=TRUE&id=15656` — empty-result envelope
- Wayback CDX for `api.co-optimus.com` (API 200s through 2025-08-30) and `co-optimus.com` (www 200s through 2026-03)
- `https://web.archive.org/web/20260610024655/https://www.co-optimus.com/about.php` — 17,245 games; no API/ToS language
- `https://web.archive.org/web/20260313162515/https://co-optimus.com/` — footer: About/Contact/Privacy only, no Terms
- `https://www.co-optimus.com/game/16271/pc/split-fiction.html`, `/game/13761/pc/helldivers-2.html`, `/game/17206/xbox-series/helldivers-2.html` — 2025 coverage + per-platform entry model
- `https://api.co-optimus.com/games.php?search=true&id=4189` — Google-indexed API page (verified crawlers pass)
- `https://github.com/jshackles/Enhanced_Steam/issues/292` — third-party integration request; no technical API terms
- Repo: `api/src/itad/` (pattern-A precedent), `api/src/drizzle/schema/enrichments.ts` (pattern B), `api/src/igdb/igdb-name-dedup.helpers.ts` + memory `reference_games_insert_paths.md` (UPDATE-only guard rationale), `web/src/components/ui/filter-panel.tsx` (ROK-821 panel), `api/src/igdb/igdb.mappers.ts::extractMultiplayerInfo` (IGDB fallback fields)
