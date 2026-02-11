# Plugin Architecture Discovery & Codebase Audit

> **ROK-264** | Generated: 2026-02-11
> Blocks: ROK-236, ROK-237, ROK-238, ROK-239

---

## Table of Contents

1. [Backend Import Map](#1-backend-import-map)
2. [Frontend Dependency Graph](#2-frontend-dependency-graph)
3. [Database Schema Audit](#3-database-schema-audit)
4. [Contract Schema Split Plan](#4-contract-schema-split-plan)
5. [Extension Point Validation](#5-extension-point-validation)
6. [Data Lifecycle & Edge Cases](#6-data-lifecycle--edge-cases)
7. [Build & Package Structure](#7-build--package-structure)

---

## 1. Backend Import Map

### NestJS Module Dependency Graph

```
AppModule
  +-- ConfigModule.forRoot()
  +-- EventEmitterModule.forRoot()
  +-- ScheduleModule.forRoot()
  +-- DrizzleModule
  +-- RedisModule
  +-- UsersModule
  +-- AuthModule
  +-- AdminModule
  |     +-- SettingsModule
  |     +-- AuthModule
  |     +-- IgdbModule
  +-- IgdbModule
  +-- EventsModule
  |     +-- AvailabilityModule
  |     +-- NotificationModule
  +-- GameRegistryModule
  +-- CharactersModule              <-- ONLY entry point for Blizzard
  |     +-- DrizzleModule
  |     +-- BlizzardModule          <-- WOW-SPECIFIC
  |           +-- SettingsModule
  +-- AvailabilityModule
  +-- SystemModule
  +-- SettingsModule
  +-- NotificationModule
```

**Key observation:** `BlizzardModule` enters the app only through `CharactersModule`. It is NOT in `AppModule.imports`. EventsModule, AdminModule, and NotificationModule have zero Blizzard dependency.

### BlizzardService Consumer Chain

```
BlizzardModule
  exports: [BlizzardService]
  consumed by: CharactersModule -> CharactersService (DI injection)
```

### Classification Summary

| File | Classification | WoW-Specific Content |
|------|---------------|---------------------|
| `api/src/blizzard/blizzard.service.ts` | **MOVE** | Entire file (1,361 lines): OAuth, API calls, spec maps, instance data, level ranges |
| `api/src/blizzard/blizzard.controller.ts` | **MOVE** | Entire file (161 lines): 4 `/blizzard/*` routes |
| `api/src/blizzard/blizzard.module.ts` | **MOVE** | Entire file (12 lines) |
| `api/src/characters/character-sync.service.ts` | **MOVE** | Entire file (37 lines): `@Cron` + `syncAllBlizzardCharacters()` |
| `api/src/characters/characters.service.ts` | **REFACTOR** | 3 methods (~275 lines): `importFromBlizzard()`, `refreshFromBlizzard()`, `syncAllBlizzardCharacters()` + BlizzardService DI |
| `api/src/characters/characters.controller.ts` | **REFACTOR** | 2 routes: `POST import/wow`, `POST :id/refresh` |
| `api/src/characters/characters.module.ts` | **REFACTOR** | `BlizzardModule` import + `CharacterSyncService` provider |
| `api/src/settings/settings.service.ts` | **REFACTOR** | `BlizzardConfig` interface + 3 methods: `getBlizzardConfig()`, `setBlizzardConfig()`, `isBlizzardConfigured()` |
| `api/src/admin/settings.controller.ts` | **REFACTOR** | 4 Blizzard endpoints (~116 lines): get/update/test/clear Blizzard config |
| `api/src/admin/demo-data.constants.ts` | **REFACTOR** | `wowClass` fields on character configs, `getClassIconUrl()`, WoW-themed event titles |
| `api/src/admin/demo-data.service.ts` | **REFACTOR** | `getClassIconUrl()` call for demo avatars |
| `api/src/drizzle/schema/characters.ts` | **REFACTOR** | WoW-specific comments on `region`, `gameVariant`, `equipment` columns |
| `api/src/drizzle/schema/app-settings.ts` | **REFACTOR** | `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET` hardcoded in `SETTING_KEYS` |
| `api/src/events/events.service.ts` | **KEEP+INTERFACE** | Stores/retrieves `contentInstances` as opaque JSONB -- typing constraint is contract-only |
| `api/src/drizzle/schema/events.ts` | **KEEP+INTERFACE** | `contentInstances` column comment is WoW-specific, column itself is generic JSONB |
| `api/src/events/signups.service.ts` | **KEEP** | Line 406 casts faction as string -- structurally generic |
| `api/src/events/events.module.ts` | **KEEP** | No Blizzard dependency |
| `api/src/notifications/*` | **KEEP** | Zero game-specific logic |
| `api/src/app.module.ts` | **KEEP** | No direct BlizzardModule import |
| `api/seeds/games-seed.json` | **KEEP** | WoW entries are catalog data (2 of 36 games), not code coupling |

**Totals: 4 MOVE, 9 REFACTOR, 2 KEEP+INTERFACE, 14+ KEEP**

### Cron Jobs

| File | Schedule | WoW-Specific? |
|------|----------|---------------|
| `characters/character-sync.service.ts` | `0 0 3,15 * * *` (03:00/15:00 UTC) | **YES** -- syncs Blizzard characters |
| `notifications/event-reminder.service.ts` | `0 */15 * * * *` (every 15 min) | No |
| `notifications/event-reminder.service.ts` | `0 */5 * * * *` (every 5 min) | No |
| `igdb/igdb.service.ts` | `EVERY_6_HOURS` | No |

### Settings/Config Coupling

```
Admin UI -> SettingsService.setBlizzardConfig()
  -> Emits SETTINGS_EVENTS.BLIZZARD_UPDATED
  -> BlizzardService.handleBlizzardConfigUpdate() (@OnEvent listener)
  -> Clears cached OAuth token
```

Blizzard-specific keys in `SETTING_KEYS`: `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`

---

## 2. Frontend Dependency Graph

### Import Dependency Tree

```
use-wow-instances.ts (MOVE)
  <- api-client.ts [fetchWowInstances, fetchWowInstanceDetail]
  -> create-event-form.tsx

use-wow-realms.ts (MOVE)
  <- api-client.ts [fetchWowRealms, previewWowCharacter]
  -> realm-autocomplete.tsx -> wow-armory-import-form.tsx

use-wowhead-tooltips.ts (MOVE)
  -> character-detail-page.tsx

wow-armory-import-form.tsx (MOVE)
  <- use-character-mutations.ts [useImportWowCharacter]
  <- api-client.ts [previewWowCharacter]
  <- realm-autocomplete.tsx
  -> AddCharacterModal.tsx, inline-character-form.tsx

item-detail-modal.tsx (MOVE)
  -> character-detail-page.tsx

item-fallback-tooltip.tsx (MOVE)
  -> character-detail-page.tsx
```

### Classification Summary

| File | Classification | WoW-Specific Content |
|------|---------------|---------------------|
| `hooks/use-wow-instances.ts` | **MOVE** | Entire file |
| `hooks/use-wow-realms.ts` | **MOVE** | Entire file |
| `hooks/use-wowhead-tooltips.ts` | **MOVE** | Entire file |
| `components/characters/wow-armory-import-form.tsx` | **MOVE** | Entire file |
| `components/characters/realm-autocomplete.tsx` | **MOVE** | Entire file |
| `components/characters/item-detail-modal.tsx` | **MOVE** | Entire file |
| `components/characters/item-fallback-tooltip.tsx` | **MOVE** | Entire file |
| `pages/character-detail-page.tsx` | **REFACTOR** | Equipment grid, Wowhead integration, quality colors, slot layouts, faction styles, Armory refresh (~80% of file) |
| `components/events/create-event-form.tsx` | **REFACTOR** | `getWowVariant()`, `getContentType()`, instance browser, selectedInstances state, content UI |
| `pages/event-detail-page.tsx` | **REFACTOR** | `WowInstanceDetailDto` cast, level warning logic, `isClassicGame` check |
| `pages/admin-settings-page.tsx` | **REFACTOR** | Blizzard API IntegrationCard (~113 lines) |
| `components/profile/AddCharacterModal.tsx` | **REFACTOR** | WoW detection, import tab, variant selector |
| `components/profile/CharacterCard.tsx` | **REFACTOR** | Faction badge, Armory refresh, Armory link |
| `components/characters/character-card-compact.tsx` | **REFACTOR** | Faction badge, level/itemLevel display |
| `components/characters/inline-character-form.tsx` | **REFACTOR** | Import tab toggle + WowArmoryImportForm |
| `components/events/signup-confirmation-modal.tsx` | **REFACTOR** | `isWow` detection, `showArmoryImport` |
| `pages/user-profile-page.tsx` | **REFACTOR** | Faction styles (minor) |
| `hooks/use-character-mutations.ts` | **REFACTOR** | `useImportWowCharacter`, `useRefreshCharacterFromArmory` |
| `hooks/use-admin-settings.ts` | **REFACTOR** | Blizzard status/update/test/clear queries |
| `lib/api-client.ts` | **REFACTOR** | 6 WoW functions + 6 WoW type imports |
| `hooks/use-character-detail.ts` | **KEEP** | None |
| `hooks/use-game-registry.ts` | **KEEP** | None |
| `components/events/game-search-input.tsx` | **KEEP** | None |
| `pages/profile-page.tsx` | **KEEP** | None |

**Totals: 7 MOVE, 13 REFACTOR, 4 KEEP**

### API Client WoW Functions

| Function | Endpoint | Consumers |
|----------|---------|-----------|
| `importWowCharacter(dto)` | `POST /users/me/characters/import/wow` | `use-character-mutations.ts` -> `wow-armory-import-form.tsx` |
| `refreshCharacterFromArmory(id, dto)` | `POST /users/me/characters/{id}/refresh` | `use-character-mutations.ts` -> `CharacterCard.tsx`, `character-detail-page.tsx` |
| `fetchWowRealms(region, variant)` | `GET /blizzard/realms` | `use-wow-realms.ts` -> `realm-autocomplete.tsx` |
| `previewWowCharacter(...)` | `GET /blizzard/character-preview` | `use-wow-realms.ts`, `wow-armory-import-form.tsx` |
| `fetchWowInstances(variant, type)` | `GET /blizzard/instances` | `use-wow-instances.ts` -> `create-event-form.tsx` |
| `fetchWowInstanceDetail(id, variant)` | `GET /blizzard/instance/{id}` | `use-wow-instances.ts`, `create-event-form.tsx` |

### Plugin Slot Designs

**character-detail:sections** -- The WoW plugin registers equipment grid, Wowhead integration, quality colors, slot layouts. Generic page shows name/role/class/level only.

**character-detail:header-badges** -- Plugin provides faction badge with alliance/horde styling. Generic shows basic badges.

**character-create:import-form** -- Plugin provides WoW Armory import tab with variant selector. Without plugin, only manual character creation.

**event-create:content-browser** -- Plugin provides instance browser with search, expansion names, level ranges. Without plugin, no content browser.

**event-detail:signup-warnings** -- Plugin provides level warning logic (`getLevelWarning`). Without plugin, no warnings.

**admin-settings:integration-cards** -- Plugin provides Blizzard API card with credentials form. Without plugin, no Blizzard card.

**profile:character-actions** -- Plugin provides "Refresh from Armory" button and "View on Armory" link. Without plugin, no refresh.

---

## 3. Database Schema Audit

### Characters Table

| Column | DB Type | Classification | Notes |
|--------|---------|---------------|-------|
| `id` | uuid PK | **KEEP** | Core |
| `user_id` | integer FK | **KEEP** | Core |
| `game_id` | uuid FK | **KEEP** | Core |
| `name` | varchar(100) | **KEEP** | Core |
| `realm` | varchar(100) | **KEEP** | Generic -- works for WoW realms, FFXIV servers, GW2 worlds |
| `class` | varchar(50) | **KEEP** | Generic -- any game's class system |
| `spec` | varchar(50) | **KEEP** | Generic |
| `role` | varchar(20) | **KEEP** | Generic -- tank/healer/dps common to MMOs |
| `role_override` | varchar(20) | **KEEP** | Generic |
| `is_main` | boolean | **KEEP** | Generic |
| `item_level` | integer | **KEEP** | Generic gear score concept |
| `external_id` | varchar(255) | **KEEP** | Generic external API identifier |
| `avatar_url` | text | **KEEP** | Generic |
| `render_url` | text | **KEEP** | Generic (comment is WoW-specific, column is not) |
| `level` | integer | **KEEP** | Generic |
| `race` | varchar(50) | **KEEP** | Generic |
| `faction` | varchar(20) | **KEEP** | Column is generic varchar. Current data values (alliance/horde) are WoW-specific but other games can store their own values. No DB-level enum. |
| `last_synced_at` | timestamp | **KEEP** | Generic sync tracking |
| `profile_url` | text | **KEEP** | Generic |
| `region` | varchar(10) | **KEEP** | Generic "API region" field. Purpose is currently WoW sync but usable by any game plugin. |
| `game_variant` | varchar(30) | **KEEP** | Generic "game version" field. Values are currently WoW variants but any game can use it. |
| `equipment` | jsonb | **KEEP** | Generic JSONB blob. Structure is currently WoW-specific but stored untyped at DB level. Plugin parses it. |
| `display_order` | integer | **KEEP** | Core |
| `created_at` | timestamp | **KEEP** | Core |
| `updated_at` | timestamp | **KEEP** | Core |

**Decision: All columns stay in core.** The columns `region`, `gameVariant`, `faction`, and `equipment` are structurally generic (varchar/jsonb). Their current WoW-specific usage is a data concern, not a schema concern. Plugins populate them; without plugins they're null/empty. No schema migration needed.

### Events Table

| Column | DB Type | Classification | Notes |
|--------|---------|---------------|-------|
| `content_instances` | jsonb | **KEEP+INTERFACE** | Column is generic JSONB. Currently stores `WowInstanceDetailDto[]`. Comment needs updating. Plugin provides type parsing. |
| All other columns | various | **KEEP** | Entirely generic |

**Decision:** `content_instances` stays as generic JSONB. The Zod schema typing changes (see Section 4). The DB column is unaffected.

### App Settings Table

| Key | Classification | Notes |
|-----|---------------|-------|
| `BLIZZARD_CLIENT_ID` | **Plugin-owned** | Currently hardcoded in `SETTING_KEYS`. Should be registered dynamically by plugin. |
| `BLIZZARD_CLIENT_SECRET` | **Plugin-owned** | Same as above. |
| `DISCORD_CLIENT_ID/SECRET/CALLBACK_URL` | **KEEP** | Core OAuth |
| `IGDB_CLIENT_ID/SECRET` | **KEEP** | Core game data |
| `DEMO_MODE` | **KEEP** | Core |

**Decision:** Remove `BLIZZARD_*` from the hardcoded `SETTING_KEYS` enum. Plugin registers its own setting keys via `SettingsProvider.getSettingKeys()`. The generic `SettingsService.get(key)`/`set(key, value)` methods work with any key string, so no code change is needed in the service layer -- only the enum constant removal.

---

## 4. Contract Schema Split Plan

### Proposed Package Structure

```
packages/
  contract/              @raid-ledger/contract     (existing -- core schemas)
  contract-wow/          @raid-ledger/contract-wow  (new -- all WoW schemas)
```

### What MOVES to `contract-wow/`

**Entire file:** `blizzard.schema.ts` (6 exports: WowInstance*, WowInstanceDetail*, WowInstanceListResponse*)

**Extracted from `characters.schema.ts`** (16 exports):
- `EquipmentItemSchema` / `EquipmentItemDto`
- `CharacterEquipmentSchema` / `CharacterEquipmentDto`
- `WowRegionSchema` / `WowRegion`
- `WowGameVariantSchema` / `WowGameVariant`
- `ImportWowCharacterSchema` / `ImportWowCharacterDto` / `ImportWowCharacterInput`
- `RefreshCharacterSchema` / `RefreshCharacterDto` / `RefreshCharacterInput`
- `WowRealmSchema` / `WowRealmDto`
- `WowRealmListResponseSchema` / `WowRealmListResponseDto`
- `BlizzardCharacterPreviewSchema` / `BlizzardCharacterPreviewDto`

**Total: ~26 schema/type exports move to plugin contract.**

### What STAYS in core `contract/` (with modifications)

**`characters.schema.ts` changes:**
1. Remove all `Wow*`, `Import*`, `Refresh*`, `Blizzard*`, `Equipment*` exports
2. Change `CharacterSchema.faction` from `z.enum(['alliance', 'horde']).nullable()` to `z.string().max(20).nullable()`
3. Change `CharacterSchema.equipment` from `CharacterEquipmentSchema.nullable()` to `z.unknown().nullable()`
4. `region` and `gameVariant` already typed as generic strings -- no change needed

**`events.schema.ts` changes:**
1. Remove `import { WowInstanceDetailSchema } from './blizzard.schema.js'`
2. Change `contentInstances` in CreateEvent/UpdateEvent/EventResponse from `z.array(WowInstanceDetailSchema)` to `z.array(z.record(z.unknown())).optional()`

**`signups.schema.ts` changes:**
1. Change `SignupCharacterSchema.faction` from `z.enum(['alliance', 'horde']).nullable().optional()` to `z.string().nullable().optional()`

**`system.schema.ts` changes:**
1. Replace `blizzardConfigured: z.boolean()` with a plugin-extensible pattern: `plugins: z.record(z.object({ configured: z.boolean() })).optional()`

**`index.ts` changes:**
1. Remove `export * from './blizzard.schema.js'`

### Re-export Strategy

`contract-wow/` exports:
- All WoW-specific schemas listed above
- A `WowCharacterSchema` that extends core `CharacterSchema` with properly-typed `equipment`, `faction` (re-narrowed to alliance/horde enum)
- A `parseWowCharacter(char: CharacterDto): WowCharacterDto` utility for type-narrowing

### Consumer Migration Map

| Current Consumer | Action |
|-----------------|--------|
| `api/src/blizzard/*` | Import from `@raid-ledger/contract-wow` |
| `api/src/characters/characters.service.ts` | WoW methods import from `contract-wow`; CRUD stays on core |
| `api/src/characters/characters.controller.ts` | WoW routes import from `contract-wow` |
| `web/src/lib/api-client.ts` | WoW functions import from `contract-wow` |
| WoW frontend components (7 MOVE files) | Import from `contract-wow` |
| 6 files with `FACTION_STYLES` | Use plugin-provided faction config |

---

## 5. Extension Point Validation

### Interface 1: CharacterSyncAdapter -- GAPS FOUND

**Current code paths not covered by proposed `import/refresh/syncAll/registerCron`:**

| Gap | Source | Description |
|-----|--------|-------------|
| `resolveGameId(variant)` | `characters.service.ts:281` | Slug-based game registry lookup differs by variant (`['wow', 'world-of-warcraft']` vs `['wow-classic', 'wow-classic-era']`) |
| `inferSpec(character)` | `blizzard.service.ts:864` | Classic talent tree spec inference -- separate API call |
| `fetchEquipment(character)` | `blizzard.service.ts:676` | Equipment is a separate API call during import/refresh |
| `buildProfileUrl(character)` | `blizzard.service.ts:666` | WoW-specific URL generation (null for Classic) |
| `getCooldownMs()` | `characters.service.ts:371` | 5-minute refresh cooldown is hardcoded |
| `getThrottleDelayMs()` | `characters.service.ts:548` | 500ms delay between bulk sync API calls |
| `getEligibleCharacterFilter()` | `characters.service.ts:474` | `region IS NOT NULL AND gameVariant IS NOT NULL` filter |

**Revised interface:**

```typescript
interface CharacterSyncAdapter {
  pluginId: string;
  gameSlug: string;

  import(userId: number, dto: unknown): Promise<CharacterDto>;
  refresh(userId: number, characterId: string, dto: unknown): Promise<CharacterDto>;
  syncAll(): Promise<{ synced: number; failed: number }>;

  resolveGameId(variant: string): Promise<string>;
  getEligibleCharacterFilter(): (char: CharacterRow) => boolean;
  getCooldownMs(): number;           // default: 300_000 (5 min)
  getThrottleDelayMs(): number;      // default: 500
  buildProfileUrl?(character: CharacterDto): string | null;
  getCronSchedule(): string;         // e.g., '0 0 3,15 * * *'
}
```

### Interface 2: ContentProvider -- GAPS FOUND

**Critical findings:**
- `getBosses()`, `getLoot()`, `getQuests()` do **NOT exist** in the codebase -- remove from interface
- Missing `getRealms()` -- used by `/blizzard/realms` endpoint for character import autocomplete
- Short names, level ranges, sub-instances are all internal enrichment data returned by the adapter, not separate operations

**Revised interface:**

```typescript
interface ContentProvider {
  pluginId: string;

  getInstances(region: string, variant: string, type: 'dungeon' | 'raid'): Promise<GameInstance[]>;
  getInstanceDetail(id: number, region: string, variant: string): Promise<GameInstanceDetail>;
  getRealms(region: string, variant: string): Promise<Realm[]>;
  previewCharacter(name: string, realm: string, region: string, variant: string): Promise<CharacterPreview>;
}
```

### Interface 3: EventEnricher -- GAPS FOUND

**Critical findings:**
- `validateSignup()` does **NOT exist** anywhere in the codebase -- no backend game-specific signup validation
- `getLevelWarning()` is **frontend-only** (event-detail-page.tsx:204-221)
- Backend stores `contentInstances` as opaque JSONB with zero validation

**Revised: Split into backend + frontend interfaces:**

```typescript
// Backend (future-proofing)
interface EventEnricher {
  validateContentSelection?(content: unknown[]): boolean;
  enrichEventResponse?(event: EventDto): EventDto;
}

// Frontend (where the actual logic lives)
interface FrontendEventEnricher {
  getLevelWarning(characterLevel: number | null, contentInstances: unknown[]): Warning | null;
  renderContentSections(contentInstances: unknown[]): ReactNode;
}
```

### Interface 4: SettingsProvider -- VALIDATED

The `EventEmitter2` / `@OnEvent()` pattern is fully generic. Any plugin can register settings keys and listen for update events.

**Revised interface (minor additions):**

```typescript
interface SettingsProvider {
  getSettingKeys(): string[];
  getSettingsSchema(): ZodSchema;
  getUpdateEventName(): string;
  onSettingsUpdated(config: unknown): void;
  testCredentials?(config: unknown): Promise<{ success: boolean; message: string }>;
}
```

### Interface 5: CronRegistrar -- VALIDATED

`SchedulerRegistry` in `@nestjs/schedule` 6.1.1 supports `addCronJob()`/`deleteCronJob()` for runtime management. The plugin declares crons; the framework manages lifecycle.

```typescript
interface CronRegistrar {
  getCronJobs(): Array<{
    name: string;
    schedule: string;
    handler: () => Promise<void>;
  }>;
}
```

### NEW Interfaces Identified

**6. ExternalAuthProvider** -- Blizzard OAuth token lifecycle:
```typescript
interface ExternalAuthProvider {
  getAccessToken(region: string): Promise<string>;
  clearCachedToken(): void;
  getConfigEventName(): string;
}
```

**7. GameDataTransformer** -- ~250 lines of WoW reference data:
```typescript
interface GameDataTransformer {
  specToRole(spec: string, characterClass?: string): 'tank' | 'healer' | 'dps' | null;
  getNamespacePrefixes?(variant: string): { static: string; dynamic: string; profile: string };
}
```

**No Discord bot game-specific logic found.** Notifications are game-agnostic. No guards/interceptors/middlewares with WoW logic.

---

## 6. Data Lifecycle & Edge Cases

### Uninstall Plugin with Existing Synced Characters

**Decision: Characters retain basic info.**

Characters in the core `characters` table keep all their column values (`name`, `class`, `spec`, `role`, `level`, `realm`, `faction`, `region`, `gameVariant`, `avatarUrl`, `equipment`). These are core table columns that happen to be WoW-populated. The plugin does NOT own these columns.

What changes on uninstall:
- Auto-sync cron stops (plugin deregisters it)
- "Refresh from Armory" button disappears (plugin slot is empty)
- Equipment grid disappears from character detail page (plugin slot is empty)
- The data itself is preserved and re-accessible if the plugin is reinstalled
- Plugin-owned tables (future: bosses, quests, attunements) are dropped

### Uninstall Plugin with Events Referencing contentInstances

**Decision: Leave the JSONB data intact.**

The `content_instances` JSONB column on events is a core column. On plugin uninstall:
- The raw JSON data stays in the database (it's harmless -- just metadata)
- The event detail page renders without the content section (plugin slot is empty)
- Event titles still show the names the user typed (not auto-generated from instance data)
- If the plugin is reinstalled, content sections reappear with full data

Alternative considered and rejected: nullifying the column on uninstall. This would lose historical data with no benefit -- the JSON is small and harmless.

### Deactivate (Not Uninstall)

**Decision: All data preserved, UI slots empty, crons paused.**

On deactivate:
- `SchedulerRegistry.deleteCronJob()` removes auto-sync cron
- `PluginActiveGuard` on plugin API routes returns 404/503
- Frontend `PluginContext.isPluginActive()` returns false, plugin slots render nothing
- All DB data intact (core columns and plugin-owned tables)
- On reactivate: crons re-register, routes re-enable, slots render again

### Reinstall After Uninstall

**Decision: Re-seed reference data, accept loss of user-created plugin data.**

On reinstall after full uninstall:
- Plugin-owned tables are recreated (bosses, quests, attunements)
- Seed data is re-run (static reference data)
- User-created data in plugin-owned tables (e.g., attunement progress, soft-res picks) is lost -- this was warned in the uninstall confirmation dialog
- Core table data (characters, events, contentInstances) was never deleted, so it's still there

### Upgrade Plugin Version

**Decision: Plugin provides migration functions.**

Plugin manifest includes a `migrations[]` array. On upgrade:
1. Check current installed version vs new version
2. Run migration functions in order (e.g., `v1_to_v2()`)
3. Update version in `plugins` table
4. Re-seed if new seed data was added

Plugin-owned tables use Drizzle migrations scoped to the plugin. The plugin's `migrations/` directory contains its own migration journal.

### Multiple Game Plugins Active Simultaneously

**Decision: No conflicts -- routing is game-based.**

Extension points route by game association:
- `CharacterSyncAdapter` dispatches by `character.gameId` -> game registry -> plugin binding
- `ContentProvider` dispatches by game slug from the event's registry game
- `SettingsProvider` each plugin has its own setting keys (namespaced)
- `CronRegistrar` cron job names are prefixed with plugin ID
- Frontend `PluginSlot` passes game context; plugin components check `gameSlug` before rendering

WoW Retail and WoW Classic can both be active. They bind to different game registry entries (`wow` vs `wow-classic`).

---

## 7. Build & Package Structure

### Recommended Architecture

```
packages/
  contract/                  @raid-ledger/contract      (existing)
  contract-wow/              @raid-ledger/contract-wow   (new)

api/src/plugins/
  plugin-host/               Plugin registry, lifecycle, guards
  wow-common/                Shared WoW NestJS module (BlizzardService, OAuth)
  wow-retail/                WoW Retail plugin module
  wow-classic/               WoW Classic plugin module

web/src/plugins/
  plugin-context/            PluginContext, PluginSlot components
  wow-common/                Shared WoW React components
  wow-retail/                WoW Retail plugin components
  wow-classic/               WoW Classic plugin components
```

### Why This Structure

**Plugin API modules inside `api/src/plugins/` (not separate workspaces):**
- Avoids circular dependency: if plugin packages depended on `@raid-ledger/api` AND `api` imported plugin modules, you'd have a workspace cycle that breaks `tsc`
- Plugins can freely import from `../drizzle/`, `../settings/`, etc. via relative paths
- No additional build step -- compiled as part of the api workspace

**Plugin web components inside `web/src/plugins/` (not separate workspaces):**
- Uses existing `@` path alias for imports
- Vite code-splits automatically via `React.lazy()`
- No multi-package build coordination
- Already covered by `web/tsconfig.app.json` include: `["src"]`

**Plugin contracts in a separate workspace package `packages/contract-wow/`:**
- Shared by both api and web
- Clean build order: `contract` -> `contract-wow` -> `api` + `web`
- Single package for all WoW variants (not per-plugin)

### Build Order

```
packages/contract
    |
    +---> packages/contract-wow
              |
              +---> api (includes api/src/plugins/*)
              +---> web (includes web/src/plugins/*)
```

### NestJS Module Loading Pattern

**Always-import + PluginActiveGuard (only viable option for routes):**

```typescript
// app.module.ts
@Module({
  imports: [
    // Core modules...
    PluginHostModule.forRootAsync(),
    WowCommonModule,      // always imported
    WowRetailModule,      // routes gated by PluginActiveGuard
    WowClassicModule,     // routes gated by PluginActiveGuard
  ],
})
export class AppModule {}
```

Why not alternatives:
- `LazyModuleLoader` cannot lazy-load controllers/routes (NestJS limitation)
- `ConditionalModule.registerWhen()` only supports env vars, not DB flags
- `DynamicModule.forRootAsync()` cannot dynamically compute the `imports` array

### Route Namespacing

```typescript
RouterModule.register([
  { path: 'plugins/wow', module: WowCommonModule },
  { path: 'plugins/wow-retail', module: WowRetailModule },
  { path: 'plugins/wow-classic', module: WowClassicModule },
])
```

### Dynamic Cron Registration

```typescript
@Injectable()
export class WowCharacterSyncCron implements OnModuleInit {
  constructor(
    private schedulerRegistry: SchedulerRegistry,
    private pluginRegistry: PluginRegistryService,
  ) {}

  async onModuleInit() {
    if (!await this.pluginRegistry.isActive('wow-common')) return;
    const job = new CronJob('0 0 3,15 * * *', () => this.syncAll());
    this.schedulerRegistry.addCronJob('wow-character-sync', job);
    job.start();
  }
}
```

### Vite Code-Splitting

```typescript
// web/src/plugins/wow-common/index.ts (lazy entry point)
const WowEquipmentGrid = lazy(() => import('@/plugins/wow-common/EquipmentGrid'));
const WowArmoryImportForm = lazy(() => import('@/plugins/wow-common/ArmoryImportForm'));
```

Produces separate chunks in production builds. Dev mode loads eagerly (expected Vite behavior).

### Workspace Config

```json
{
  "workspaces": ["api", "web", "packages/*"]
}
```

No change needed -- plugin code lives inside `api/src/` and `web/src/`, not in separate workspace packages. Only `packages/contract-wow/` is new, and it's covered by the `packages/*` glob.

---

## Appendix: Full File Classification Matrix

### Backend (33 files audited)

| Classification | Count | Files |
|---------------|-------|-------|
| MOVE | 4 | `blizzard/blizzard.service.ts`, `blizzard/blizzard.controller.ts`, `blizzard/blizzard.module.ts`, `characters/character-sync.service.ts` |
| REFACTOR | 9 | `characters/characters.service.ts`, `characters/characters.controller.ts`, `characters/characters.module.ts`, `settings/settings.service.ts`, `admin/settings.controller.ts`, `admin/demo-data.constants.ts`, `admin/demo-data.service.ts`, `drizzle/schema/characters.ts`, `drizzle/schema/app-settings.ts` |
| KEEP+INTERFACE | 2 | `events/events.service.ts`, `drizzle/schema/events.ts` |
| KEEP | 18 | Everything else |

### Frontend (25 files audited)

| Classification | Count | Files |
|---------------|-------|-------|
| MOVE | 7 | `hooks/use-wow-instances.ts`, `hooks/use-wow-realms.ts`, `hooks/use-wowhead-tooltips.ts`, `components/characters/wow-armory-import-form.tsx`, `components/characters/realm-autocomplete.tsx`, `components/characters/item-detail-modal.tsx`, `components/characters/item-fallback-tooltip.tsx` |
| REFACTOR | 13 | `pages/character-detail-page.tsx`, `components/events/create-event-form.tsx`, `pages/event-detail-page.tsx`, `pages/admin-settings-page.tsx`, `components/profile/AddCharacterModal.tsx`, `components/profile/CharacterCard.tsx`, `components/characters/character-card-compact.tsx`, `components/characters/inline-character-form.tsx`, `components/events/signup-confirmation-modal.tsx`, `pages/user-profile-page.tsx`, `hooks/use-character-mutations.ts`, `hooks/use-admin-settings.ts`, `lib/api-client.ts` |
| KEEP | 4 | `hooks/use-character-detail.ts`, `hooks/use-game-registry.ts`, `components/events/game-search-input.tsx`, `pages/profile-page.tsx` |

### Contract (16 files audited)

| Classification | Count | Files |
|---------------|-------|-------|
| MOVE | 1 | `blizzard.schema.ts` |
| SPLIT | 4 | `characters.schema.ts`, `events.schema.ts`, `signups.schema.ts`, `system.schema.ts` |
| KEEP | 11 | `games.schema.ts`, `game-registry.schema.ts`, `availability.schema.ts`, `roster-availability.schema.ts`, `roster.schema.ts`, `preferences.schema.ts`, `game-time.schema.ts`, `admin.schema.ts`, `templates.schema.ts`, `users.schema.ts`, `index.ts` |

### Extension Points (9 total)

| Interface | Status | Direction |
|-----------|--------|-----------|
| CharacterSyncAdapter | Revised -- 7 new methods added | Backend |
| ContentProvider | Revised -- removed 3 nonexistent methods, added `getRealms`, `previewCharacter` | Backend |
| EventEnricher | Split into backend + frontend interfaces | Both |
| SettingsProvider | Validated -- minor additions | Backend |
| CronRegistrar | Validated | Backend |
| ExternalAuthProvider | **NEW** | Backend |
| GameDataTransformer | **NEW** | Backend |
| FrontendEventEnricher | **NEW** (split from EventEnricher) | Frontend |
| PluginSlotRegistry | **NEW** (implicit -- manages frontend slots) | Frontend |
