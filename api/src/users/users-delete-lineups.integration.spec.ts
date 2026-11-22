/**
 * Deleting a user deletes the lineups they created. `hub_forum_threads.lineup_id`
 * and `.match_id` carry no FK, so the delete must close + detach the hub threads
 * of those lineups and of their scheduling polls itself — the same write the
 * discussion reconcilers make when a lineup or poll is gone
 * (`detachLineupThreads` / `detachPollThreads`). Other users' threads stay live.
 */
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { deleteUserTransaction } from './users-delete.helpers';
import { nonEmpty } from '../common/testing/narrow';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedUser(tag: string): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${tag}`, username: tag })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

async function seedGuild(): Promise<number> {
  const name = `Lineup Hub ${randomUUID().slice(0, 8)}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: 'wow_guild',
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: new Date(),
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

async function seedLineup(createdBy: number, guildId: number): Promise<number> {
  const [l] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'L',
        status: 'voting',
        visibility: 'public',
        guildId,
        createdBy,
        publicSlug: randomUUID().replace(/-/g, '').slice(0, 16),
      })
      .returning({ id: schema.communityLineups.id }),
    'lineup',
  );
  return l.id;
}

async function seedMatch(lineupId: number): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupMatches)
      .values({ lineupId, gameId: testApp.seed.game.id, status: 'scheduling' })
      .returning({ id: schema.communityLineupMatches.id }),
    'match',
  );
  return m.id;
}

type ThreadSubject = { lineupId: number } | { matchId: number };

async function seedThread(guildId: number, subject: ThreadSubject) {
  const [t] = nonEmpty(
    await testApp.db
      .insert(schema.hubForumThreads)
      .values({ guildId, title: 'Discuss', body: 'hello', ...subject })
      .returning({ id: schema.hubForumThreads.id }),
    'thread',
  );
  return t.id;
}

async function threadStates(ids: number[]) {
  const t = schema.hubForumThreads;
  const rows = await testApp.db
    .select({
      id: t.id,
      detachedAt: t.eventDetachedAt,
      closesAt: t.writeClosesAt,
    })
    .from(t)
    .where(inArray(t.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

describe('deleteUserTransaction — lineup hub threads', () => {
  it('closes + detaches the threads of the deleted user’s lineups and polls only', async () => {
    const [targetId, otherId, guildId] = [
      await seedUser('lineup-owner'),
      await seedUser('lineup-survivor'),
      await seedGuild(),
    ];
    const ownLineupId = await seedLineup(targetId, guildId);
    const ownMatchId = await seedMatch(ownLineupId);
    const otherLineupId = await seedLineup(otherId, guildId);
    const lineupThread = await seedThread(guildId, { lineupId: ownLineupId });
    const pollThread = await seedThread(guildId, { matchId: ownMatchId });
    const survivor = await seedThread(guildId, { lineupId: otherLineupId });
    const before = Date.now();

    await deleteUserTransaction(testApp.db, targetId, otherId);

    const states = await threadStates([lineupThread, pollThread, survivor]);
    const view = (id: number) => {
      const s = states.get(id);
      return {
        exists: s !== undefined,
        detached: (s?.detachedAt?.getTime() ?? 0) >= before,
        closesWithDetach:
          s?.closesAt?.getTime() === s?.detachedAt?.getTime() &&
          s?.closesAt !== null,
      };
    };
    const closed = { exists: true, detached: true, closesWithDetach: true };
    expect({ lineup: view(lineupThread), poll: view(pollThread) }).toEqual({
      lineup: closed,
      poll: closed,
    });
    expect(states.get(survivor)).toMatchObject({
      detachedAt: null,
      closesAt: null,
    });
  });
});
