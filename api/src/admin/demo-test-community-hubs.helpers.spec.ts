/**
 * ROK-1870 §2.6 — the DEMO seed's users pass the A2 Discord gate: each gets a
 * unique synthetic snowflake (not a `local:` placeholder) and a fresh
 * `guild_member_seen_at`; a real linked id on an existing user is kept.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { isInDiscordGuild } from '../guilds/community/discord-guild-member.helpers';
import {
  SEED_USERNAMES,
  ensureSeedUser,
  seedDiscordId,
} from './demo-test-community-hubs.helpers';

let db: MockDb;
const typed = (): PostgresJsDatabase<typeof schema> => {
  const asDb: unknown = db;
  return asDb as PostgresJsDatabase<typeof schema>;
};

beforeEach(() => {
  db = createDrizzleMock();
});

describe('seedDiscordId', () => {
  it('gives every seed user a unique 18-digit snowflake starting with 9', () => {
    const ids = SEED_USERNAMES.map(seedDiscordId);
    expect(new Set(ids).size).toBe(SEED_USERNAMES.length);
    for (const id of ids) expect(id).toMatch(/^9\d{17}$/);
  });

  it('passes the A2 gate, while local:/unlinked: placeholders still fail', () => {
    const seen = { guildMemberSeenAt: new Date(), deactivatedAt: null };
    const id = seedDiscordId('community-leader');
    expect(isInDiscordGuild({ discordId: id, ...seen })).toBe(true);
    for (const p of ['local:community-seed:x', `unlinked:${id}`]) {
      expect(isInDiscordGuild({ discordId: p, ...seen })).toBe(false);
    }
  });

  it('refuses a username outside the seed set', () => {
    expect(() => seedDiscordId('someone-else')).toThrow();
  });
});

describe('ensureSeedUser', () => {
  it('creates a missing user with the synthetic id, seen now', async () => {
    db.limit.mockResolvedValueOnce([]);
    db.returning.mockResolvedValueOnce([{ id: 5 }]);
    expect(await ensureSeedUser(typed(), 'community-officer')).toBe(5);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'community-officer',
        discordId: seedDiscordId('community-officer'),
        role: 'member',
        guildMemberSeenAt: expect.any(Date),
      }),
    );
  });

  it('replaces a placeholder id on an existing user, keeping its role', async () => {
    db.limit.mockResolvedValueOnce([{ id: 8, discordId: 'local:demo@x' }]);
    expect(await ensureSeedUser(typed(), 'demo-member')).toBe(8);
    const patch: unknown = db.set.mock.calls[0]?.[0];
    expect(patch).toEqual({
      guildMemberSeenAt: expect.any(Date),
      deactivatedAt: null,
      discordId: seedDiscordId('demo-member'),
    });
  });

  it('keeps a real linked id on an existing user', async () => {
    db.limit.mockResolvedValueOnce([
      { id: 9, discordId: '112233445566778899' },
    ]);
    await ensureSeedUser(typed(), 'demo-member');
    const patch: unknown = db.set.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty('discordId');
  });
});
