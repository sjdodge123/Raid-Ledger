/**
 * ROK-1454 D8/D9 — the LFM message table against real Postgres.
 *
 * The unit spec MODELS the partial unique index with a throw. Only this file
 * proves the index actually exists, and the two claims that depend on it are
 * the ones this story turns on:
 *
 *  - **AC2** — a second `state = 'open'` insert for the same game is rejected
 *    by the database. "One live message per group" is a Postgres invariant
 *    here, not a convention a future caller can forget.
 *  - **AC9** — once the row is closed, the SAME game can post again. That is
 *    the wedge D9 exists to prevent: a group that ends while the bot is down
 *    leaves an `open` row forever, and a non-partial index would then lock the
 *    game out permanently.
 *
 * `readConvertedGroup` is exercised here too, against the exact fixture round
 * 1 got wrong — converted AND past-expiry — with the live read as the control.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createFutureEvent,
} from '../../events/signups.integration.spec-helpers';
import {
  DAY_MS,
  createGame,
  createLineupMatch,
} from '../../lfg/lfg.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import {
  closeLfmMessage,
  findOpenLfmMessage,
  insertLfmMessage,
  latestConversionTarget,
  listOpenLfmMessages,
  readConvertedGroup,
  readLiveGroup,
  recordLfmRender,
  resolvePollTarget,
} from './lfm-embed.db-helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

let memberSeq = 0;

async function member(name: string): Promise<number> {
  memberSeq += 1;
  const { userId } = await createMemberAndLogin(
    testApp,
    `${name}${String(memberSeq)}`,
    `${name}${String(memberSeq)}@test.local`,
  );
  return userId;
}

/** Post a message for `gameId`, the way `LfmEmbedService.postNew` does. */
async function post(gameId: number, messageId: string): Promise<void> {
  await insertLfmMessage(testApp.db, {
    gameId,
    guildId: 'guild-1',
    channelId: 'chan-1',
    messageId,
    lastMemberCount: 2,
  });
}

/** Seed an intent in exactly the state `convertGroup` leaves behind. */
async function seedConverted(
  userId: number,
  gameId: number,
  target: { eventId?: number; pollId?: number },
  joinedMinutesAgo = 10,
): Promise<void> {
  await testApp.db.insert(schema.lfgIntents).values({
    userId,
    gameId,
    status: 'converted',
    visibility: 'local',
    createdAt: new Date(Date.now() - joinedMinutesAgo * 60_000),
    // Conversion never resets the clock — the group is historical on BOTH axes.
    expiresAt: new Date(Date.now() - 2 * DAY_MS),
    convertedToPollId: target.pollId ?? null,
    convertedToEventId: target.eventId ?? null,
  });
}

describe('lfg_group_messages — the one-live-message invariant (AC2)', () => {
  it('rejects a second open row for the same game', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await post(game.id, 'msg-1');

    // drizzle wraps the PG error; the SQLSTATE + constraint live on .cause
    // (the same shape `channel-bindings.integration.spec.ts` asserts).
    await expect(post(game.id, 'msg-2')).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: '23505',
        constraint_name: 'uq_lfg_group_messages_game_open',
      }),
    });
  });

  it('lets a DIFFERENT game post while the first is still open', async () => {
    const drg = await createGame(testApp, 'Deep Rock Galactic');
    const valheim = await createGame(testApp, 'Valheim');

    await post(drg.id, 'msg-1');
    await post(valheim.id, 'msg-2');

    expect(await listOpenLfmMessages(testApp.db)).toHaveLength(2);
  });

  it('AC9 — the same game can post again once its row is closed', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await post(game.id, 'msg-1');
    const first = await findOpenLfmMessage(testApp.db, game.id);

    await closeLfmMessage(testApp.db, first!.id, 'expired', 2);
    await post(game.id, 'msg-2');

    const second = await findOpenLfmMessage(testApp.db, game.id);
    expect(second?.messageId).toBe('msg-2');
    expect(await listOpenLfmMessages(testApp.db)).toHaveLength(1);
  });

  it('findOpenLfmMessage ignores rows that already reached a terminal state', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await post(game.id, 'msg-1');
    const row = await findOpenLfmMessage(testApp.db, game.id);

    await closeLfmMessage(testApp.db, row!.id, 'converted', 3);

    expect(await findOpenLfmMessage(testApp.db, game.id)).toBeNull();
    expect(await listOpenLfmMessages(testApp.db)).toEqual([]);
  });
});

describe('lfg_group_messages — the write paths', () => {
  it('recordLfmRender stamps the head-count and leaves the row open', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await post(game.id, 'msg-1');
    const row = await findOpenLfmMessage(testApp.db, game.id);

    await recordLfmRender(testApp.db, row!.id, 5);

    const after = await findOpenLfmMessage(testApp.db, game.id);
    expect(after).toMatchObject({ state: 'open', lastMemberCount: 5 });
    expect(after?.closedAt).toBeNull();
  });

  it('closeLfmMessage records the terminal state, the count and closed_at', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await post(game.id, 'msg-1');
    const row = await findOpenLfmMessage(testApp.db, game.id);

    await closeLfmMessage(testApp.db, row!.id, 'converted', 4);

    const [after] = await testApp.db
      .select()
      .from(schema.lfgGroupMessages)
      .where(eq(schema.lfgGroupMessages.id, row!.id));
    expect(after).toMatchObject({ state: 'converted', lastMemberCount: 4 });
    expect(after.closedAt).toBeInstanceOf(Date);
  });

  it('E13 — deleting the game cascades the message row away', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await post(game.id, 'msg-1');

    await testApp.db.delete(schema.games).where(eq(schema.games.id, game.id));

    expect(await listOpenLfmMessages(testApp.db)).toEqual([]);
  });
});

describe('the reads behind the terminal renders', () => {
  it('readConvertedGroup returns the roster the LIVE read cannot see (D5/D6a)', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const eventId = await createFutureEvent(testApp, adminToken);
    const bosco = await member('bosco');
    const karl = await member('karl');
    await seedConverted(bosco, game.id, { eventId }, 30);
    await seedConverted(karl, game.id, { eventId }, 20);

    const converted = await readConvertedGroup(testApp.db, game.id, {
      eventId,
    });
    expect(converted).toHaveLength(2);

    // CONTROL — the live read the round-1 defect used sees nobody.
    const live = await readLiveGroup(testApp.db, game);
    expect(live.members).toEqual([]);
  });
});

describe('reconcile provenance lookups (D9)', () => {
  it('latestConversionTarget finds the newest provenance for the game (D9)', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const oldEvent = await createFutureEvent(testApp, adminToken);
    const admin = testApp.seed.adminUser.id;
    const matchId = await createLineupMatch(testApp, admin, game.id);
    await seedConverted(await member('bosco'), game.id, { eventId: oldEvent });
    await seedConverted(await member('karl'), game.id, { pollId: matchId });

    await expect(latestConversionTarget(testApp.db, game.id)).resolves.toEqual({
      pollId: matchId,
    });
  });

  it('latestConversionTarget is null when the group simply expired (D9)', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await testApp.db.insert(schema.lfgIntents).values({
      userId: await member('bosco'),
      gameId: game.id,
      status: 'expired',
      visibility: 'local',
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    await expect(
      latestConversionTarget(testApp.db, game.id),
    ).resolves.toBeNull();
  });

  it('resolvePollTarget turns the match id into the /schedule/:matchId link parts', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    // A SECOND match on the SAME lineup, so `lineup_id` and `id` are
    // guaranteed to differ. Both tables are serial PKs, so a single-match
    // fixture in a truncated database can have `lineup.id === match.id` and
    // would pass even if the helper read the wrong column.
    const firstMatchId = await createLineupMatch(
      testApp,
      testApp.seed.adminUser.id,
      game.id,
    );
    const [first] = await testApp.db
      .select({ lineupId: schema.communityLineupMatches.lineupId })
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, firstMatchId));
    // `uq_lineup_match_game` is (lineup_id, game_id): the second match on
    // the same lineup must be for a DIFFERENT game.
    const otherGame = await createGame(testApp, 'Valheim');
    const [second] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: first.lineupId,
        gameId: otherGame.id,
        status: 'suggested',
        thresholdMet: false,
        voteCount: 0,
      })
      .returning();

    const target = await resolvePollTarget(testApp.db, second.id);

    expect(second.id).not.toBe(first.lineupId);
    // The route's FINAL segment is the MATCH id (`web/src/app-routes.tsx`);
    // a lineup id in that slot is a dead link no type-check can see.
    expect(target).toEqual({
      kind: 'poll',
      lineupId: first.lineupId,
      matchId: second.id,
    });
  });
});
