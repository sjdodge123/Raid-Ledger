/**
 * ROK-1870 §2.6 — the seed resets its own fixture before re-seeding, and
 * never recreates or deactivates a seed user (live smoke sessions survive).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';
import { SEED_USERNAMES } from './demo-test-community-hubs.helpers';
import {
  ensureSeedUsers,
  findSeedFixtureHubs,
  muteSeedDiscordDms,
  resetSeedFixture,
  seedChannelPrefs,
} from './demo-test-community-hubs.reset';
import { seedHubNames, taggedBlurbLike } from './demo-test-community-hubs.tag';
import { hubNameKey } from '../guilds/community/community-proposals.queries';

/** SQL `LIKE` (no escapes; tags are `[a-z0-9-]`) as a RegExp. */
const likeToRegExp = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .split('%')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );

let db: MockDb;
const typed = (): PostgresJsDatabase<typeof schema> => {
  const asDb: unknown = db;
  return asDb as PostgresJsDatabase<typeof schema>;
};
const deletedTables = (): unknown[] => db.delete.mock.calls.map((c) => c[0]);

beforeEach(() => {
  db = createDrizzleMock();
});

describe('findSeedFixtureHubs', () => {
  it('unions hubs by seed name/proposer with hubs a seed user leads', async () => {
    db.where
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 2 }, { id: 3 }]);
    expect(await findSeedFixtureHubs(typed(), 7, [10, 11])).toEqual([1, 2, 3]);
    expect(db.innerJoin).toHaveBeenCalledTimes(1);
  });
});

describe('findSeedFixtureHubs with a tag (ROK-2030)', () => {
  it('selects only by the tag, never by seed proposer or leader', async () => {
    // A second (led-by-a-seed-user) query would add another tag's hub 9.
    db.where
      .mockResolvedValueOnce([{ id: 8 }])
      .mockResolvedValueOnce([{ id: 9 }]);
    expect(await findSeedFixtureHubs(typed(), 7, [10, 11], 'a-d-w00')).toEqual([
      8,
    ]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.innerJoin).not.toHaveBeenCalled();
  });

  it("tag A's match never reaches tag B's hubs, renamed or not", () => {
    const a = seedHubNames('hub-poll-desktop-w01');
    const b = seedHubNames('hub-poll-desktop-w011');
    const bKeys = Object.values(b).map(hubNameKey);
    for (const name of Object.values(a)) {
      expect({ name, inB: bKeys.includes(hubNameKey(name)) }).toEqual({
        name,
        inB: false,
      });
    }
    const aBlurb = likeToRegExp(taggedBlurbLike('hub-poll-desktop-w01'));
    expect(aBlurb.test(`${b.crew} — a seeded community hub.`)).toBe(false);
    expect(aBlurb.test(`${a.crew} — a seeded community hub.`)).toBe(true);
  });

  it('untagged names stay the plain seed names', () => {
    expect(seedHubNames(undefined)).toEqual({
      crew: 'Seed Crew',
      solo: 'Seed Solo',
      proposed: 'Seed Hopefuls',
      archived: 'Seed Old Guard',
      server: 'Seed Server',
      guild: 'Seed Guild',
    });
    expect(seedHubNames('x-1').crew).toBe('Seed Crew #x-1');
  });
});

describe('resetSeedFixture', () => {
  it("a tagged reset also deletes its hubs' events first", async () => {
    db.where
      .mockResolvedValueOnce([{ id: 4 }])
      .mockResolvedValueOnce([{ id: 5 }]);
    expect(await resetSeedFixture(typed(), 7, [10], 't-1')).toEqual([4]);
    expect(deletedTables()).toEqual([
      schema.events,
      schema.notifications,
      schema.hubCommunityMembers,
      schema.guilds,
    ]);
  });

  it('deletes the hub notices, memberships + bans, then the hubs', async () => {
    db.where
      .mockResolvedValueOnce([{ id: 4 }])
      .mockResolvedValueOnce([{ id: 5 }]);
    expect(await resetSeedFixture(typed(), 7, [10])).toEqual([4, 5]);
    expect(deletedTables()).toEqual([
      schema.notifications,
      schema.hubCommunityMembers,
      schema.guilds,
    ]);
  });

  it('deletes nothing when no fixture hub is left', async () => {
    db.where.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await resetSeedFixture(typed(), 7, [10])).toEqual([]);
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe('seed users', () => {
  it('turns every Discord channel off and keeps the other channels', () => {
    const prefs = seedChannelPrefs();
    for (const [type, ch] of Object.entries(prefs)) {
      expect({ type, discord: ch.discord }).toEqual({ type, discord: false });
    }
    expect(prefs.hub_proposal_reviewed.inApp).toBe(true);
  });

  it('upserts the muted prefs for every seed user', async () => {
    await muteSeedDiscordDms(typed(), [10, 11]);
    expect(db.insert).toHaveBeenCalledWith(schema.userNotificationPreferences);
    const rows: unknown = db.values.mock.calls[0]?.[0];
    expect(rows).toEqual([
      { userId: 10, channelPrefs: seedChannelPrefs() },
      { userId: 11, channelPrefs: seedChannelPrefs() },
    ]);
    expect(db.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: schema.userNotificationPreferences.userId,
      }),
    );
  });

  it('reuses existing rows (same ids), never deleting or inserting', async () => {
    for (const [i] of SEED_USERNAMES.entries()) {
      db.limit.mockResolvedValueOnce([{ id: 100 + i, discordId: null }]);
    }
    const ids = await ensureSeedUsers(typed());
    expect(ids).toEqual(SEED_USERNAMES.map((_, i) => 100 + i));
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    for (const [patch] of db.set.mock.calls) {
      expect(patch).toEqual(expect.objectContaining({ deactivatedAt: null }));
      expect(patch).not.toHaveProperty('role');
    }
  });
});
