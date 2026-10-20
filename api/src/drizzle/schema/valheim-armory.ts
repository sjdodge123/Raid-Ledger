import {
  pgTable,
  serial,
  bigserial,
  bigint,
  integer,
  text,
  timestamp,
  jsonb,
  doublePrecision,
  index,
  unique,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  ValheimCharacterMessage,
  ValheimItemDefinition,
  ValheimMapMessage,
} from '@raid-ledger/contract';
import { pelicanServers } from './pelican-servers';
import { users } from './users';
import { valheimLinkSnapshots } from './valheim-link';

export const tsz = (name: string) => timestamp(name, { withTimezone: true });
export const importedAt = () => tsz('imported_at').notNull().defaultNow();
export const serverFk = () =>
  integer('pelican_server_id')
    .notNull()
    .references(() => pelicanServers.id, { onDelete: 'cascade' });
export const snapshotCol = () =>
  bigint('source_snapshot_id', { mode: 'number' });
/**
 * Explicitly named: drizzle's default `<table>_source_snapshot_id_
 * valheim_link_snapshots_id_fk` exceeds Postgres' 63-char identifier limit
 * (constraint-name-length.spec.ts, ROK-1387).
 */
export const snapshotFk = (table: string, col: AnyPgColumn) =>
  foreignKey({
    columns: [col],
    foreignColumns: [valheimLinkSnapshots.id],
    name: `${table}_source_snapshot_fk`,
  }).onDelete('set null');
const userFk = (name: string) =>
  integer(name).references(() => users.id, { onDelete: 'set null' });

/** How a profile came to be claimed (ROK-1835 Q9). */
export type ValheimClaimSourceRow = 'auto' | 'manual' | 'admin';

/**
 * ROK-1835: one row per character per server (latest snapshot only, R1/D2).
 * `steam_id` is the SteamID64 the mod ASSERTED — it is never written to
 * `users`; it only links when it equals a Raid-Ledger-verified
 * `users.steam_id` (R5). Overwritten in place when `captured_at` is newer.
 */
export const valheimProfiles = pgTable(
  'valheim_profiles',
  {
    id: serial('id').primaryKey(),
    pelicanServerId: serverFk(),
    steamId: text('steam_id').notNull(),
    /** int64 as a string — the character key. */
    playerId: text('player_id').notNull(),
    worldUid: text('world_uid').notNull(),
    worldName: text('world_name').notNull(),
    /** Display only — never used to claim. */
    name: text('name').notNull(),
    claimedBy: userFk('claimed_by'),
    claimSource: text('claim_source').$type<ValheimClaimSourceRow>(),
    claimedAt: tsz('claimed_at'),
    gameVersion: text('game_version').notNull(),
    modVersion: text('mod_version').notNull(),
    capturedAt: tsz('captured_at').notNull(),
    importedAt: importedAt(),
    equipment: jsonb('equipment')
      .$type<ValheimCharacterMessage['equipment']>()
      .notNull(),
    inventory: jsonb('inventory')
      .$type<ValheimCharacterMessage['inventory']>()
      .notNull(),
    skills: jsonb('skills')
      .$type<ValheimCharacterMessage['skills']>()
      .notNull(),
    trophies: jsonb('trophies').$type<string[]>().notNull(),
    knownItems: jsonb('known_items').$type<string[]>().notNull(),
    knownRecipes: jsonb('known_recipes').$type<string[]>().notNull(),
    sourceSnapshotId: snapshotCol(),
  },
  (t) => [
    // Leading pelican_server_id also backs the server FK.
    unique('valheim_profiles_identity_uq').on(
      t.pelicanServerId,
      t.steamId,
      t.playerId,
    ),
    index('valheim_profiles_claimed_by_idx').on(t.claimedBy),
    // Attach-on-Steam-link lookup (A2).
    index('valheim_profiles_steam_id_idx').on(t.steamId),
    // ROK-1853: personal-chest ownership EXISTS (creator_player_id → profile).
    index('valheim_profiles_server_player_idx').on(
      t.pelicanServerId,
      t.playerId,
    ),
    index('valheim_profiles_source_snapshot_idx').on(t.sourceSnapshotId),
    snapshotFk('valheim_profiles', t.sourceSnapshotId),
    check(
      'valheim_profiles_claim_source_chk',
      sql`${t.claimSource} IN ('auto','manual','admin')`,
    ),
    check(
      'valheim_profiles_claim_pair_chk',
      sql`(${t.claimedBy} IS NULL) = (${t.claimSource} IS NULL)`,
    ),
  ],
);

/**
 * ROK-1835: one row per character per world per server (D3). A map can land
 * before its character, so `profile_id` is nullable and back-filled. Pins are
 * player free text — never log them. Fog bitmaps are stored verbatim.
 */
export const valheimMaps = pgTable(
  'valheim_maps',
  {
    id: serial('id').primaryKey(),
    pelicanServerId: serverFk(),
    steamId: text('steam_id').notNull(),
    playerId: text('player_id').notNull(),
    worldUid: text('world_uid').notNull(),
    profileId: integer('profile_id').references(() => valheimProfiles.id, {
      onDelete: 'set null',
    }),
    textureSize: integer('texture_size').notNull(),
    pixelSizeMetres: doublePrecision('pixel_size_metres').notNull(),
    explored: jsonb('explored')
      .$type<ValheimMapMessage['explored']>()
      .notNull(),
    sharedExplored:
      jsonb('shared_explored').$type<
        NonNullable<ValheimMapMessage['sharedExplored']>
      >(),
    pins: jsonb('pins').$type<ValheimMapMessage['pins']>().notNull(),
    baseMapSha256: text('base_map_sha256'),
    baseMapWidth: integer('base_map_width'),
    baseMapHeight: integer('base_map_height'),
    gameVersion: text('game_version').notNull(),
    capturedAt: tsz('captured_at').notNull(),
    importedAt: importedAt(),
    sourceSnapshotId: snapshotCol(),
  },
  (t) => [
    unique('valheim_maps_identity_uq').on(
      t.pelicanServerId,
      t.steamId,
      t.playerId,
      t.worldUid,
    ),
    index('valheim_maps_profile_idx').on(t.profileId),
    index('valheim_maps_source_snapshot_idx').on(t.sourceSnapshotId),
    snapshotFk('valheim_maps', t.sourceSnapshotId),
  ],
);

/**
 * One catalogue entry. `icon.file` (for `file` icons) is display metadata
 * only — bytes are located by `(server, sha256)` alone, never by name (R6).
 */
export type ValheimItemCatalogEntryRow = Omit<
  ValheimItemDefinition,
  'prefab' | 'icon'
> & {
  icon:
    | { kind: 'atlas'; x: number; y: number; w: number; h: number }
    | { kind: 'file'; file: string; sha256: string | null }
    | null;
};

/** ROK-1835: one item catalogue per server per game version (D4). */
export const valheimItemCatalogs = pgTable(
  'valheim_item_catalogs',
  {
    id: serial('id').primaryKey(),
    pelicanServerId: serverFk(),
    gameVersion: text('game_version').notNull(),
    locale: text('locale').notNull(),
    atlasSha256: text('atlas_sha256'),
    atlasWidth: integer('atlas_width'),
    atlasHeight: integer('atlas_height'),
    /** Keyed by prefab id. */
    items: jsonb('items')
      .$type<Record<string, ValheimItemCatalogEntryRow>>()
      .notNull(),
    capturedAt: tsz('captured_at').notNull(),
    importedAt: importedAt(),
    sourceSnapshotId: snapshotCol(),
  },
  (t) => [
    unique('valheim_item_catalogs_version_uq').on(
      t.pelicanServerId,
      t.gameVersion,
    ),
    index('valheim_item_catalogs_source_snapshot_idx').on(t.sourceSnapshotId),
    snapshotFk('valheim_item_catalogs', t.sourceSnapshotId),
  ],
);

/** Audit actions on a profile's owner (ROK-1835). */
export type ValheimClaimActionRow =
  'auto_attach' | 'claim' | 'admin_assign' | 'admin_unassign' | 'auto_detach';

/**
 * ROK-1835: claim audit trail. User columns are SET NULL so the history
 * outlives a deleted user; `actor_user_id` NULL = the system (auto-match).
 */
export const valheimProfileClaimEvents = pgTable(
  'valheim_profile_claim_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => valheimProfiles.id, { onDelete: 'cascade' }),
    action: text('action').$type<ValheimClaimActionRow>().notNull(),
    fromUserId: userFk('from_user_id'),
    toUserId: userFk('to_user_id'),
    actorUserId: userFk('actor_user_id'),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('valheim_profile_claim_events_profile_created_idx').on(
      t.profileId,
      t.createdAt,
    ),
    index('valheim_profile_claim_events_from_idx').on(t.fromUserId),
    index('valheim_profile_claim_events_to_idx').on(t.toUserId),
    index('valheim_profile_claim_events_actor_idx').on(t.actorUserId),
    check(
      'valheim_profile_claim_events_action_chk',
      sql`${t.action} IN ('auto_attach','claim','admin_assign','admin_unassign','auto_detach')`,
    ),
  ],
);

export type ValheimProfileRow = typeof valheimProfiles.$inferSelect;
export type NewValheimProfile = typeof valheimProfiles.$inferInsert;
export type ValheimMapRow = typeof valheimMaps.$inferSelect;
export type NewValheimMap = typeof valheimMaps.$inferInsert;
export type ValheimItemCatalogRow = typeof valheimItemCatalogs.$inferSelect;
export type NewValheimItemCatalog = typeof valheimItemCatalogs.$inferInsert;
export type ValheimProfileClaimEventRow =
  typeof valheimProfileClaimEvents.$inferSelect;
export type NewValheimProfileClaimEvent =
  typeof valheimProfileClaimEvents.$inferInsert;
