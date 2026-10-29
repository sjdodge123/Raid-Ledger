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
  CommunityHubsSeedSchema,
  SEED_USERNAMES,
  ensureSeedUser,
  seedDiscordId,
} from './demo-test-community-hubs.helpers';
import {
  crewUsernames,
  isTaggedCrewUsername,
} from './demo-test-community-hubs.crew';

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

describe('tagged crew users (ROK-2030)', () => {
  it('keeps the shared crew untagged and gives each tag its own users', () => {
    expect(crewUsernames(undefined)).toEqual([
      'community-officer',
      'community-member-1',
      'community-member-2',
      'community-member-3',
      'community-member-4',
    ]);
    expect(crewUsernames('hubs-nav-tablet-w00')).toEqual([
      'community-officer-hubs-nav-tablet-w00',
      'community-member-1-hubs-nav-tablet-w00',
      'community-member-2-hubs-nav-tablet-w00',
      'community-member-3-hubs-nav-tablet-w00',
      'community-member-4-hubs-nav-tablet-w00',
    ]);
  });

  it('recognises only tag-suffixed crew usernames', () => {
    expect(crewUsernames('t-1').map(isTaggedCrewUsername)).toEqual(
      Array(5).fill(true),
    );
    expect(crewUsernames(undefined).map(isTaggedCrewUsername)).toEqual(
      Array(5).fill(false),
    );
    expect(isTaggedCrewUsername('community-leader-t-1')).toBe(false);
    expect(isTaggedCrewUsername('community-member-5-t-1')).toBe(false);
  });

  it('gives tagged crew users deterministic, distinct, A2-passing snowflakes', () => {
    const a = crewUsernames('spec-a').map(seedDiscordId);
    const b = crewUsernames('spec-b').map(seedDiscordId);
    const shared = SEED_USERNAMES.map(seedDiscordId);
    expect(crewUsernames('spec-a').map(seedDiscordId)).toEqual(a);
    expect(new Set([...a, ...b, ...shared]).size).toBe(10 + shared.length);
    for (const id of [...a, ...b]) {
      expect(id).toMatch(/^98\d{16}$/);
      const user = {
        discordId: id,
        guildMemberSeenAt: new Date(),
        deactivatedAt: null,
      };
      expect(isInDiscordGuild(user)).toBe(true);
    }
  });

  it('still refuses a tagged leader (the leader stays shared)', () => {
    expect(() => seedDiscordId('community-leader-spec-a')).toThrow();
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

  it('returns the concurrent winner when its own insert loses the race', async () => {
    // Two parallel first-run seeds both miss the user; the loser's insert hits
    // users_discord_id_unique and must re-read the winner, not 500.
    db.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 42, discordId: seedDiscordId('community-leader') },
      ]);
    db.returning.mockResolvedValueOnce([]);
    expect(await ensureSeedUser(typed(), 'community-leader')).toBe(42);
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when the snowflake belongs to a non-seed user', async () => {
    db.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    db.returning.mockResolvedValueOnce([]);
    await expect(ensureSeedUser(typed(), 'community-solo')).rejects.toThrow(
      'community-solo: its snowflake is taken by another user',
    );
  });
});

describe('CommunityHubsSeedSchema (ROK-1893 P4)', () => {
  it('makes the tagged hub event opt-in', () => {
    expect(CommunityHubsSeedSchema.parse({ gameId: 3 })).toEqual({
      gameId: 3,
    });
    expect(CommunityHubsSeedSchema.parse({ withEvent: true })).toEqual({
      withEvent: true,
    });
  });

  it('accepts dedicatedGame with a tag (ROK-2030)', () => {
    expect(
      CommunityHubsSeedSchema.parse({ dedicatedGame: true, tag: 'own-a' }),
    ).toEqual({ dedicatedGame: true, tag: 'own-a' });
  });

  it('rejects a non-boolean withEvent', () => {
    const res = CommunityHubsSeedSchema.safeParse({ withEvent: 'yes' });
    expect(res.success).toBe(false);
  });
});
