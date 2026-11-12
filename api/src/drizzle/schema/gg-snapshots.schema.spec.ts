/**
 * ROK-2187 — GG <year> snapshot storage. Pins the column set, the user FK,
 * one snapshot per (user, year), the share-slug key and the CHECKs that keep
 * the tier and the share stamps consistent.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { ggSnapshots } from './gg-snapshots';

type Config = ReturnType<typeof getTableConfig>;

function indexNames(config: Config): string[] {
  return config.indexes.map((i) => i.config.name ?? '').sort();
}

describe('gg_snapshots schema', () => {
  const config = getTableConfig(ggSnapshots);

  it('has exactly the pinned column set', () => {
    expect(config.name).toBe('gg_snapshots');
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      'activity_tier',
      'computed_at',
      'dm_claimed_at',
      'dm_sent_at',
      'id',
      'payload',
      'schema_version',
      'share_slug',
      'shared_at',
      'user_id',
      'year',
    ]);
  });

  it('cascades from the user', () => {
    const fks = config.foreignKeys.map((fk) => ({
      cols: fk.reference().columns.map((c) => c.name),
      onDelete: fk.onDelete,
    }));
    expect(fks).toEqual([{ cols: ['user_id'], onDelete: 'cascade' }]);
  });

  it('keys one snapshot per (user, year) and a unique nullable share slug', () => {
    const userYear = config.indexes.find(
      (i) => i.config.name === 'gg_snapshots_user_year_uq',
    );
    expect(userYear?.config.unique).toBe(true);
    expect(
      userYear?.config.columns.map((c) => ('name' in c ? c.name : '')),
    ).toEqual(['user_id', 'year']);
    const slug = config.columns.find((c) => c.name === 'share_slug');
    expect(slug?.isUnique).toBe(true);
    expect(slug?.notNull).toBe(false);
  });

  it('indexes the DM wave lookup as a partial index on unclaimed rows', () => {
    const pending = config.indexes.find(
      (i) => i.config.name === 'gg_snapshots_dm_pending_idx',
    );
    expect(pending?.config.where).toBeDefined();
    expect(indexNames(config)).toEqual([
      'gg_snapshots_dm_pending_idx',
      'gg_snapshots_user_year_uq',
    ]);
  });

  it('leaves the share and DM stamps nullable (off by default, Q5)', () => {
    for (const name of ['shared_at', 'dm_claimed_at', 'dm_sent_at']) {
      const col = config.columns.find((c) => c.name === name);
      expect({ name, notNull: col?.notNull }).toEqual({ name, notNull: false });
    }
  });

  it('CHECKs the activity tier and slug/shared_at pairing', () => {
    expect(config.checks.map((c) => c.name).sort()).toEqual([
      'gg_snapshots_share_pair_chk',
      'gg_snapshots_tier_chk',
    ]);
  });
});
