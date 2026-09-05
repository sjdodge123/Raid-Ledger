# ROK-1485: Relay Server Data Contract Spike

**Date:** 2026-09-05
**Status:** Complete — recommendation + sequencing at the end; open questions in §11
**Scope:** Which data crosses instances via the relay, the wire shapes it crosses in, the sync/auth protocol at sketch level, the Co-Optimus licence position, and the classification rule every new DTO follows. OUT OF SCOPE: building the relay service, client SDK, registration UI, endpoints, hosting, anything touching prod.
**Anchors:** every `file:line` below was grepped on `rok-1485-spike` @ `988cb226` (= `origin/main` at spike time). Shapes from unmerged branches are cited by branch + commit and marked so.

Markers used throughout: **UNVERIFIED** = a factual claim this spike could not check from the repo; **OPEN** = a product or legal call for the operator, always paired with a default.

---

## 1. Why, and the three jobs

The operator's framing (ROK-1485 brief, 2026-09-05):

> "The idea of the relay server is to centralize data sources for game data too, so not each Raid Ledger instance owner needs to configure all of these data sources. They can simply connect to the relay server and it syncs down everything that's been discovered so far — reduces setup time and keeps all instances in sync about game ids and info. This relay server will also be used to support the Co-Optimus data since we only have permission to scrape through our one configuration. And ultimately it will be used for the LFG feature where we can find LFG members across multiple Discord servers after opt-in."

> "We're making data structures every day that may end up as part of the relay server."

The three jobs, in value order, and what each one is *really* about:

| # | Job | What crosses | Opt-in | Blocking dependency |
|---|-----|--------------|--------|---------------------|
| 1 | **Game-data sync** | Canonical game identity + third-party enrichment + dedup history | Instance-level, default ON once connected | None — first buildable slice |
| 2 | **Co-Optimus distribution** | Derived co-op facts (counts/booleans), never the user-agent | Instance-level, **licence-gated** | Renegotiation with Co-Optimus (§7) |
| 3 | **Cross-instance LFG** | A projection of `lfg_intents` rows whose `visibility = 'cross-community'` | Instance switch AND per-player, default OFF | ROK-274 player opt-in + non-Discord player identity |

**What already exists.** Nothing owns the relay today, but it is not a blank page:

- `api/src/relay/relay.service.ts` (ROK-273) already registers an instance, stores a bearer token, heartbeats hourly, and posts feedback. Endpoints it talks to: `POST /api/v1/instances/register` (`:184`), `POST /api/v1/instances/:id/heartbeat` (`:260`), `DELETE /api/v1/instances/:id` (`:237`), `POST /api/v1/feedback` (`:125`). Default hub `https://hub.raid-ledger.com` (`:18`). **UNVERIFIED:** whether any server answers at that host — `api/src/canary/relay.canary.ts:3-12` only probes `/api/v1/health`.
- Settings keys `RELAY_ENABLED / RELAY_URL / RELAY_INSTANCE_ID / RELAY_TOKEN` (`api/src/drizzle/schema/app-settings.ts:28-31`); admin controller `api/src/relay/relay.controller.ts:20-21` (`/admin/relay`, admin-guarded); `relayHubEnabled` surfaced on `GET /version` (`packages/contract/src/version.schema.ts:10`, `api/src/version/version.controller.ts:35`).
- The LFG seam: `lfg_intents.visibility` with CHECK `IN ('local','cross-community')` (`api/src/drizzle/schema/lfg-intents.ts:38-39, :59-62`), `LfgVisibilitySchema` (`packages/contract/src/lfg.schema.ts:22`), `LFG_VISIBILITIES` (`api/src/lfg/lfg.constants.ts:53-54`). Only `local` is written.

---

## 2. Entity inventory

### 2.1 Buckets

| Bucket | Meaning | Test |
|--------|---------|------|
| `relay-canonical` | The relay is the source of truth; instances adopt it and may only *override* locally, never publish a competing value. | "If two instances disagree, is one of them simply wrong?" → yes |
| `relay-projected` | Instance-owned data of which a defined, reduced **projection** may cross, under an opt-in. The projection is a separate DTO, not the row. | "Would another community benefit from a *subset* of this, and does the owner get to say no?" → yes |
| `instance-private` | Never crosses. No projection exists. Default for anything new. | Everything else — and anything carrying a Discord id, a display name, a message body, a measurement about a person, or an admin's local configuration |

### 2.2 `games` — column by column (`api/src/drizzle/schema/games.ts`)

The brief names the buckets; this table is the column-level ruling. "PD" = personal data (none in this table).

| `games.column` | line | Bucket | Reasoning |
|----------------|------|--------|-----------|
| `id` | `:23` | instance-private | Local serial; every FK in the instance points at it. The relay mints its own id (§4.2) and the instance keeps a mapping column. |
| `igdb_id` | `:24` | **relay-canonical** | Primary identity key. UNIQUE locally; the relay enforces the same. |
| `name` | `:26` | relay-canonical | Display name from IGDB/ITAD; the normalized form is the dedup key (`igdb-name-dedup.helpers.ts:58`). Local edits are overrides, not truth. |
| `slug` | `:27` | relay-canonical | URL identity; UNIQUE locally. Collision rule in §4.3. |
| `cover_url` | `:28` | relay-canonical | IGDB CDN URL, instance-agnostic. |
| `genres`, `game_modes`, `themes`, `platforms` | `:30, :39-41` | relay-canonical | IGDB id arrays. |
| `cached_at` | `:31` | instance-private | Local cache bookkeeping. |
| `summary`, `rating`, `aggregated_rating`, `popularity` | `:34-37` | relay-canonical | IGDB enrichment; `popularity` is IGDB's global figure, not community activity. |
| `screenshots`, `videos` | `:42-45` | relay-canonical | IGDB media refs. Largest payload contributor — see §4.5. |
| `first_release_date` | `:46` | relay-canonical | |
| `player_count` | `:47-50` | relay-canonical | IGDB lobby-size claim. Keep the memory rule: it is *capacity*, not a co-op claim. |
| `twitch_game_id` | `:52` | relay-canonical | Third-party id. |
| `steam_app_id` | `:54` | **relay-canonical** | Second identity key. Migration 0156 shows it can be *wrong* on an instance — the relay is where the corrected value lives (§4.3). |
| `crossplay` | `:56` | relay-canonical | Inferred/manual; treat manual local edits as overrides. |
| `hidden`, `banned` | `:58, :60` | instance-private | Moderation state (ROK-231). A banned game on one community is not banned on another. |
| `short_name` | `:64` | relay-projected (→ canonical *suggestion*) | Brief lists it under identity. It is admin-typed per community, so the relay carries a **suggested** value; local non-null wins. **OPEN Q3.** |
| `color_hex`, `has_roles`, `has_specs`, `enabled`, `max_characters_per_user`, `api_namespace_prefix` | `:66-72, :80-84` | instance-private | Community config (ROK-400 registry columns). `api_namespace_prefix` pairs with local Blizzard creds. |
| `itad_game_id` | `:74` | **relay-canonical** | Third identity key; UNIQUE locally. |
| `itad_boxart_url`, `itad_tags` | `:76-78` | relay-canonical | ITAD enrichment, key-bound to fetch, not to hold. |
| `itad_current_price/cut/shop/url`, `itad_lowest_price/cut`, `itad_price_updated_at` | `:88-100` | relay-projected (deferred) | Volatile (4-hourly cron `itad-price-sync.service.ts:125`), region-dependent, and every instance can fetch it with its own free ITAD key. Out of slice 1; a "deals" feed is a later slice if instance owners ask. **OPEN Q4.** |
| `early_access` | `:102` | relay-canonical | ITAD-sourced fact. |
| `igdb_enrichment_status`, `igdb_enrichment_retry_count` | `:104-110` | instance-private | Local worker state (ROK-986). Meaningless once enrichment arrives from the relay. |
| `website_url`, `is_free_to_play` | `:114-116` | relay-canonical | ROK-1377 facts; admin-entered today, so also accept local override. |
| `install_size_bytes`, `download_size_bytes` | `:120-122` | relay-canonical **when `install_size_source = 'steam_depot'`** | Depot-resolved sizes are instance-agnostic facts. |
| `install_size_source`, `install_size_updated_at` | `:124-126` | instance-private | `'manual'` rows are a local admin override and never published; timestamps are local bookkeeping. |
| `cooptimus_id` | `:133` | relay-canonical **once licensed**; instance-private until then | Identity key into Co-Optimus. Identity alone is arguably not "their data", but it was obtained under the grant — held with the rest of the family. §7. |
| `cooptimus_online_max/couch_max/lan_max`, `cooptimus_splitscreen/drop_in/campaign_coop/combo_coop`, `cooptimus_url` | `:135-149` | **instance-private until renegotiation**, then relay-canonical (job 2) | The derived co-op facts are exactly what the relay would redistribute. §7 quotes the grant: "nothing is redistributed". |
| `cooptimus_extras` | `:151` | instance-private (permanently) | Contains `coopExperience`/`description` prose — editorial text, gated OFF even locally (`COOPTIMUS_PROSE_ENABLED`, `app-settings.ts:94`). Never a relay field. |
| `cooptimus_synced_at` | `:161` | instance-private | Local sync bookkeeping; the relay has its own. |

**Net (60 columns):** 27 relay-canonical, 9 licence-gated (`cooptimus_*` facts + id + url), 1 suggestion-projected (`short_name`), 7 deferred-projected (ITAD price family), 16 instance-private.

### 2.3 Enrichment side tables and the data-source modules

| Table / module | Bucket | Reasoning |
|----------------|--------|-----------|
| `enrichments` (`api/src/drizzle/schema/enrichments.ts:12-24`) | instance-private | Keyed on `(entity_type, entity_id, enricher_key)` where the entity is a **character or event** (`:20-24`, e.g. `raider-io`, `warcraftlogs`) — per-player third-party data, not game data. |
| `games_dedup_audit` (`games-dedup-audit.ts:25-40`) | relay-projected → **alias history** | `match_type/match_key/canonical_game_id/dup_game_ids` is the raw material for the relay's alias table (§3.4): "these igdb ids / slugs collapsed into that canonical game". Local ids are stripped; only external keys and the winner's relay id cross. |
| `discord_game_mappings` (`discord-game-mappings.ts:12-18`) | relay-projected (later) | `discord_activity_name → game` is instance-agnostic and every instance rediscovers it. Cheap win for a later slice; not slice 1. |
| `game_taste_vectors` (`game-taste-vectors.ts:22-33`) | instance-private | Computed from *this* community's signals (`signal_hash`). |
| `player_taste_vectors`, `player_co_play`, `player_intensity_snapshots`, `game_activity_sessions/rollups` | instance-private | All per-user behavioural data. PD. |
| `api/src/igdb` | source module | Fetches via `settingsService.getIgdbConfig()` (client id/secret, `app-settings.ts:23-24`); 6-hourly sync `igdb.service.ts:104`. **With the relay, an instance needs NO IGDB credentials** for catalogue reads — that is the setup-time win the operator describes. Local search-and-add of a game the relay lacks still needs creds *or* goes through the relay (§4.4 contribution path). |
| `api/src/itad` | source module | `getItadApiKey()` (`app-settings.ts:86`); price cron 4-hourly. Identity + boxart/tags/early-access become relay-canonical; prices stay local (deferred). |
| `api/src/steam` | source module | `getSteamApiKey()` (`app-settings.ts:84`); daily sync `steam-sync.processor.ts:60`. Writes `users.steam_id`, `game_interests(source='steam_library'|'steam_wishlist')`, and **discovers new games** via `steam-itad-discovery.helpers.ts` — a games INSERT path (memory `reference_games_insert_paths`). Everything it writes about people is private; the games it discovers are contributions (§4.4). |
| `api/src/cooptimus` | source module | `getCooptimusUserAgent()` (`app-settings.ts:88`); weekly `cooptimus-sync.service.ts:78`, `COOPTIMUS_SYNC_CRON = '20 6 * * 1'`, `COOPTIMUS_RATE_LIMIT_MS = 1100` (`cooptimus.constants.ts:25-28`); UPDATE-only (`games.ts:128-131`). Disabled when the UA is unset (`cooptimus.service.ts:108`). Under job 2 the relay is the ONLY holder of the UA. |
| `api/src/enrichments` | plugin host | Character/event enrichers (`enrichments.constants.ts` job data carries `characterId`/`eventId`). Not game data; instance-private. |

### 2.4 LFG tables

| `table.column` | Bucket | Reasoning |
|----------------|--------|-----------|
| `lfg_intents.id` | instance-private | Local serial. |
| `lfg_intents.user_id` (`lfg-intents.ts:30`) | instance-private; projected as `relayPlayerId` | Never the local id, never the Discord id (§5.3). |
| `lfg_intents.game_id` (`:33`) | projected as `relayGameId` | Via the mapping column (§4.2). An intent for a game the relay does not know cannot be projected — the contribution path runs first. |
| `lfg_intents.status` (`:37`) | relay-projected (`active` only) | Only live rows are ever announced; `converted/expired/cleared` become a *withdrawal*. |
| `lfg_intents.visibility` (`:39`) | **the gate** | `'cross-community'` rows are the only ones with a projection at all. |
| `lfg_intents.created_at`, `expires_at` (`:40-42`) | relay-projected | `expiresAt` is what lets the relay expire without a callback. |
| `lfg_intents.converted_to_poll_id/event_id` (`:44-52`) | instance-private | Provenance into local lineups/events. |
| `lfg_intents.urgency` (ROK-1479 spec D1, unmerged) | relay-projected | Needed for cross-instance matching ("now" vs "this week"). Only crosses when `visibility='cross-community'`. `ttlMinutes` is not stored and does not cross. |
| `lfg_group_messages.*` (`lfg-group-messages.ts:34-46`) | instance-private | `guild_id/channel_id/message_id` are Discord snowflakes for *this* guild; `thread_id/post_kind` (rok-1471 branch) likewise. |
| `discord_thread_messages.*` (ROK-1483 spec, table at spec `:269-281`) | **instance-private, permanently** | `author_discord_id`, `author_display_name`, `author_avatar_hash`, `content`, attachments = message bodies and PD of guild members, mirrored under the guild's own Discord permissions. No projection may ever be defined for this table without a fresh privacy decision. |
| Channel bindings `binding_purpose='lfg-board'`, settings `LFG_BOARD_*` (rok-1471 branch) | instance-private | Local Discord wiring. |

### 2.5 Users, profiles, speed, share flags, interests

| `table.column` | Bucket | Reasoning |
|----------------|--------|-----------|
| `users.id` | instance-private | |
| `users.discord_id` (`users.ts:15`) | **instance-private (STRICT)** | The brief requires a player identity that is *not* a Discord id. A Discord id crossing instances would let any instance enumerate members of another guild. |
| `users.steam_id` (`:16`) | instance-private | Linked account id; PD. |
| `users.username`, `display_name`, `avatar`, `custom_avatar_url` (`:17-20`) | relay-projected **only** inside an LFG projection, only with per-player opt-in | The cross-community LFG card needs *something* to show. Project `displayName ?? username` + avatar URL as a snapshot; never the row. ROK-274's public profile defines the exact fields (**UNVERIFIED** — body not readable here; brief treats it as `cross_community_visible` + public profile). |
| `users.role`, `onboarding_*`, `game_time_confirmed_at`, `deactivated_at`, `kicked_at/reason`, `banned_at/reason` (`:21-34`) | instance-private | Moderation and local state. Ban/kick reasons are sensitive PD. Deactivated/banned users must be *excluded* from any projection (a withdrawal is emitted on deactivation). |
| `users.connection_downstream_mbps`, `connection_speed_source`, `connection_speed_measured_at`, `speed_test_consent_at`, `share_download_eta_at` (rok-1374-lifecycle branch, `users.ts` diff) | **instance-private (STRICT)** | The branch's own comment: "never returned for another user and never appears in an embed or a DM". The share flag consents to *this instance's rosters*, not to other instances. |
| `rosterEtas` / `RosterEtaSchema` (`packages/contract/src/lineup-tie.schema.ts` @ `c5670345`, rok-1374-lifecycle) | instance-private | Minutes derived from private Mbps for a local lineup roster. Not a relay DTO. |
| `game_interests.*` (`game-interests.ts:24-38`) | instance-private, **aggregate-projected at most** | `user_id + game_id + source + playtime_*` is a per-person library/playtime record (PD). The only conceivable projection is an anonymous per-game *count* for a future "communities wanting this" signal — **not** in scope; **OPEN Q6.** |
| `game_interest_suppressions`, `user_preferences` (`show_activity`, `timezone`) | instance-private | |
| `app_settings` (all keys) | instance-private | Credentials + community config. The relay never sees a key. `RELAY_*` are the instance's half of the auth pair. |
| `channel_bindings.*` | instance-private | Discord wiring. |

**Personal-data summary.** Everything in `users`, `game_interests`, `enrichments`, `*_taste_vectors`, `player_*`, `game_activity_*`, `discord_thread_messages`, `lfg_group_messages`, and channel bindings is PD or Discord-scoped. The *only* PD that ever crosses is the ROK-274 public-profile snapshot attached to an opted-in cross-community LFG intent, and it crosses under a relay-minted `relayPlayerId`.

---

## 3. Wire shapes — proposed `packages/contract/src/relay/`

Conventions (apply to every schema below):

- **`schemaVersion`** is a positive integer on every top-level envelope. The relay serves the highest version it supports at or below what the client asks for; a client that receives a higher-than-known version rejects the payload and logs, never guesses.
- **Additive-only rule.** Within a major `schemaVersion`, fields may be **added** (always optional or defaulted on the reader) and never removed, renamed, retyped, or given new semantics. Enum members may be added; readers must treat unknown members as `unknown`, so every relay enum is `z.enum([...]).catch('unknown')` on the *reader* side and strict on the writer side. Breaking changes bump `schemaVersion` and the relay serves both for at least one instance release cycle. Use `.passthrough()` on readers so newer relays don't break older clients.
- Timestamps are ISO-8601 UTC strings; ids the relay mints are ULIDs (sortable, 26 chars) typed as `z.string().length(26)`; external ids keep their native types.
- Files: `relay-envelope.schema.ts`, `relay-game.schema.ts`, `relay-alias.schema.ts`, `relay-coop.schema.ts`, `relay-lfg.schema.ts`, `relay-instance.schema.ts`, barrel `index.ts`.

### 3.1 Envelope + cursor (`relay-envelope.schema.ts`)

```ts
import { z } from 'zod';

export const RELAY_SCHEMA_VERSION = 1 as const;

/** Opaque to the client. Server encodes (updated_at, relayGameId) — never parse it. */
export const RelayCursorSchema = z.string().min(1).max(200);

export const RelayPageSchema = <T extends z.ZodTypeAny>(item: T) =>
    z.object({
        schemaVersion: z.number().int().positive(),
        generatedAt: z.string(),
        /** Present on snapshot + changes pages; absent on the final page. */
        nextCursor: RelayCursorSchema.nullable(),
        /** The cursor to persist once THIS page is applied (== nextCursor of the last page). */
        appliedCursor: RelayCursorSchema,
        items: z.array(item),
    });
```

Example (last page of a delta):

```json
{ "schemaVersion": 1, "generatedAt": "2026-09-05T18:00:00Z",
  "nextCursor": null, "appliedCursor": "MTc1NzA5NjAwMHwwMUpBQzc...", "items": [ ] }
```

### 3.2 Canonical game (`relay-game.schema.ts`)

```ts
export const RelayGameIdSchema = z.string().length(26);            // ULID minted by the relay

export const RelayGameIdentitySchema = z.object({
    relayGameId: RelayGameIdSchema,
    igdbId: z.number().int().positive().nullable(),
    steamAppId: z.number().int().positive().nullable(),
    itadGameId: z.string().nullable(),
    twitchGameId: z.string().nullable(),
    slug: z.string().min(1),
    name: z.string().min(1),
    /** Suggested only; a local non-null short_name wins (OPEN Q3). */
    suggestedShortName: z.string().max(30).nullable(),
});

export const RelayGameEnrichmentSchema = z.object({
    coverUrl: z.string().url().nullable(),
    summary: z.string().nullable(),
    genres: z.array(z.number().int()),
    gameModes: z.array(z.number().int()),
    themes: z.array(z.number().int()),
    platforms: z.array(z.number().int()),
    screenshots: z.array(z.string().url()),
    videos: z.array(z.object({ name: z.string(), videoId: z.string() })),
    firstReleaseDate: z.string().nullable(),
    rating: z.number().nullable(),
    aggregatedRating: z.number().nullable(),
    popularity: z.number().nullable(),
    playerCount: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
    crossplay: z.boolean().nullable(),
    earlyAccess: z.boolean(),
    isFreeToPlay: z.boolean(),
    websiteUrl: z.string().url().nullable(),
    itadBoxartUrl: z.string().url().nullable(),
    itadTags: z.array(z.string()),
    /** Only depot-resolved sizes cross; a manual local size never does. */
    installSizeBytes: z.number().int().nonnegative().nullable(),
    downloadSizeBytes: z.number().int().nonnegative().nullable(),
});

export const RelayGameSchema = z.object({
    identity: RelayGameIdentitySchema,
    enrichment: RelayGameEnrichmentSchema,
    /** Present only when the instance is licensed for job 2 — see relay-coop.schema.ts. */
    coop: z.lazy(() => RelayCoopFactsSchema).nullable().optional(),
    /** Soft-delete: the relay merged this id into `mergedIntoRelayGameId` (alias emitted too). */
    mergedIntoRelayGameId: RelayGameIdSchema.nullable(),
    updatedAt: z.string(),
});
export type RelayGameDto = z.infer<typeof RelayGameSchema>;
```

Example item:

```json
{ "identity": { "relayGameId": "01JAC7Q8Z3N9X5H2B4V6M8K0PD", "igdbId": 119133, "steamAppId": 1086940,
    "itadGameId": "018d937f-...", "twitchGameId": "512882", "slug": "baldurs-gate-3",
    "name": "Baldur's Gate 3", "suggestedShortName": "BG3" },
  "enrichment": { "coverUrl": "https://images.igdb.com/...", "summary": "...", "genres": [12, 24],
    "gameModes": [1, 2, 3], "themes": [17], "platforms": [6], "screenshots": [], "videos": [],
    "firstReleaseDate": "2023-08-03T00:00:00Z", "rating": 92.1, "aggregatedRating": 96,
    "popularity": 88.5, "playerCount": { "min": 1, "max": 4 }, "crossplay": true,
    "earlyAccess": false, "isFreeToPlay": false, "websiteUrl": null, "itadBoxartUrl": null,
    "itadTags": ["RPG"], "installSizeBytes": 150000000000, "downloadSizeBytes": 122000000000 },
  "coop": null, "mergedIntoRelayGameId": null, "updatedAt": "2026-09-05T17:12:44Z" }
```

### 3.3 Co-op facts (`relay-coop.schema.ts`) — licence-gated, see §7

```ts
export const RelayCoopFactsSchema = z.object({
    cooptimusId: z.number().int().positive().nullable(),
    onlineMax: z.number().int().nonnegative().nullable(),
    couchMax: z.number().int().nonnegative().nullable(),
    lanMax: z.number().int().nonnegative().nullable(),
    splitscreen: z.boolean().nullable(),
    dropIn: z.boolean().nullable(),
    campaignCoop: z.boolean().nullable(),
    comboCoop: z.boolean().nullable(),
    /** Attribution linkback — REQUIRED on every consuming surface (ROK-1398 rule). */
    attributionUrl: z.string().url().nullable(),
    /** Relay-side sync time; "synced, no entry" = cooptimusId null AND syncedAt non-null. */
    syncedAt: z.string().nullable(),
});
```

No `extras`, no prose, no user-agent — ever. Example: `{ "cooptimusId": 5231, "onlineMax": 4, "couchMax": 2, "lanMax": 4, "splitscreen": true, "dropIn": true, "campaignCoop": true, "comboCoop": false, "attributionUrl": "https://www.co-optimus.com/game/5231/pc/baldurs-gate-3.html", "syncedAt": "2026-09-01T06:25:00Z" }`

### 3.4 Alias / dedup history (`relay-alias.schema.ts`)

```ts
export const RelayAliasKindSchema = z.enum(['igdb_id', 'steam_app_id', 'itad_game_id', 'slug', 'normalized_name']);

export const RelayGameAliasSchema = z.object({
    kind: RelayAliasKindSchema,
    /** The external key that used to (or still may) identify this game elsewhere. */
    value: z.string(),
    relayGameId: RelayGameIdSchema,
    /** Why it exists: a relay merge, an instance-reported dedup, a corrected id (cf. migration 0156). */
    reason: z.enum(['merge', 'instance_dedup', 'corrected_id']),
    createdAt: z.string(),
});
```

Example: `{ "kind": "steam_app_id", "value": "730", "relayGameId": "01JAC7...7DTD", "reason": "corrected_id", "createdAt": "2026-07-14T00:00:00Z" }` — i.e. "an instance that still maps 7 Days to Die to app 730 should adopt this relay id and expect the canonical steamAppId to differ".

### 3.5 Cross-instance LFG projection (`relay-lfg.schema.ts`) — job 3

```ts
export const RelayPlayerIdSchema = z.string().length(26);          // ULID minted by the relay, per (instance, player)
export const RelayLfgUrgencySchema = z.enum(['week', 'now']);      // mirrors ROK-1479 LfgUrgencySchema

/** ROK-274 public-profile snapshot. Nothing here is a Discord id. */
export const RelayPlayerCardSchema = z.object({
    relayPlayerId: RelayPlayerIdSchema,
    displayName: z.string().min(1).max(30),
    avatarUrl: z.string().url().nullable(),
    /** The community this player belongs to, as the instance chose to name it (app_settings.community_name). */
    communityName: z.string().max(100),
});

export const RelayLfgIntentSchema = z.object({
    relayIntentId: z.string().length(26),
    instanceId: z.string().uuid(),
    relayGameId: RelayGameIdSchema,
    player: RelayPlayerCardSchema,
    urgency: RelayLfgUrgencySchema,
    createdAt: z.string(),
    expiresAt: z.string(),
    /** Set on withdrawal (cleared/converted/expired/deactivated/opt-out). Withdrawn rows are deltas too. */
    withdrawnAt: z.string().nullable(),
});

/** What an instance PUBLISHES (push): its own cross-community intents. */
export const RelayLfgPublishSchema = z.object({
    schemaVersion: z.number().int().positive(),
    intents: z.array(RelayLfgIntentSchema.omit({ relayIntentId: true, instanceId: true, withdrawnAt: true })
        .extend({ localIntentRef: z.string() })),
    withdrawals: z.array(z.object({ localIntentRef: z.string(), reason: z.enum(['cleared', 'converted', 'expired', 'deactivated', 'opt_out']) })),
});
```

Example (one row from `GET /api/v1/lfg/intents?relayGameId=…`): `{ "relayIntentId": "01JAC8...", "instanceId": "7f3c…", "relayGameId": "01JAC7…", "player": { "relayPlayerId": "01JAC9…", "displayName": "Roknua", "avatarUrl": "https://cdn.discordapp.com/avatars/…", "communityName": "Gamer Night" }, "urgency": "now", "createdAt": "…", "expiresAt": "…", "withdrawnAt": null }`

**Note on `avatarUrl`:** a Discord CDN avatar URL embeds the user's Discord id (`/avatars/<discordId>/<hash>`). It therefore leaks exactly what `relayPlayerId` exists to hide. **Default: the relay proxies or the instance re-hosts avatars (`custom_avatar_url` path), and raw Discord CDN URLs are rejected by the schema (`.refine(u => !u.includes('cdn.discordapp.com'))`).** OPEN Q7.

### 3.6 Instance registration / heartbeat (`relay-instance.schema.ts`) — formalises what `relay.service.ts` already sends

```ts
export const RelayOptInsSchema = z.object({
    catalogSync: z.boolean(),      // job 1 — default true once connected
    coopFacts: z.boolean(),        // job 2 — relay refuses `true` until licensed (§7)
    crossCommunityLfg: z.boolean(),// job 3 — default false
});

export const RelayInstanceStatsSchema = z.object({   // == gatherStats() relay.service.ts:275-305
    playerCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    activeGames: z.number().int().nonnegative(),
    uptimeSeconds: z.number().int().nonnegative(),
});

export const RelayRegisterRequestSchema = z.object({
    schemaVersion: z.number().int().positive(),
    instanceId: z.string().uuid(),               // ensureInstanceId() relay.service.ts:163-175
    version: z.string(),                         // APP_VERSION — today a hardcoded '0.0.1' (:19), see §5
    communityName: z.string().max(100).nullable(),
    optIns: RelayOptInsSchema,
}).merge(RelayInstanceStatsSchema);

export const RelayRegisterResponseSchema = z.object({  // == RelayRegistrationResponse relay.service.ts:34-37
    token: z.string(),
    instanceId: z.string().uuid(),
    schemaVersion: z.number().int().positive(),
    /** Which opt-ins the relay actually granted (coopFacts may come back false). */
    grantedOptIns: RelayOptInsSchema,
});

export const RelayHeartbeatRequestSchema = RelayRegisterRequestSchema.omit({ instanceId: true }).extend({
    catalogCursor: RelayCursorSchema.nullable(),
});
```

---

## 4. Sync protocol sketch

### 4.1 Shape: pull-based, instance-initiated, snapshot then cursor deltas

```
instance                                   relay
   │  POST /api/v1/instances/register ───────▶│  mint token, record opt-ins
   │◀── { token, grantedOptIns } ─────────────│
   │  GET /api/v1/catalog/snapshot?schemaVersion=1&cursor=…   (paged, 500 items/page)
   │◀── RelayPage<RelayGame> … until nextCursor=null
   │  GET /api/v1/catalog/aliases?since=…     (same paging)
   │  persist appliedCursor → app_settings.RELAY_CATALOG_CURSOR
   │  … every 6h (same cadence as IGDB sync, igdb.service.ts:104) …
   │  GET /api/v1/catalog/changes?since=<cursor>  ──▶ items whose updated_at > cursor, incl. merges
   │  POST /api/v1/instances/:id/heartbeat { …, catalogCursor }   (hourly, already exists :139)
```

- The relay never calls the instance. Instances are behind NATs (Synology NAS in prod) and the existing heartbeat direction is already outbound-only. This is also what makes "relay down" trivially safe (§4.6).
- **Snapshot** = the changes feed from cursor `''`. One code path; snapshot is not special.
- **Cursor** is opaque, server-encoded `(updated_at, relayGameId)` so a page boundary inside one timestamp cannot skip rows. Persisted only after the page's writes commit.
- **Idempotent apply.** Every item upserts by `relayGameId`; re-applying a page is a no-op. Interrupted sync just re-runs from the last persisted cursor.

### 4.2 Local mapping column — one migration

`games.relay_game_id text UNIQUE NULL` (+ index). Local `games.id` stays the FK target for the whole instance; nothing downstream changes. A row with `relay_game_id IS NULL` is "local-only, not yet reconciled" — exactly today's state for every row.

### 4.3 Identity-collision rule (grounded in 0156 + the name lock)

Applied per incoming `RelayGame`, **inside `withGameNameLock(db, name, tx => …)`** (`api/src/igdb/games-name-lock.helpers.ts:88-104`) because the apply path is a find-then-maybe-insert into `games` — it is a new games INSERT path and must be appended to memory `reference_games_insert_paths` when built.

1. **Already mapped** (`relay_game_id` matches): UPDATE canonical columns only. Never touch an instance-private column. Skip canonical columns the admin has overridden (§4.4 override ledger).
2. **Match by external key, in this order:** `igdb_id` → `steam_app_id` → `itad_game_id` → `slug` → `findGameByNormalizedName` (`igdb-name-dedup.helpers.ts:58`). First hit wins; set `relay_game_id`, then step 1.
3. **Divergent external id** (local row matched on `igdb_id` but its `steam_app_id` ≠ relay's — the 7 Days to Die / app 730 case): the relay value wins **only if no other local row holds it** — the same `NOT EXISTS` guard migration 0156 uses (`0156_fix_bad_steam_app_ids.sql:30-32`). If another local row does hold it, that is a local dup group: write nothing, record `relay_sync_conflicts(relay_game_id, local_game_id, kind, relay_value, local_value)` for the admin dedup tool (ROK-1270's audit UI is the natural home) and keep going. **Never** resolve dups automatically from a sync — 0140/0156 show how many FKs hang off a games row.
4. **Alias match** (an incoming `RelayGameAlias` names an external key a local row carries): treat as step 2 with the alias's `relayGameId`; if that relay id is already mapped to a *different* local row, it is again a local dup → conflict row, no write.
5. **No match:** INSERT (canonical columns + `relay_game_id`; private columns at their defaults, `enabled` per **OPEN Q5**). Precheck the unique keys and issue one statement that cannot violate — no catch-and-retry inside the transaction (memory `reference_postgres_savepoint_does_not_contain_violations`).
6. **`mergedIntoRelayGameId` set:** if the loser is mapped locally, do **not** delete it. Mark it `relay_merged_into = <winner relay id>` and surface it in the dedup audit. Collapsing local FKs is the admin's call (ROK-1270 tooling), not the sync's.

Success callbacks (`onGameChanged` taste recompute etc.) fire after `withGameNameLock` returns, never inside.

### 4.4 Overrides and contributions (instance → relay)

- **Override ledger.** `game_field_overrides(game_id, column, overridden_at)` — written whenever an admin edits a canonical column locally. Step 1 skips those columns. Without this, the next sync silently reverts every admin correction; with it, the admin's edit is both preserved and visible as "diverges from relay".
- **Contributions (slice 2, not slice 1).** When an instance adds a game the relay lacks (IGDB search-and-add, Steam discovery, `lookup-by-name`), it POSTs `RelayGameIdentity` + enrichment to `/api/v1/catalog/contributions`. The relay is the arbiter: it dedups against its own catalogue (same rule as §4.3 but relay-side), mints or returns the `relayGameId`, and the instance sets its mapping. Contributions carry **no** instance-private column and no user data. **OPEN Q8** (trust model for contributions).

### 4.5 Rate and size expectations

Reasoning from known scale — there is no fleet yet:

- Prod library today: **~165 rows** (memory `project_rok_275_cooptimus_decision_pending`: "~165 games", 161 live Co-Optimus records). The demo template seeds a similar order of magnitude (`demo-data-install-lineups.helpers.ts:196` only asserts `>= 9`; **UNVERIFIED** exact count).
- Per-item payload: identity + enrichment ≈ 1–2 KB without media, **3–8 KB with `screenshots`/`videos`/`summary`**. Recommendation: serve media arrays only on `?include=media` and default them off for the changes feed; 5 KB × 165 ≈ 0.8 MB for today's whole catalogue.
- A relay catalogue that unions 20 instances' libraries is realistically **2–10k games** (long tail overlaps heavily): 10k × 5 KB ≈ **50 MB uncompressed snapshot, ~8 MB gzipped**, paged at 500 → 20 requests. First-sync budget: under a minute on a NAS.
- Deltas: enrichment churn is rare (ratings, covers, the odd merge); expect **tens of items per 6-hour delta**, i.e. a few KB. The 6-hourly cadence is chosen to match `IgdbService_handleScheduledSync`, not because the data needs it.
- Relay-side: N instances × 4 pulls/day × 20 pages worst-case is nothing; the heartbeat (hourly, already exists) is the real steady-state load and is one row per instance.
- LFG (job 3): intents are tiny (< 1 KB) and short-lived; a push per write plus a pull per group-page view at 20 s polling is the pattern to size later.

### 4.6 Relay-down behaviour

- **Catalogue reads never depend on the relay.** The instance serves from its own `games` table; the relay only ever *fills* it. A relay outage means "no new enrichment until it returns" — same failure mode as IGDB being down today.
- Sync cron: on any non-2xx / timeout, log at debug (matching `relay.service.ts:196`), keep the cursor, exponential backoff capped at the cron interval, surface `error` on `RelayStatus` (`relay.service.ts:21-27`) so the admin page shows it. No retries inside a request.
- **Local sources stay a fallback, not a replacement.** If an instance has its own IGDB/ITAD/Steam keys configured, its crons keep running; the relay sync simply overwrites canonical columns with relay values when they differ (relay wins on canonical, ledger-protected overrides excepted). An instance with no keys and no relay has exactly today's "unconfigured" experience.
- Co-Optimus (job 2): relay-down = facts go stale; `cooptimus_synced_at` semantics unchanged; nothing falls back to scraping, because the instance has no UA.
- LFG (job 3): cross-community rows are best-effort. A failed publish is retried by the next sweep; the relay expires intents by `expiresAt` on its own, so a dead instance's intents die with them (default TTL = 14 days / 30–60 min for `now`).

---

## 5. Registration + auth

**Reuse ROK-274's shape** — which in practice is the ROK-273 shape already in `relay.service.ts`:

| Step | Today (`relay.service.ts`) | Proposed change |
|------|----------------------------|-----------------|
| Instance id | `ensureInstanceId()` mints a UUID and stores `RELAY_INSTANCE_ID` (`:163-175`) | Keep. |
| Register | `POST /api/v1/instances/register` with `{ instanceId, version, ...stats }`, **no auth**, response `{ token, instanceId }` stored as `RELAY_TOKEN` (`:177-226`) | Add `schemaVersion`, `communityName`, `optIns`; response adds `grantedOptIns`, `schemaVersion`. Open registration stays (anyone can run an instance) — abuse is bounded because a fresh instance gets read-only catalogue access and nothing else. |
| Token | Opaque bearer, `Authorization: Bearer …` (`relay.helpers.ts:29-34`), encrypted at rest via `app_settings` | Keep. Relay stores a **hash** of the token, never the token. Rotation: `POST /instances/:id/rotate` returns a new token; old one valid for 1 h. |
| Heartbeat | Hourly `POST /instances/:id/heartbeat { version, ...stats }` (`:139-148, :250-273`) | Add `optIns` + `catalogCursor` so the relay dashboard can show sync lag. |
| Version | `APP_VERSION = '0.0.1'` hardcoded (`:19`) | **Bug to fix in slice 1:** read the baked-in `APP_VERSION` env (PR #1089/#1090 established it) so the relay can gate schema versions per instance. |
| Disconnect | `DELETE /instances/:id` + local token wipe (`:104-110, :229-247`) | Keep; relay marks the instance `disconnected`, withdraws its LFG intents, keeps its contributions. |

**What the relay stores per instance:** `instance_id`, `token_hash`, `app_version`, `schema_version`, `community_name`, `opt_ins{catalogSync, coopFacts, crossCommunityLfg}`, `licence_flags{cooptimus}` (relay-admin-set, §7), `last_heartbeat_at`, last `stats`, `catalog_cursor`, `registered_at`, `disconnected_at`. **Nothing about individual users** except, under job 3, the `relayPlayerId ↔ (instanceId, opaque local ref)` pairs it minted — and it stores the instance's local ref *hashed with the token*, so a relay DB leak does not map back to local user ids.

**Player identity (job 3).** `relayPlayerId` is minted by the relay on the player's first opt-in publish and stored on the instance in `users.relay_player_id` (nullable, unique). It is never derived from `discord_id` or `users.id`; revoking opt-in deletes the pair on both sides. Two instances that both know the same human (same person in two guilds) get two different ids — by design; linking them is a future ROK-274 decision, **OPEN Q9**.

**Authorisation surface on the relay:** catalogue reads need only a valid token; contributions need `catalogSync`; `coop` fields are included only when `licence_flags.cooptimus` is set for that instance; LFG endpoints need `crossCommunityLfg` on both the reading and the publishing instance.

---

## 6. Opt-in semantics per job

| Job | Level | Default | Who flips it | Effect of OFF |
|-----|-------|---------|--------------|---------------|
| 1 Game-data sync | Instance (`RELAY_OPTIN_CATALOG`, admin → Relay page) | **ON** once connected (brief) | Instance admin | No pulls, no contributions; local crons unaffected. Already-adopted `relay_game_id` mappings stay (harmless). |
| 2 Co-Optimus facts | Instance (`RELAY_OPTIN_COOP`) **AND** relay-side licence flag | OFF; relay refuses `true` until §7 is settled | Instance admin requests; **relay admin grants** per the licence terms | `coop` omitted from every item; local `cooptimus_*` columns untouched (an instance with its own UA — today only prod — keeps its own sync). |
| 3 Cross-instance LFG | Instance (`RELAY_OPTIN_LFG`) **AND** per-player (`users.cross_community_visible`, ROK-274) **AND** per-intent (`lfg_intents.visibility='cross-community'`) | **OFF** at all three levels | Admin, then each player, then per intent | Instance OFF: nothing published, nothing read, existing published intents withdrawn. Player OFF: their intents withdrawn, `relay_player_id` pair deleted. Deactivation/kick/ban ⇒ forced player OFF. |

Rules that fall out:

- A player cannot opt in before the instance has; the UI never shows the per-player switch when `RELAY_OPTIN_LFG` is off (avoids a consent that does nothing).
- Turning an instance switch OFF is a *withdrawal event*, not a config change — it must reach the relay (best-effort immediately, guaranteed on next heartbeat via `optIns`).
- The per-intent `visibility` default stays `'local'` (`lfg-intents.ts:39`) even when both switches are on: cross-community is a per-post choice, matching the LFG design's "quiet by default" posture.
- Attribution for job 2 is not optional: an instance that receives `coop` **must** render the ROK-1398 credit + linkback on the game detail page (the existing fail-loudly test covers the surface; the relay contract carries `attributionUrl` so the link is never fabricated).

---

## 7. Co-Optimus — the licence

### 7.1 What was granted (exact scope, from the record)

From memory `project_rok_275_cooptimus_decision_pending` (Gmail thread `19f61d743dcccb1a`, operator ↔ Nick Puleo, 2026-07-14 → 2026-08-22):

> **Scope of the grant:** one instance, non-commercial, invite-only, "nothing is redistributed", ~165-game pass + weekly refresh at ~1 req/sec. Multi-instance distribution is OUTSIDE this grant and requires renegotiating with Nick BEFORE any implementation — deferred to ROK-1420 / the ROK-274 relay hub. Do not design around the permission question.

Mechanically the grant is a **UA-keyed Cloudflare exemption** — `RaidLedger (+https://github.com/sjdodge123/Raid-Ledger)` — verified 2026-08-22 (200 with the UA, 403 challenge without; `vary: User-Agent`). Two further facts on the record that bear on redistribution:

- The site publishes **no terms**; the only machine-readable policy is robots.txt content signals `search=yes, ai-train=no, use=reference` (`docs/spikes/rok-275-co-optimus-spike.md:41-50`). "Reference use" for *our* enrichment is what the spike relied on; it says nothing about onward distribution.
- The actual footprint already grew past what was described: one API call **plus one page fetch** per game (~330 requests vs the ~165 described) — memory flags this as something to tell Nick. Editorial prose is held behind `COOPTIMUS_PROSE_ENABLED` default OFF pending confirmation the grant covers prose reuse.

### 7.2 What redistribution through a relay would require — **OPEN, all of it**

The relay is, by construction, redistribution: one scraper feeding N deployments. Every item below is outside the recorded grant and needs Nick's explicit agreement *before* the first `coop` byte crosses:

1. **Permission to redistribute the derived facts** (the numeric counts + booleans + `url`) from one scraping deployment to other Raid Ledger instances. Ask for it in those words; do not describe it as "caching".
2. **Which deployment is "the one instance".** The grant names one instance; the relay hub is a different deployment from `raid.gamernight.net`. Either the exemption moves to the relay (and prod becomes a consumer) or Nick agrees the relay is the licensed scraper. **UNVERIFIED** that the UA rule is per-deployment rather than per-UA-string; either way, only one deployment should hold the UA.
3. **Scale and identity of consumers.** "Invite-only, non-commercial" was the basis. State the expected instance count (§4.5: tens, not thousands), that every consumer is a self-hosted non-commercial community, and that the relay will not serve the facts to anything but registered Raid Ledger instances. Offer a cap if he wants one.
4. **Attribution on every consuming instance**, not only on the scraping one — the ROK-1398 credit + linkback rule becomes a contract obligation (`attributionUrl` in §3.3 exists for this).
5. **Footprint disclosure**: the ~330-request weekly pass (already owed), plus the statement that redistribution *reduces* his load — N instances no longer each ask.
6. **Prose stays out** regardless of the answer to 1–5 (`cooptimus_extras` is permanently instance-private in §2.2). Ask about prose separately, or not at all.
7. **Revocation path**: if he withdraws, the relay stops serving `coop` and consumers keep stale facts until they expire — propose a TTL (default 90 days) after which consuming instances null the fields. This is the "what happens when the UA is revoked" story extended to N instances.

### 7.3 Recommendation

**Default (recommended): the relay distributes Co-Optimus fields ONLY after renegotiation. Until then every `cooptimus_*` column is `instance-private`,** the `coop` field is absent from `RelayGame`, the relay's `licence_flags.cooptimus` is unset for every instance, and the relay itself does not scrape. Slice 1 (§10) ships with `RelayCoopFactsSchema` *defined* in the contract and *never populated* — so the shape is agreed and the licence question is visibly the only blocker.

Corollaries that hold regardless of the answer: the UA is never in the repo, never in the contract, never in a relay payload (existing STRICT rule); if a consuming surface ever renders a co-op badge without a link to the detail page's attribution, that surface needs its own credit (ROK-1447 rule).

---

## 8. The rule for new DTOs

Ready to paste into `project-context.md` under "Critical Don't-Miss Rules":

> **Relay classification (STRICT).** Every new table, column, and contract DTO is classified in its spec as `relay-canonical` (the relay is the source of truth and instances adopt it), `relay-projected` (instance-owned; a defined, reduced projection may cross under an opt-in), or `instance-private` (never crosses — the default, and mandatory for anything carrying a Discord id, a display name, message content, a measurement about a person, credentials, or local admin configuration). A `relay-projected` shape gets its projection DTO defined **in the same story** under `packages/contract/src/relay/` — never "later". Classification is a design decision, not a comment: reviewers reject a spec whose Contract section has no `Relay:` line. Spike: `docs/spikes/relay-data-contract.md`.

Checklist line for `planning-artifacts/specs/ROK-XXXX.md` templates (and the `/rl-spec` / `fleet-spec-lane` skills):

```
- [ ] Relay: every new table/column/DTO carries `relay-canonical | relay-projected | instance-private` + one-line why; `relay-projected` ⇒ projection schema in `packages/contract/src/relay/` in this story.
```

---

## 9. Retro-classification of this cycle's shapes

| Story | Shape | Bucket | Why |
|-------|-------|--------|-----|
| ROK-1451 | `lfg_intents` (row) | instance-private with a **relay-projected subset** | Only `visibility='cross-community'` rows project, as `RelayLfgIntent` (§3.5): `relayGameId`, `relayPlayerId`, `urgency`, `createdAt`, `expiresAt`. `user_id`, `converted_to_*`, local ids never cross. The seam was designed correctly; the projection just did not exist yet. |
| ROK-1451/1453 | `LfgGroupSummary`, `LfgIntentResponse`, chips/banners | instance-private | Local counts and local-viewer flags (`hasOwnIntent`). Cross-instance counts would be a *new* read DTO on the relay, not a projection of these. |
| ROK-1463/1464 | `LfgGroupDetail`/`LfgMember`, `LfgOverlapResponse`, `LfgHistoryResponse`, `LfgSuggestions` | **instance-private** | Members carry `username/displayName/avatarUrl`; overlap is derived from private availability; history is attendance; suggestions are `played/owns/hearted` — all PD. |
| ROK-1471 | `lfg_group_messages.thread_id/post_kind`, `channel_bindings(lfg-board)`, `LFG_BOARD_*` settings, invite info DTOs | instance-private | Discord snowflakes and guild wiring. A cross-instance "join their thread" needs an invite handoff design (OPEN Q10), not these columns. |
| ROK-1374 | `users.connection_downstream_mbps/_source/_measured_at`, `speed_test_consent_at`, `share_download_eta_at` (rok-1374-lifecycle) | **instance-private (STRICT)** | Branch comment: never returned for another user. The share flag scopes to local rosters only. |
| ROK-1374 | `RosterEtaSchema` / `rosterEtas`, `SetDownloadEtaSharingSchema`, `shareEta` | instance-private | Derived minutes are still a fact about a person's connection; consent was given to a roster on *this* instance. Not a relay DTO; not even a projection candidate. |
| ROK-1479 (spec'd) | `lfg_intents.urgency` (`'week'|'now'`), `ttlMinutes` on create, `nowCount`/`soonestNowExpiresAt` on summary | `urgency` = relay-projected (inside the intent projection, gated by `visibility`); `ttlMinutes` = not stored, not projected; `nowCount` = instance-private (derived) | A cross-community "now" wave is the most valuable thing job 3 can match on; it costs one enum in `RelayLfgIntentSchema`, already included. The spec should add a `Relay:` line saying so. |
| ROK-1483 (spec'd) | `discord_thread_messages` + `ThreadMessageDto` + `ThreadedChatViewer` | **instance-private, permanently** | Message bodies + author ids + avatar hashes of guild members. The spec's own D3 makes the read community-wide *within* the instance; nothing in it contemplates leaving the instance, and nothing should. Add `Relay: instance-private (message content)` to the spec. |
| ROK-1446 | `discord_channel_presence_messages` | instance-private | Voice-channel presence embeds; guild-local. |

Two retro-findings worth a line in the ROK-1479 and ROK-1483 specs before they build: (a) 1479's `LfgLfmReachedPayload.urgency` is an internal event — fine — but `urgency` must also be in the write path that publishes cross-community intents when ROK-274 lands, so keep it on the row, not derived (the spec's D1 already concludes this for other reasons); (b) 1483's `author_avatar_hash` + `author_discord_id` are exactly the pair that reconstructs a Discord CDN URL — the same leak noted in §3.5 — so the mirror table must never grow a projection.

---

## 10. Sequencing

### 10.1 The relay epic and its slices

| Slice | Backlog item(s) | Content | Depends on | Size (honest) |
|-------|-----------------|---------|------------|---------------|
| **0** | ROK-1485 (this) | Contract decision + rule in `project-context.md` + spec checklist line | — | done |
| **1 — first buildable** | new (ROK-1485-1) | `packages/contract/src/relay/*` (§3.1, 3.2, 3.4, 3.6; 3.3 defined-but-unpopulated); migration `games.relay_game_id` + `game_field_overrides` + `relay_sync_conflicts`; `RelayCatalogSyncService` (6-hourly pull, §4.1–4.3, 4.6); `APP_VERSION` fix (§5); admin Relay page gains catalogue opt-in + last-sync/lag. **Read-only, no contributions, no LFG, no Co-Optimus.** Plus the relay-side catalogue service — **OPEN Q1: where does the relay code live?** | ROK-273 (shipped) | Instance side: **M** (contract S, migration S + `validate-migrations`, sync service + collision rule + tests M — the collision rule is the risk). Relay side: **M–L** as a new NestJS service with its own DB; **L** if it also needs its own IGDB/ITAD crons on day one (it does, to be useful). Realistic: 2 stories instance-side, 2–3 relay-side. |
| **2** | new (ROK-1485-2) | Contributions push (§4.4) + alias emission from `games_dedup_audit`; relay-side arbiter; `reference_games_insert_paths` append | 1 | **M**. The arbiter is §4.3 run relay-side; most code is shared with slice 1. |
| **3** | **ROK-304** (hub + feedback) | Relay dashboard (instances, versions, sync lag, feedback inbox); `submitFeedback` client already exists (`relay.service.ts:113-136`) — the server half does not | 1 | **S–M** relay-side only. Can run in parallel with 2. |
| **4** | **ROK-1420** (Co-Optimus via relay) | Move the scraper to the relay; populate §3.3; `licence_flags`; consumer-side attribution guard; 90-day revocation TTL | 1 + **renegotiation (§7.2)** | Code **S–M** (the sync exists; it moves). Calendar: unknowable — gated on a human reply. Do not schedule until the email is answered. |
| **5** | **ROK-274** (public profile + player endpoints + opt-in) | `users.cross_community_visible`, `users.relay_player_id`, public-profile projection (`RelayPlayerCard`), avatar re-hosting (Q7), withdrawal on deactivate/kick/ban, admin `RELAY_OPTIN_LFG` | 1 | **M–L**. The consent + withdrawal edges are the bulk; each of deactivate/kick/ban/opt-out must be provably withdrawn. |
| **6** | new (ROK-1485-3, cross-instance LFG) | Publish/withdraw of `visibility='cross-community'` intents; relay LFG read; group page "also looking elsewhere" section; the contact handoff (Q10) | 5, ROK-1479 | **L**. The handoff (how two strangers in different guilds actually meet) is undesigned and is the real product work. |
| later | `discord_game_mappings`, ITAD deals feed, interest aggregates | Optional projections (§2.3, Q4, Q6) | 2 | S each, only on demand |

### 10.2 Why slice 1 is "canonical identity + enrichment pull, read-only"

- It is the operator's stated first value ("reduces setup time") and needs no human outside the project.
- It exercises the hardest instance-side code — the collision rule — against real data before any *write* path exists to make mistakes permanent.
- It forces the two decisions everything else needs: `relay_game_id` mapping and schema versioning.
- It is independently valuable even if 2–6 never ship: a second deployer (ROK-1476's audience) gets a populated catalogue with zero API keys.

### 10.3 Ordering rule for the rest of Cycle 19

ROK-1479 and ROK-1483 proceed **after** the rule in §8 is pasted and their specs gain a `Relay:` line (both are one-line additions; §9 gives the text). Neither is blocked on slice 1. ROK-1374's `rosterEtas` needs no change — it is correctly private.

---

## 11. Open questions for the operator

Each with the default this doc assumes.

1. **Where does the relay live?** Default: a new top-level workspace `relay/` in this monorepo (shares `packages/contract`, same NestJS/Drizzle stack, CI-tested with the same gates), deployed as its own container. Alternative: separate repo — costs contract publishing.
2. **Does `hub.raid-ledger.com` exist / who hosts the relay?** Default: nothing runs there today (UNVERIFIED); host on the operator's Proxmox VM alongside rl-infra until there is a second consumer. Hosting is explicitly out of scope, but slice 1's "done" needs *an* address.
3. **`short_name`: suggestion or canonical?** Default: suggestion (local non-null wins).
4. **ITAD prices through the relay?** Default: no (deferred). Prices are volatile, region-dependent, and free per instance.
5. **Relay-inserted games: `enabled` default?** Default: `enabled = true, hidden = false` like IGDB-added games today — but **only** for games the instance requested (slice 1 pulls the *whole* catalogue, so default `hidden = true` for bulk-pulled rows the community never touched; flip on first local use). This needs a product call because it changes what the games page shows on a fresh install.
6. **Any aggregate of `game_interests` (per-game "N communities want this")?** Default: no. PD-adjacent even as counts on small communities.
7. **Avatars in the LFG projection.** Default: re-host/proxy; reject raw Discord CDN URLs in the schema.
8. **Contribution trust model.** Default: any registered instance may contribute identity+enrichment; the relay dedups and records `contributedBy`; a relay admin can quarantine an instance. No moderation queue in slice 2.
9. **One human in two guilds = two `relayPlayerId`s?** Default: yes, unlinked. Linking is a later ROK-274 decision with its own consent.
10. **Cross-instance LFG contact handoff.** Default: undesigned — slice 6 starts with a design spike. The candidate is a relay-brokered one-time Discord invite (the PUG invite relay DM pattern in `pug-invite.helpers.ts:219-225` is the closest prior art), but nothing here commits to it.
11. **Co-Optimus renegotiation — who sends the email and when?** Default: operator, before slice 4 is scheduled, using §7.2 as the ask. Include the ~330-request footprint correction that is already owed.
12. **Schema-version support window.** Default: the relay serves the current and previous `schemaVersion`; an instance more than one major behind gets `426 Upgrade Required` and a clear admin-page message.

---

## 12. Handover

**State:** complete first pass of all twelve sections; every anchor grepped on `988cb226` (unmerged shapes cited by branch: `rok-1374-lifecycle` @ `c5670345`, `rok-1471`, and the ROK-1479/1483 specs in `planning-artifacts/specs/`).

**Verified in the repo:** the ROK-273 relay client is real and reusable (register/heartbeat/feedback/disconnect, token in `app_settings`); `APP_VERSION` is hardcoded `'0.0.1'` in `relay.service.ts:19` (slice 1 fix); the `visibility` seam exists in schema, contract and constants; `games` has 60 columns and the split in §2.2 is column-exact; the name lock + 0156 `NOT EXISTS` guard are the two precedents the collision rule is built from; ROK-1374's speed columns carry a privacy comment that makes their bucket unambiguous.

**Flagged, not guessed:** Co-Optimus redistribution (§7 — outside the recorded grant; default is do-not-ship); whether `hub.raid-ledger.com` answers (Q2); the ROK-274 body (treated as the brief summarises it); exact demo-template game count; avatar URLs leaking Discord ids (§3.5, Q7).

**Not reached:** no wire-level schema for the relay's *own* admin API (ROK-304 dashboard); no size measurement against a real `games` dump (reasoned from ~165 rows); no design for the LFG contact handoff (Q10 — deliberately left as a spike).

**Next:** operator answers Q1/Q2/Q5 → file ROK-1485-1 (slice 1) with §3.1/3.2/3.4/3.6 pasted as the contract section and §4.3 as the collision-rule ACs; paste §8 into `project-context.md`; add the `Relay:` line to the ROK-1479 and ROK-1483 specs.
