/** ROK-1960 F5 — the shared per-user BG3 campaign lock statement. */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { bg3CampaignLockKey, lockBg3UserCampaigns } from './bg3-campaign-lock';

describe('lockBg3UserCampaigns', () => {
  it('takes pg_advisory_xact_lock on the one per-user key', async () => {
    const seen: SQL[] = [];
    const tx = {
      execute: jest.fn((q: SQL) => (seen.push(q), Promise.resolve([]))),
    };
    await lockBg3UserCampaigns(tx, 7);
    expect(seen).toHaveLength(1);
    const [q] = seen;
    if (!q) throw new Error('no statement');
    expect(new PgDialect().sqlToQuery(q)).toMatchObject({
      sql: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      params: ['bg3-campaigns:7'],
    });
    expect(bg3CampaignLockKey(7)).toBe('bg3-campaigns:7');
  });
});
