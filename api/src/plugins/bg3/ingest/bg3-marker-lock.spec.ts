/** ROK-1960 P2-3 — the shared per-user BG3 marker lock statement. */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { bg3CampaignLockKey } from '../campaigns/bg3-campaign-lock';
import { bg3MarkerLockKey, lockBg3UserMarkers } from './bg3-marker-lock';

describe('lockBg3UserMarkers', () => {
  it('takes pg_advisory_xact_lock on the one per-user marker key', async () => {
    const seen: SQL[] = [];
    const tx = {
      execute: jest.fn((q: SQL) => (seen.push(q), Promise.resolve([]))),
    };
    await lockBg3UserMarkers(tx, 7);
    expect(seen).toHaveLength(1);
    const [q] = seen;
    if (!q) throw new Error('no statement');
    expect(new PgDialect().sqlToQuery(q)).toMatchObject({
      sql: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      params: ['bg3-save-markers:7'],
    });
  });

  it('never shares a key with the campaign lock', () => {
    expect(bg3MarkerLockKey(7)).toBe('bg3-save-markers:7');
    expect(bg3MarkerLockKey(7)).not.toBe(bg3CampaignLockKey(7));
  });
});
