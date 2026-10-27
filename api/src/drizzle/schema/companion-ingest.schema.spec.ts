/**
 * ROK-1956 — companion ingest storage. Pins the three tables' column sets,
 * keys, FKs and CHECKs (spec §6): per-user latest-wins, the private
 * content-addressed blob index, and message → blob refs.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  companionBlobRefs,
  companionBlobs,
  companionIngestLatest,
} from './companion-ingest';

type Config = ReturnType<typeof getTableConfig>;

const dialect = new PgDialect();

const columnNames = (c: Config): string[] =>
  c.columns.map((x) => x.name).sort();

function fks(
  c: Config,
): { cols: string; to: string; onDelete: string | undefined }[] {
  return c.foreignKeys
    .map((fk) => {
      const ref = fk.reference();
      return {
        cols: ref.columns.map((x) => x.name).join(),
        to: getTableConfig(ref.foreignTable).name,
        onDelete: fk.onDelete,
      };
    })
    .sort((a, b) => a.cols.localeCompare(b.cols));
}

const pkColumns = (c: Config): string[][] =>
  c.primaryKeys.map((pk) => pk.columns.map((x) => x.name));

function checkSql(c: Config): Record<string, string> {
  return Object.fromEntries(
    c.checks.map((ch) => [ch.name, dialect.sqlToQuery(ch.value).sql]),
  );
}

describe('companion_ingest_latest schema (ROK-1956)', () => {
  const config = getTableConfig(companionIngestLatest);

  it('is keyed per user + contract + latest key and cascades from the user', () => {
    expect(config.name).toBe('companion_ingest_latest');
    expect(columnNames(config)).toEqual([
      'contract',
      'latest_at',
      'latest_key',
      'updated_at',
      'user_id',
    ]);
    expect(pkColumns(config)).toEqual([['user_id', 'contract', 'latest_key']]);
    expect(fks(config)).toEqual([
      { cols: 'user_id', to: 'users', onDelete: 'cascade' },
    ]);
  });

  it('caps latest_key at 128 chars with a CHECK', () => {
    expect(checkSql(config)['companion_ingest_latest_key_len_chk']).toMatch(
      /char_length\("companion_ingest_latest"\."latest_key"\) <= 128/,
    );
  });
});

describe('companion_blobs schema (ROK-1956)', () => {
  const config = getTableConfig(companionBlobs);

  it('has exactly the pinned column set', () => {
    expect(config.name).toBe('companion_blobs');
    expect(columnNames(config)).toEqual([
      'byte_length',
      'content_type',
      'created_at',
      'device_id',
      'height',
      'id',
      'sha256',
      'storage_path',
      'user_id',
      'width',
    ]);
  });

  it('cascades from the user and nulls the device on delete', () => {
    expect(fks(config)).toEqual([
      { cols: 'device_id', to: 'companion_devices', onDelete: 'set null' },
      { cols: 'user_id', to: 'users', onDelete: 'cascade' },
    ]);
  });

  it('is unique per (user, sha256) and indexes created_at + device_id', () => {
    const idx = config.indexes.map((i) => ({
      name: i.config.name,
      unique: i.config.unique,
      cols: i.config.columns.map((x) => ('name' in x ? x.name : '?')),
    }));
    expect(idx).toEqual(
      expect.arrayContaining([
        {
          name: 'companion_blobs_user_sha_uq',
          unique: true,
          cols: ['user_id', 'sha256'],
        },
        {
          name: 'companion_blobs_created_at_idx',
          unique: false,
          cols: ['created_at'],
        },
        {
          name: 'companion_blobs_device_id_idx',
          unique: false,
          cols: ['device_id'],
        },
      ]),
    );
  });
});

describe('companion_blobs CHECKs (ROK-1956)', () => {
  const config = getTableConfig(companionBlobs);

  it('CHECKs a lowercase hex sha256 and pins content_type to image/webp', () => {
    const checks = checkSql(config);
    expect(checks['companion_blobs_sha256_chk']).toContain(
      "~ '^[0-9a-f]{64}$'",
    );
    expect(checks['companion_blobs_content_type_chk']).toContain(
      "= 'image/webp'",
    );
    const ct = config.columns.find((c) => c.name === 'content_type');
    expect(ct?.default).toBe('image/webp');
    expect(config.columns.find((c) => c.name === 'sha256')?.getSQLType()).toBe(
      'char(64)',
    );
  });
});

describe('companion_blob_refs schema (ROK-1956)', () => {
  const config = getTableConfig(companionBlobRefs);

  it('is keyed per (user, sha256, contract) and cascades from the user', () => {
    expect(config.name).toBe('companion_blob_refs');
    expect(columnNames(config)).toEqual([
      'byte_length',
      'contract',
      'height',
      'referenced_at',
      'sha256',
      'user_id',
      'width',
    ]);
    expect(pkColumns(config)).toEqual([['user_id', 'sha256', 'contract']]);
    expect(fks(config)).toEqual([
      { cols: 'user_id', to: 'users', onDelete: 'cascade' },
    ]);
  });
});
