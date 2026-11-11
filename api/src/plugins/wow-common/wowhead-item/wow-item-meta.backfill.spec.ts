/**
 * ROK-2176 §4.4 — boss-loot tooltip backfill: the query's shape (rendered
 * SQL) and the service step that enqueues the ids and drops the loot cache.
 * The real-DB proof of the query lands with L4's integration spec.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SettingsService } from '../../../settings/settings.service';
import type { BossEncountersService } from '../boss-encounters.service';
import {
  BACKFILL_EXPANSIONS,
  backfillWhere,
  bossLootBackfillIds,
} from './wow-item-meta.backfill';
import {
  WowItemMetaService,
  WOWHEAD_RETRY_BATCH,
} from './wow-item-meta.service';
import { createWowheadLimiter } from './wowhead-item.limiter';
import {
  WOWHEAD_TOOLTIP_PARSE_VERSION,
  type WowheadFetch,
} from './wowhead-item.types';

const NOW = new Date('2026-11-11T05:15:00Z');
/** Captured Wowhead tooltip HTML (Demonic Gauntlet, env 16). */
const TOOLTIP_HTML = (
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        'testing',
        'fixtures',
        'wowhead',
        'item-234819-env16.json',
      ),
      'utf8',
    ),
  ) as { tooltip: string }
).tooltip;

/** `selectDistinct` chain stub returning `ids`; records the limit. */
function lootDb(ids: number[]) {
  const limit = jest.fn(() =>
    Promise.resolve(ids.map((itemId) => ({ itemId }))),
  );
  const where = jest.fn(() => ({ limit }));
  const selectDistinct = jest.fn(() => ({
    from: () => ({ leftJoin: () => ({ where }) }),
  }));
  const writes: unknown[] = [];
  const db = {
    selectDistinct,
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: (r: unknown) => ({
        onConflictDoUpdate: () => {
          writes.push(r);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, selectDistinct, limit, writes };
}

function service(db: object, status: number, setting: string | null = null) {
  const fetchFn: WowheadFetch = () =>
    Promise.resolve({
      status,
      json: () =>
        Promise.resolve({
          name: 'Drop',
          quality: 4,
          icon: 'a',
          tooltip: TOOLTIP_HTML,
        }),
    });
  const clearCache = jest.fn(() => Promise.resolve());
  const svc = new WowItemMetaService(
    db as never,
    { get: jest.fn().mockResolvedValue(setting) } as unknown as SettingsService,
    { clearCache } as unknown as BossEncountersService,
    {
      fetchFn,
      limiter: createWowheadLimiter({ minIntervalMs: 0 }),
      wait: () => Promise.resolve(),
      now: () => NOW,
    },
  );
  return { svc, clearCache };
}

describe('backfillWhere (ROK-2176)', () => {
  it('limits to classic/sod/forever loot with no meta row or a stale found row', () => {
    const { sql, params } = new PgDialect().sqlToQuery(backfillWhere(1) as SQL);
    expect(sql).toMatch(
      /"wow_classic_boss_loot"\."expansion" in \(\$1, \$2, \$3\)/,
    );
    expect(sql).toMatch(/"wow_item_meta"\."item_id" is null/);
    expect(sql).toMatch(/"wow_item_meta"\."status" in \(\$4, \$5\)/);
    expect(sql).toMatch(
      /"wow_item_meta"\."tooltip_version" IS DISTINCT FROM \$6/,
    );
    expect(params).toEqual([
      ...BACKFILL_EXPANSIONS,
      'resolved',
      'classic_fallback',
      1,
    ]);
    expect(BACKFILL_EXPANSIONS).toEqual(['classic', 'sod', 'forever']);
  });
});

describe('bossLootBackfillIds (ROK-2176)', () => {
  it('returns the distinct item ids, capped at the limit', async () => {
    const { db, limit } = lootDb([19019, 16921]);
    await expect(bossLootBackfillIds(db as never, 7)).resolves.toEqual([
      19019, 16921,
    ]);
    expect(limit).toHaveBeenCalledWith(7);
  });

  it('a zero limit runs no query', async () => {
    const { db, selectDistinct } = lootDb([1]);
    await expect(bossLootBackfillIds(db as never, 0)).resolves.toEqual([]);
    expect(selectDistinct).not.toHaveBeenCalled();
  });
});

describe('WowItemMetaService.backfillBossLoot (ROK-2176)', () => {
  it('resolves the backfill ids (≤ one retry batch) and clears the loot cache', async () => {
    const { db, limit, writes } = lootDb([19019, 16921]);
    const { svc, clearCache } = service(db, 200);
    await expect(svc.backfillBossLoot()).resolves.toBe(2);
    expect(limit).toHaveBeenCalledWith(WOWHEAD_RETRY_BATCH);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      status: 'resolved',
      tooltip: { env: 16, slotLabel: 'Hands', armor: 133 },
      tooltipVersion: WOWHEAD_TOOLTIP_PARSE_VERSION,
    });
    expect(clearCache).toHaveBeenCalledTimes(1);
  });

  it('nothing to backfill → no write and the cache is kept', async () => {
    const { db } = lootDb([]);
    const { svc, clearCache } = service(db, 200);
    await expect(svc.backfillBossLoot()).resolves.toBe(0);
    expect(clearCache).not.toHaveBeenCalled();
  });

  it('nothing to backfill but retryDue wrote rows → the loot cache is dropped (review MINOR 4)', async () => {
    const { db } = lootDb([]);
    const { svc, clearCache } = service(db, 200);
    await expect(svc.backfillBossLoot(3)).resolves.toBe(0);
    expect(clearCache).toHaveBeenCalledTimes(1);
  });

  it('kill switch off → no query, no fetch, cache kept', async () => {
    const { db, selectDistinct } = lootDb([19019]);
    const { svc, clearCache } = service(db, 200, 'false');
    await expect(svc.backfillBossLoot()).resolves.toBe(0);
    expect(selectDistinct).not.toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();
  });
});
