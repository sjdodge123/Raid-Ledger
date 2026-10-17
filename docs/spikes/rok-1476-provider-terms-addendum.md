> **Source:** `planning-artifacts/second-deployer-audit-addendum-provider-terms-2026-09-20.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-09-20
> **Linear:** ROK-1476

# ROK-1476 addendum — Per-provider relay redistribution terms

**Date:** 2026-09-20 · **Scope:** the one ask the [second-deployer audit](./rok-1476-second-deployer-audit.md) did not deliver — *per provider, is relay-mediated redistribution permitted?*
**Relay model assessed:** ONE relay server holds the API keys, fetches game metadata / prices / character data, caches it, and serves it to many independent self-hosted Raid Ledger instances. Non-commercial, open source, operator-run.
**Out of scope:** Co-Optimus (already answered in depth — `docs/spikes/relay-data-contract.md` §7; the UA exemption is single-instance and multi-instance redistribution requires renegotiation).

> **Method note.** Every claim below is sourced to a URL with a short verbatim quote. Where a terms page could not be retrieved, that is stated plainly and the verdict is **UNCLEAR** — nothing here is reconstructed from memory.
> **This is engineering due diligence, not legal advice.** The UNCLEAR verdicts need an email to the provider, not a judgement call by an agent.

---

## 1. IGDB / Twitch

### What the repo pulls

Two distinct surfaces, governed by the same agreement but with different authorisation:

| Call | Where | Data |
|---|---|---|
| `POST https://id.twitch.tv/oauth2/token` | `api/src/igdb/igdb-api.helpers.ts:36` | app access token (client_credentials) |
| `POST https://api.igdb.com/v4/games` | `api/src/igdb/igdb-api.helpers.ts:88` | APICALYPSE game metadata — the catalogue |
| `GET https://api.twitch.tv/helix/streams?game_id=…` | `api/src/igdb/igdb-streams.helpers.ts:55` | live stream counts per game |
| Image URLs | `api/src/igdb/igdb.constants.ts:81-83` | `images.igdb.com/igdb/image/upload/t_cover_big` / `t_screenshot_big` — **URLs stored, bytes not mirrored** |

IGDB game data is **persisted indefinitely**, not just cached: `igdb-upsert.helpers.ts`, `igdb-registry.helpers.ts`, `igdb-sync.processor.ts`, re-enriched by `igdb-reenrichment.helpers.ts`, search results cached (`igdb-search-cache.integration.spec.ts`). This is the dataset a relay would redistribute.

### What the terms say

IGDB routes its licensing through Twitch: *"The IGDB.com API is free for non-commercial usage under the terms of the Twitch Developer Service Agreement"* — <https://api-docs.igdb.com/> (Account Creation).

**Twitch Developer Services Agreement — <https://legal.twitch.com/legal/developer-agreement/>, §V.C "Storage of Program Materials/Twitch Content":**

- *"Do not store copies of Twitch Content or Program Materials, unless you: (a) obtain prior written authorization from Twitch"*… *"or (c) cache such information for only a twenty-four hour time period without further sharing it with third parties."*
- **The decisive clause: *"Re-syndication and re-distribution of Program Materials or data as available from a Twitch API is prohibited."***
- Licence (§III.2): *"a limited, non-exclusive, worldwide, royalty-free, non-transferable, non-sublicensable, revocable license"*
- Keys (§IV.B): *"Keep them secret. Also, you may not sell, transfer, or sub-license them."*
- Rate limits (§IV.C): no number in the agreement; Helix uses a token bucket — *"If your bucket runs out of points within 1 minute, the request returns status code 429"* (<https://dev.twitch.tv/docs/api/guide>). IGDB states its own: *"There is a rate limit of 4 requests per second"* and *"up to 8 open requests at any moment"* (<https://api-docs.igdb.com/>).
- Attribution (§III.2.ii): Twitch Marks used *"solely to attribute Twitch's offerings as the source of the Program Materials"*.

**IGDB's own FAQ modifies this materially** (<https://api-docs.igdb.com/> → Business related FAQ):

- Q3 storage: *"Am I allowed to store/cache the data locally? Yes. In fact, we prefer if you store and serve the data to your end users."*
- Q5 retention: *"You are allowed to keep all data you retrieve from the API and we will not ask you to remove the data"*
- Q2 price: *"The API is free for both non-commercial and commercial projects."*
- Q4 attribution: *"We expect fair attribution, i.e. attribution that is visible to your users and located in a static location"*
- Commercial channel: `partner@igdb.com`

### Verdict — `FORBIDDEN → stays bring-your-own-key` (escalation path exists: written authorization from IGDB)

Split the question, because the two halves land differently:

- **Storing IGDB data indefinitely: PERMITTED.** IGDB's FAQ Q3/Q5 is exactly the *"prior written authorization"* that DSA §V.C(a) contemplates, and it overrides the 24-hour default. **This is a useful clearance for the repo as it stands today** — the existing permanent `games` rows are fine.
- **Redistributing it to other operators' servers: prohibited as written.** *"Re-syndication and re-distribution of Program Materials or data as available from a Twitch API is prohibited"* describes the relay model almost literally, and the licence is expressly non-sublicensable. IGDB's permission is scoped to *"serve the data to **your end users**"* — a second deployer's server is a third party, not the licensee's end user.
- **The Twitch Helix stream counts (`igdb-streams.helpers.ts`) have no IGDB carve-out at all** — they are plain Twitch Content, so the bare 24-hour, no-third-party-sharing rule applies. Relaying them is clearly out; even local caching should stay under 24h.
- **Images are fine either way** — the repo stores `images.igdb.com` URLs and hotlinks them rather than mirroring bytes, so no copy of Twitch Content is being re-hosted. **The relay must keep this property**: pass image URLs, never proxy or mirror the image files.

Because DSA §V.C(a) makes this a permission that *can be granted*, and IGDB's stated posture is *"accessibility of data… you are not only contributing to the value of IGDB but to thousands of other projects as well"*, this is worth one email before writing off relay slice 1.

**Draft question to `partner@igdb.com`:**

> Hi — I maintain Raid Ledger, a free, open-source, self-hosted tool for organising gaming sessions (no ads, no paid tiers, no resale of data). Instances are run independently by individual communities on their own hardware. Today each operator must register their own IGDB/Twitch client to get game metadata, which is a significant barrier for non-technical self-hosters. I'd like to run a single relay service that holds one IGDB client, fetches game metadata (name, cover image_id, genres, release date, summary, external ids), and serves that cached metadata to those independent instances so they need no credentials of their own. Image files would not be mirrored — instances would continue to hotlink `images.igdb.com` URLs — and every instance would carry visible, static IGDB.com attribution. I recognise this reads as re-distribution under §V.C of the Twitch Developer Services Agreement, which is why I'm asking rather than assuming: is this something you would authorise in writing, and if so under what conditions?

---

## 2. Steam Web API

### What the repo pulls

All Steam calls go through `api/src/steam/steam-http.util.ts` against `https://api.steampowered.com`:

| Endpoint | Line | Data |
|---|---|---|
| `ISteamUser/GetPlayerSummaries/v2` | `:84`, `:104` | persona name / avatar for a linked account |
| `IPlayerService/GetOwnedGames/v1` | `:117`, `:142` | owned app ids, `include_appinfo`, `playtime_forever` |
| `IWishlistService/GetWishlist/v1` | `:155`, `:163`, `:175` | wishlisted app ids |

Consumed by `steam-sync.processor.ts`, `steam-playtime.helpers.ts`, `steam-wishlist.service.ts`, `steam-bulk-sync.helpers.ts`, and surfaced in the Discord `steam-link` flow (`api/src/discord-bot/listeners/steam-link.helpers.ts`). Login uses Steam OpenID (`api/src/steam/steam-auth.controller.ts`, `steamcommunity.com/openid/login`) — that is an auth flow, not a data licence.

**The storefront `appdetails` endpoint is NOT used.** A grep for `appdetails` / `appreviews` / `store.steampowered.com/api` across `api/src` returns nothing; every `store.steampowered.com/app/<id>` string in the repo is a *link* built for display (`steam-link.helpers.ts`, `steam-itad-discovery.helpers.ts`). So the undocumented-storefront-API licensing question does not arise here.

### What the terms say

Source: **Steam Web API Terms of Use — <https://steamcommunity.com/dev/apiterms>**

- Licence scope (§2): *"distribute Steam Data to end users for their personal use via your Application"*
- Key sharing (§2): *"You will keep your Steam Web API key confidential, and not to share it with any third party."*
- Storage (§2): *"You will inform the end user about any Steam Data you will store"* — no stated maximum duration.
- Attribution (§3): *"implement the Valve name(s), logo(s), and links to Valve"* per the Web API documentation.
- Rate limit (§2): *"You are limited to one hundred thousand (100,000) calls to the Steam Web API per day."*
- Commercial vs non-commercial: no distinction drawn; the terms apply uniformly.

### Verdict — `FORBIDDEN → stays bring-your-own-key`

Two independent reasons:

1. **The licence is scoped to "your Application" serving "end users."** A relay that fetches with the operator's key and hands results to N other deployers' servers is distributing Steam Data to third-party applications, not to end users via the licensee's own Application. Combined with the explicit key-confidentiality clause, the whole point of the relay (one key, many instances) sits outside the grant.
2. **It is moot for the relay anyway — every Steam datum in this repo is per-user.** Owned games, playtime and wishlist all key off a *linked individual's* SteamID. A central relay has nothing to pre-fetch and cache on behalf of a stranger's instance; each deployer's users must link their own accounts regardless.

*Residual ambiguity (flagged, not guessed):* whether many self-hosted copies of one open-source app count as one "Application" is arguable, and the terms do not address it. Because reason 2 makes Steam useless to the relay regardless, this is not worth an email.

---

## 3. IsThereAnyDeal (ITAD)

### What the repo pulls

Base URL `https://api.isthereanydeal.com` (`api/src/itad/itad.constants.ts:5`), transport in `itad-http.util.ts` (key appended as a `key=` query param, redacted in logs at `:18-20`). Endpoints seen: `/games/lookup/v1` and `POST /lookup/shop/{shopId}/id/v1` (`itad.constants.ts:65`). Price/deal data is **persisted and cached** — `itad-price-sync.service.ts`, `itad-price-sync.processor.ts`, `itad-cache.util.ts`, `itad-early-access-sync.helpers.ts` — and merged onto game rows by `api/src/igdb/igdb-itad-merge.helpers.ts` / `igdb-itad-upsert.helpers.ts`, then rendered as deals on the discover surface (`igdb-discover-deals.helpers.ts`).

### What the terms say

Source: **ITAD API Terms of Service — <https://github.com/IsThereAnyDeal/API/blob/master/TERMS_OF_SERVICE.md>** (the canonical ToS, linked from <https://docs.isthereanydeal.com/>)

- Commercial use: *"You MAY use this API for commercial purposes IF the resulting app is available to public."*
- Attribution: *"You SHOULD provide a link to IsThereAnyDeal.com or mention IsThereAnyDeal API."*
- Affiliation: *"You MUST NOT make an impression that you are affiliated with IsThereAnyDeal, unless agreed otherwise."*
- Data integrity: *"You MUST NOT change provided data in any way. This means that you can't remove affiliate tags from the URLs, change prices and so on."*
- Partial use is allowed: *"You MAX [sic] use only part of data provided and enrich them from your own sources."*
- Competition: *"You MUST NOT make an app that could be considered a competition to IsThereAnyDeal or IsThereAnyDeal projects."*
- Revocation: *"We reserve the right to deny you access to the API at any point without notice."*
- Caching / rate limits: the ToS itself is silent on caching; the API docs' rate-limiting guidance is *"You should not be constantly maxing out your usage; implement proper caching."* — i.e. caching is **encouraged**, not capped.

### Verdict — `PERMITTED WITH CONDITIONS`

This is the most relay-friendly of the four. Nothing in the ToS forbids redistribution or serving cached results onward, caching is explicitly wanted, and non-commercial open-source use is comfortably inside "available to public." Conditions the relay MUST carry:

1. **Pass shop URLs through byte-for-byte, including affiliate tags** — all the way from relay → instance → browser. Any relay-side URL normalisation, tracking-param stripping, or price rounding breaks *"MUST NOT change provided data in any way."* This is a real implementation trap for a relay that is otherwise inclined to canonicalise everything.
2. **Every downstream instance shows the ITAD attribution**, not just the relay. The attribution obligation travels with the data; a deployer who never signed up for ITAD still has to display the link.
3. **Neither the relay nor the hub may present itself as a deals site.** Prices are enrichment on a raid-scheduling catalogue; a standalone "hub.raid-ledger.com price browser" would run at the "competition to IsThereAnyDeal" line.
4. **No impression of affiliation** in relay branding or docs.
5. **Single point of revocation.** Access can be pulled *"at any point without notice"* — with one relay key, that takes out deals for every instance at once. Slice 1 must degrade to "no prices" cleanly, exactly as `isItadConfigured()` does today.

*One sub-question worth an email (does not block slice 1):* ITAD issues per-app keys via <https://isthereanydeal.com/apps/>, and the ToS is written for "your app." Serving cached ITAD data to independently-operated third-party servers is neither permitted nor forbidden explicitly. Recommended: register the relay as its own app and mention the redistribution model in the registration — cheap, and it converts a silent assumption into a recorded one.

---

## 4. Blizzard Developer API

### What the repo pulls

OAuth via `https://us.battle.net/oauth/token`; data from `https://us.api.blizzard.com`. Endpoints in `api/src/plugins/wow-common/blizzard-profile.helpers.ts`: `/profile/wow/character/...` (`:109`, `:121`, `:150`, `:158`), `/data/wow/journal...` (`:116`, `:147`), `/data/wow/item/` (`:178`), `/data/wow/media/item/` (`:184`). Realm index is used as a connectivity canary (`api/src/canary/blizzard.canary.ts:43`, `/data/wow/realm/index`). Imported character data is persisted into the characters tables via `api/src/characters/characters-import.helpers.ts` / `characters-sync.helpers.ts`.

### What the terms say

Source: **Blizzard Developer API Terms of Use — <https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use>**

- Licence grant (§2): *"limited, non-exclusive, non-assignable, non-sublicensable, non-transferable, revocable right"*, to *"distribute the Data to end users for their personal use via Your Application."*
- Transfer ban (§2.i): *"not allowed to sell, license or otherwise transfer the Data to any third party"*
- Key sharing (§2.l): *"keep Your API Key confidential, and not share it with any third party"*
- **Storage duration (§2.r): *"maximum 30-day TTL (time-to-live) policy for all Data obtained through our APIs"*** — a hard cache expiry, unusual among the four.
- Attribution (§2.m): *"clearly and conspicuously identify Blizzard in Your Application as the source of the Data"*
- Commercial (§2.b): *"Applications offering additional for-pay features are not permitted...players be charged money"*
- Rate limit (§2.q): *"limited to thirty-six thousand (36,000) calls to the Blizzard Developer API per hour"*

### Verdict — `FORBIDDEN → stays bring-your-own-key`

The clearest FORBIDDEN of the four, and it does not need interpretation:

- The grant is expressly **non-sublicensable and non-transferable**, and §2.i bans transferring Data *"to any third party"* — a relay serving other deployers' servers is exactly that transfer. Serving *end users* is the only permitted distribution, and only *via Your Application*.
- §2.l forbids sharing the API Key, which is the relay's alternative framing (each instance using the operator's client) as well.
- As with Steam, it is also **moot**: WoW character/profile data is per-account, fetched against a specific character on a specific realm. There is no shared corpus for the relay to warm.

Two conditions worth noting for the *existing single-instance* app regardless of the relay (these are current-state observations, not relay work):

- **The 30-day TTL (§2.r) applies to data this repo already persists.** Imported character rows that are never refreshed or expired would drift past that window. Worth a look during any future Blizzard-plugin work — flagged here, not investigated in this pass.
- **Attribution (§2.m)** — "clearly and conspicuously identify Blizzard as the source" on the character surfaces. Not verified in this pass.

---

## 5. Summary table

| Provider | Local storage allowed? | Max cache/TTL | Relay redistribution | Attribution | Commercial | Rate limit | **Verdict** |
|---|---|---|---|---|---|---|---|
| **IGDB / Twitch** | Yes — IGDB FAQ Q3/Q5 grants it | none for IGDB data; **24h** for Twitch Helix content | *"Re-syndication and re-distribution … is prohibited"* (DSA §V.C); licence non-sublicensable | Fair, visible, static | Free either way; partnership for monetised | 4 req/s (IGDB); token bucket (Helix) | **FORBIDDEN → bring-your-own-key** *(escalation: written authorization via `partner@igdb.com` — email drafted §1)* |
| **Steam** | Yes, with disclosure | none stated | Out of licence scope — *"to end users … via your Application"*; key must stay confidential | Valve name/logo/links | No distinction | 100,000 calls/day | **FORBIDDEN → bring-your-own-key** *(and moot: all Steam data here is per-linked-user)* |
| **ITAD** | Yes — caching encouraged | none stated | Not prohibited; silent on third-party servers | Link to IsThereAnyDeal.com | Allowed if the app is public | "should not be constantly maxing out"; no number | **PERMITTED WITH CONDITIONS** (5 conditions, §3) |
| **Blizzard** | Yes, bounded | **30-day TTL** (§2.r) | *"not allowed to sell, license or otherwise transfer the Data to any third party"* (§2.i); non-sublicensable | Clearly and conspicuously identify Blizzard | No for-pay features | 36,000 calls/hour | **FORBIDDEN → bring-your-own-key** *(and moot: per-character data)* |
| *(Co-Optimus)* | — | — | — | — | — | — | *Out of scope — answered in `docs/spikes/relay-data-contract.md` §7: UA exemption is single-instance; multi-instance needs renegotiation* |

No provider landed on UNCLEAR: all four terms pages were retrieved and quoted directly. The one open item is a *permission to request*, not an unread term.

---

## 6. What this means for relay slice 1

1. **Slice 1's headline promise — "a second deployer gets a populated catalogue with zero API keys" — is legally gated on one email, not on engineering.** IGDB metadata *is* the catalogue, and redistributing it is prohibited as written; send the drafted `partner@igdb.com` question *before* building the enrichment-pull path, because a "no" changes the slice's shape entirely.
2. **ITAD prices can ship regardless** — the only PERMITTED provider — provided the relay passes shop URLs through byte-for-byte with affiliate tags intact, every instance renders the ITAD attribution, and the hub never presents itself as a deals site.
3. **Steam and Blizzard are permanently bring-your-own-key** and should be documented as such in the deployer README. Both bans are explicit, and both are moot anyway: their data is per-user/per-character, so a relay has nothing to pre-warm.
4. **The no-permission-needed fallback, if IGDB says no:** relay only Raid Ledger's *own* data — the pre-seeded catalogue already in the repo plus instance-contributed game identities — which the project owns outright and can redistribute freely. That still removes the keys-on-day-one barrier for a stranger; it just yields a thinner catalogue than an IGDB mirror.
5. **Two design constraints to bake into the relay contract now, whatever the answer:** never mirror image bytes (pass `images.igdb.com` / `cdn.itad.com` URLs through), and never proxy the Twitch Helix stream counts — they carry the bare 24-hour no-sharing rule with no IGDB carve-out.

---

## Sources

- Twitch Developer Services Agreement — <https://legal.twitch.com/legal/developer-agreement/>
- Twitch API rate limits — <https://dev.twitch.tv/docs/api/guide>
- IGDB API docs + Business FAQ — <https://api-docs.igdb.com/>
- Steam Web API Terms of Use — <https://steamcommunity.com/dev/apiterms>
- IsThereAnyDeal API Terms of Service — <https://github.com/IsThereAnyDeal/API/blob/master/TERMS_OF_SERVICE.md> (docs: <https://docs.isthereanydeal.com/>)
- Blizzard Developer API Terms of Use — <https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use>

*All pages retrieved 2026-09-19/20. Terms change without notice — re-verify before acting on any verdict here.*

---

