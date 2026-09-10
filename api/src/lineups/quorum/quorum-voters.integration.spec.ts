/**
 * Expected-voter resolution (ROK-1150 item 2).
 *
 * `loadExpectedVoters` and `loadQuorumGatingVoters` were only covered
 * indirectly, through the auto-advance integration tests. The ROK-1258 hybrid
 * policy in particular — drop non-participating invitees once the phase
 * deadline passes, but never the creator — is subtle enough to deserve direct
 * assertions, and its "full roster" sibling is used for DM fan-out where
 * narrowing the set would silently under-notify.
 *
 * Written against a real DB rather than drizzle-mock: the public path fans two
 * SELECTs through Promise.all, and pinning mock call order would assert the
 * implementation's shape instead of its behaviour.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import {
  loadExpectedVoters,
  loadQuorumGatingVoters,
} from './quorum-voters.helpers';

type LineupRow = typeof schema.communityLineups.$inferSelect;

const PAST = new Date(Date.now() - 60 * 60 * 1000);
const FUTURE = new Date(Date.now() + 60 * 60 * 1000);

describe('quorum voter resolution (ROK-1150)', () => {
  let testApp: TestApp;
  let creator: number;
  let alice: number;
  let bob: number;
  let gameId: number;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function makeUser(tag: string): Promise<number> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}-${Math.random().toString(36).slice(2, 8)}`,
        username: tag,
        role: 'member',
      })
      .returning();
    return user.id;
  }

  beforeEach(async () => {
    creator = await makeUser('quorum-creator');
    alice = await makeUser('quorum-alice');
    bob = await makeUser('quorum-bob');
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'Quorum Game',
        slug: `quorum-game-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning();
    gameId = game.id;
  });

  async function makeLineup(
    visibility: 'public' | 'private',
    status: 'building' | 'voting',
    phaseDeadline: Date | null,
  ): Promise<LineupRow> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Quorum Test',
        createdBy: creator,
        visibility,
        status,
        phaseDeadline,
        publicSlug: Math.random().toString(36).slice(2, 12),
      })
      .returning();
    return lineup;
  }

  async function invite(lineupId: number, userIds: number[]): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupInvitees)
      .values(userIds.map((userId) => ({ lineupId, userId })));
  }

  async function nominate(lineupId: number, userId: number): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupEntries)
      .values({ lineupId, gameId, nominatedBy: userId });
  }

  async function vote(lineupId: number, userId: number): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupVotes)
      .values({ lineupId, gameId, userId });
  }

  const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

  describe('public lineups', () => {
    it('counts anyone who nominated or voted', async () => {
      const lineup = await makeLineup('public', 'voting', FUTURE);
      await nominate(lineup.id, alice);
      await vote(lineup.id, bob);

      expect(sorted(await loadExpectedVoters(testApp.db, lineup))).toEqual(
        sorted([alice, bob]),
      );
    });

    it('does not gate on a creator who never participated', async () => {
      const lineup = await makeLineup('public', 'voting', FUTURE);
      await vote(lineup.id, alice);

      // Otherwise no public lineup could ever reach quorum.
      expect(await loadExpectedVoters(testApp.db, lineup)).toEqual([alice]);
    });

    it('counts a participant once even if they both nominated and voted', async () => {
      const lineup = await makeLineup('public', 'voting', FUTURE);
      await nominate(lineup.id, alice);
      await vote(lineup.id, alice);

      expect(await loadExpectedVoters(testApp.db, lineup)).toEqual([alice]);
    });

    it('ignores the deadline policy entirely', async () => {
      const lineup = await makeLineup('public', 'voting', PAST);
      await nominate(lineup.id, alice);

      // The ROK-1258 grace path is private-only.
      expect(await loadQuorumGatingVoters(testApp.db, lineup)).toEqual([alice]);
    });
  });

  describe('private lineups', () => {
    it('gates on the whole roster regardless of participation', async () => {
      const lineup = await makeLineup('private', 'voting', FUTURE);
      await invite(lineup.id, [alice, bob]);

      expect(sorted(await loadExpectedVoters(testApp.db, lineup))).toEqual(
        sorted([creator, alice, bob]),
      );
    });

    it('keeps the full roster before the deadline passes', async () => {
      const lineup = await makeLineup('private', 'voting', FUTURE);
      await invite(lineup.id, [alice, bob]);
      await vote(lineup.id, alice);

      expect(sorted(await loadQuorumGatingVoters(testApp.db, lineup))).toEqual(
        sorted([creator, alice, bob]),
      );
    });

    it('drops non-voting invitees once the voting deadline passes', async () => {
      const lineup = await makeLineup('private', 'voting', PAST);
      await invite(lineup.id, [alice, bob]);
      await vote(lineup.id, alice);

      expect(sorted(await loadQuorumGatingVoters(testApp.db, lineup))).toEqual(
        sorted([creator, alice]),
      );
    });

    it('never drops the creator, even when they have not voted', async () => {
      const lineup = await makeLineup('private', 'voting', PAST);
      await invite(lineup.id, [alice, bob]);

      // A solo creator still gates quorum.
      expect(await loadQuorumGatingVoters(testApp.db, lineup)).toEqual([
        creator,
      ]);
    });

    it('uses nominations, not votes, to judge participation while building', async () => {
      const lineup = await makeLineup('private', 'building', PAST);
      await invite(lineup.id, [alice, bob]);
      await nominate(lineup.id, alice);
      await vote(lineup.id, bob);

      // bob voted but never nominated, so he is not a building-phase participant.
      expect(sorted(await loadQuorumGatingVoters(testApp.db, lineup))).toEqual(
        sorted([creator, alice]),
      );
    });

    it('keeps the full roster when no deadline is set', async () => {
      const lineup = await makeLineup('private', 'voting', null);
      await invite(lineup.id, [alice, bob]);

      // A NULL deadline disables the grace path — removing an invitee is the
      // only way to unblock such a lineup.
      expect(sorted(await loadQuorumGatingVoters(testApp.db, lineup))).toEqual(
        sorted([creator, alice, bob]),
      );
    });

    it('falls back to votingDeadline when phaseDeadline is null', async () => {
      const lineup = await makeLineup('private', 'voting', null);
      await testApp.db
        .update(schema.communityLineups)
        .set({ votingDeadline: PAST })
        .where(eq(schema.communityLineups.id, lineup.id));
      await invite(lineup.id, [alice, bob]);
      await vote(lineup.id, alice);

      const [fresh] = await testApp.db
        .select()
        .from(schema.communityLineups)
        .where(eq(schema.communityLineups.id, lineup.id));

      expect(sorted(await loadQuorumGatingVoters(testApp.db, fresh))).toEqual(
        sorted([creator, alice]),
      );
    });
  });
});
