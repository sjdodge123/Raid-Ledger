/**
 * ROK-1835 — Valheim armory storage. Pins the four tables' column sets, the
 * natural keys the importer's latest-wins upserts target, the on-delete rule
 * of every FK (servers cascade; users/snapshots null; audit cascades from its
 * profile) and the CHECKs that keep the claim columns consistent. No table
 * carries a column that writes back to `users`.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  valheimProfiles,
  valheimMaps,
  valheimItemCatalogs,
  valheimProfileClaimEvents,
} from './valheim-armory';

type Config = ReturnType<typeof getTableConfig>;

function columnNames(config: Config): string[] {
  return config.columns.map((c) => c.name).sort();
}

function fks(config: Config): { cols: string; onDelete: string | undefined }[] {
  return config.foreignKeys
    .map((fk) => ({
      cols: fk
        .reference()
        .columns.map((c) => c.name)
        .join(),
      onDelete: fk.onDelete,
    }))
    .sort((a, b) => a.cols.localeCompare(b.cols));
}

function uniqueCols(config: Config): string[][] {
  return config.uniqueConstraints.map((u) => u.columns.map((c) => c.name));
}

function indexNames(config: Config): string[] {
  return config.indexes.map((i) => i.config.name ?? '').sort();
}

function checkNames(config: Config): string[] {
  return config.checks.map((c) => c.name).sort();
}

describe('valheim_profiles schema', () => {
  const config = getTableConfig(valheimProfiles);

  it('has exactly the pinned column set', () => {
    expect(config.name).toBe('valheim_profiles');
    expect(columnNames(config)).toEqual([
      'captured_at',
      'claim_source',
      'claimed_at',
      'claimed_by',
      'equipment',
      'game_version',
      'id',
      'imported_at',
      'inventory',
      'known_items',
      'known_recipes',
      'mod_version',
      'name',
      'pelican_server_id',
      'player_id',
      'skills',
      'source_snapshot_id',
      'steam_id',
      'trophies',
      'world_name',
      'world_uid',
    ]);
  });

  it('is one row per (server, steam id, player id)', () => {
    expect(uniqueCols(config)).toEqual([
      ['pelican_server_id', 'steam_id', 'player_id'],
    ]);
  });

  it('cascades from the server and nulls the claimer and the snapshot', () => {
    expect(fks(config)).toEqual([
      { cols: 'claimed_by', onDelete: 'set null' },
      { cols: 'pelican_server_id', onDelete: 'cascade' },
      { cols: 'source_snapshot_id', onDelete: 'set null' },
    ]);
  });

  it('indexes every FK and the steam-link lookup', () => {
    expect(indexNames(config)).toEqual([
      'valheim_profiles_claimed_by_idx',
      'valheim_profiles_server_player_idx',
      'valheim_profiles_source_snapshot_idx',
      'valheim_profiles_steam_id_idx',
    ]);
  });

  it('checks the claim source and its pairing with claimed_by', () => {
    expect(checkNames(config)).toEqual([
      'valheim_profiles_claim_pair_chk',
      'valheim_profiles_claim_source_chk',
    ]);
  });
});

describe('valheim_maps schema', () => {
  const config = getTableConfig(valheimMaps);

  it('has exactly the pinned column set', () => {
    expect(config.name).toBe('valheim_maps');
    expect(columnNames(config)).toEqual([
      'base_map_height',
      'base_map_sha256',
      'base_map_width',
      'captured_at',
      'explored',
      'game_version',
      'id',
      'imported_at',
      'pelican_server_id',
      'pins',
      'pixel_size_metres',
      'player_id',
      'profile_id',
      'shared_explored',
      'source_snapshot_id',
      'steam_id',
      'texture_size',
      'world_uid',
    ]);
  });

  it('is one row per (server, steam id, player id, world)', () => {
    expect(uniqueCols(config)).toEqual([
      ['pelican_server_id', 'steam_id', 'player_id', 'world_uid'],
    ]);
  });

  it('cascades from the server and nulls the profile and the snapshot', () => {
    expect(fks(config)).toEqual([
      { cols: 'pelican_server_id', onDelete: 'cascade' },
      { cols: 'profile_id', onDelete: 'set null' },
      { cols: 'source_snapshot_id', onDelete: 'set null' },
    ]);
    expect(indexNames(config)).toEqual([
      'valheim_maps_profile_idx',
      'valheim_maps_source_snapshot_idx',
    ]);
  });
});

describe('valheim_item_catalogs schema', () => {
  const config = getTableConfig(valheimItemCatalogs);

  it('has exactly the pinned column set', () => {
    expect(config.name).toBe('valheim_item_catalogs');
    expect(columnNames(config)).toEqual([
      'atlas_height',
      'atlas_sha256',
      'atlas_width',
      'captured_at',
      'game_version',
      'id',
      'imported_at',
      'items',
      'locale',
      'pelican_server_id',
      'source_snapshot_id',
    ]);
  });

  it('is one row per (server, game version)', () => {
    expect(uniqueCols(config)).toEqual([['pelican_server_id', 'game_version']]);
    expect(fks(config)).toEqual([
      { cols: 'pelican_server_id', onDelete: 'cascade' },
      { cols: 'source_snapshot_id', onDelete: 'set null' },
    ]);
    expect(indexNames(config)).toEqual([
      'valheim_item_catalogs_source_snapshot_idx',
    ]);
  });
});

describe('valheim_profile_claim_events schema', () => {
  const config = getTableConfig(valheimProfileClaimEvents);

  it('has exactly the pinned column set', () => {
    expect(config.name).toBe('valheim_profile_claim_events');
    expect(columnNames(config)).toEqual([
      'action',
      'actor_user_id',
      'created_at',
      'from_user_id',
      'id',
      'profile_id',
      'to_user_id',
    ]);
  });

  it('cascades from the profile and nulls every user column', () => {
    expect(fks(config)).toEqual([
      { cols: 'actor_user_id', onDelete: 'set null' },
      { cols: 'from_user_id', onDelete: 'set null' },
      { cols: 'profile_id', onDelete: 'cascade' },
      { cols: 'to_user_id', onDelete: 'set null' },
    ]);
  });

  it('indexes every FK and checks the action list', () => {
    expect(indexNames(config)).toEqual([
      'valheim_profile_claim_events_actor_idx',
      'valheim_profile_claim_events_from_idx',
      'valheim_profile_claim_events_profile_created_idx',
      'valheim_profile_claim_events_to_idx',
    ]);
    expect(checkNames(config)).toEqual([
      'valheim_profile_claim_events_action_chk',
    ]);
  });
});
