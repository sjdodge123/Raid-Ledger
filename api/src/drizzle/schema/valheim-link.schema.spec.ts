/**
 * ROK-1833 — Valheim Link ingest storage. Pins the three tables' column sets,
 * fks (all cascade from pelican_servers; created_by nulls), and the keys the
 * latest-wins upsert and the importer's queue scan depend on. No column may
 * hold a raw token — only `token_hash` + a 4-char `token_hint`.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  valheimLinkTokens,
  valheimLinkSnapshots,
  valheimLinkBlobs,
} from './valheim-link';

type Config = ReturnType<typeof getTableConfig>;

function columnNames(config: Config): string[] {
  return config.columns.map((c) => c.name).sort();
}

function fks(
  config: Config,
): { cols: string[]; onDelete: string | undefined }[] {
  return config.foreignKeys
    .map((fk) => ({
      cols: fk.reference().columns.map((c) => c.name),
      onDelete: fk.onDelete,
    }))
    .sort((a, b) => a.cols.join().localeCompare(b.cols.join()));
}

describe('valheim_link_tokens schema', () => {
  const config = getTableConfig(valheimLinkTokens);

  it('has exactly the pinned column set (no raw token column)', () => {
    expect(config.name).toBe('valheim_link_tokens');
    expect(columnNames(config)).toEqual([
      'created_at',
      'created_by',
      'id',
      'last_used_at',
      'pelican_server_id',
      'revoked_at',
      'rotated_at',
      'token_hash',
      'token_hint',
    ]);
  });

  it('is one row per server and one row per hash', () => {
    const unique = config.columns.filter((c) => c.isUnique).map((c) => c.name);
    expect(unique.sort()).toEqual(['pelican_server_id', 'token_hash']);
  });

  it('cascades from the server, nulls the creator, and indexes created_by', () => {
    expect(fks(config)).toEqual([
      { cols: ['created_by'], onDelete: 'set null' },
      { cols: ['pelican_server_id'], onDelete: 'cascade' },
    ]);
    const idx = config.indexes.map((i) => i.config.name);
    expect(idx).toContain('valheim_link_tokens_created_by_idx');
  });
});

describe('valheim_link_snapshots schema', () => {
  const config = getTableConfig(valheimLinkSnapshots);

  it('has exactly the pinned column set', () => {
    expect(config.name).toBe('valheim_link_snapshots');
    expect(columnNames(config)).toEqual([
      'blob_refs',
      'captured_at',
      'game_version',
      'id',
      'kind',
      'mod_version',
      'payload',
      'pelican_server_id',
      'player_id',
      'received_at',
      'snapshot_key',
      'status',
      'status_detail',
      'steam_id',
      'world_uid',
    ]);
  });

  it('is latest-wins on (server, kind, snapshot_key)', () => {
    const uq = config.uniqueConstraints.map((u) => ({
      name: u.name,
      cols: u.columns.map((c) => c.name),
    }));
    expect(uq).toEqual([
      {
        name: 'valheim_link_snapshots_key_uq',
        cols: ['pelican_server_id', 'kind', 'snapshot_key'],
      },
    ]);
  });

  it('indexes the importer queue scan and checks kind + status', () => {
    const queue = config.indexes.find(
      (i) => i.config.name === 'valheim_link_snapshots_status_received_idx',
    );
    expect(queue).toBeDefined();
    const checks = config.checks.map((c) => c.name).sort();
    expect(checks).toEqual([
      'valheim_link_snapshots_kind_chk',
      'valheim_link_snapshots_status_chk',
    ]);
  });

  it('cascades from pelican_servers', () => {
    expect(fks(config)).toEqual([
      { cols: ['pelican_server_id'], onDelete: 'cascade' },
    ]);
  });
});

describe('valheim_link_blobs schema', () => {
  const config = getTableConfig(valheimLinkBlobs);

  it('has exactly the pinned column set', () => {
    expect(config.name).toBe('valheim_link_blobs');
    expect(columnNames(config)).toEqual([
      'byte_length',
      'content_type',
      'created_at',
      'height',
      'last_referenced_at',
      'pelican_server_id',
      'sha256',
      'storage_path',
      'width',
    ]);
  });

  it('is keyed per server so one server never satisfies another', () => {
    const pk = config.primaryKeys.map((p) => p.columns.map((c) => c.name));
    expect(pk).toEqual([['pelican_server_id', 'sha256']]);
  });

  it('cascades from pelican_servers', () => {
    expect(fks(config)).toEqual([
      { cols: ['pelican_server_id'], onDelete: 'cascade' },
    ]);
  });
});
