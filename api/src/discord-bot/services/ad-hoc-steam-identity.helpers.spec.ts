/**
 * ROK-2298 (Q7): a banned or deactivated RL account never claims a SteamID on
 * the Quick Play roster — the lookup filters both moderation columns, so the
 * player stays an anonymous SteamID (no RL name, no Discord DM target).
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { resolveSteamIdentity } from './ad-hoc-steam-identity.helpers';

describe('resolveSteamIdentity — blocked accounts stay anonymous (ROK-2298)', () => {
  it('filters out banned and deactivated users in the lookup', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValueOnce([]);
    await expect(
      resolveSteamIdentity(db as never, '76561198000000001'),
    ).resolves.toBeNull();
    const where = db.where.mock.calls[0]?.[0] as SQL;
    const text = new PgDialect().sqlToQuery(where).sql;
    expect(text).toMatch(/"banned_at" is null/);
    expect(text).toMatch(/"deactivated_at" is null/);
  });

  it('still resolves an active linked player', async () => {
    const db = createDrizzleMock();
    const row = { userId: 7, discordId: 'd-7', displayName: 'Thrall' };
    db.limit.mockResolvedValueOnce([row]);
    await expect(
      resolveSteamIdentity(db as never, '76561198000000001'),
    ).resolves.toEqual(row);
  });
});
