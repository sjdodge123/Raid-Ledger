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
import { eq, sql } from 'drizzle-orm';
import { convertGroup } from '../../lfg/lfg-write.helpers';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { LfmEmbedService } from './lfm-embed.service';
import {
  closeLfmMessage,
  conversionSincePosted,
  findOpenLfmMessage,
  insertLfmMessage,
  latestConversionTarget,
  listOpenLfmMessages,
  listUntrackedLfmGames,
  readConvertedGroup,
  readLiveGroup,
  recordLfmRender,
  resolvePollTarget,
} from './lfm-embed.db-helpers';
import { at, nonEmpty } from '../../common/testing/narrow';

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

/** Seed a live hand — `active`, unexpired — for `userId` on `gameId`. */
async function seedActive(userId: number, gameId: number): Promise<void> {
  await testApp.db.insert(schema.lfgIntents).values({
    userId,
    gameId,
    status: 'active',
    visibility: 'local',
    expiresAt: new Date(Date.now() + 7 * DAY_MS),
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

    const [after] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.lfgGroupMessages)
        .where(eq(schema.lfgGroupMessages.id, row!.id)),
      'after',
    );
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

    await expect(
      latestConversionTarget(
        testApp.db,
        game.id,
        new Date(Date.now() - 30 * DAY_MS),
      ),
    ).resolves.toEqual({ pollId: matchId });
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
      latestConversionTarget(
        testApp.db,
        game.id,
        new Date(Date.now() - 30 * DAY_MS),
      ),
    ).resolves.toBeNull();
  });

  it('ignores provenance older than the message — a previous group of the same game', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const oldEvent = await createFutureEvent(testApp, adminToken);
    // Converted, and expired two days ago (seedConverted's clock): a corpse
    // from a group that ended before THIS message was posted.
    await seedConverted(await member('bosco'), game.id, { eventId: oldEvent });

    await expect(
      latestConversionTarget(testApp.db, game.id, new Date()),
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
    const [first] = nonEmpty(
      await testApp.db
        .select({ lineupId: schema.communityLineupMatches.lineupId })
        .from(schema.communityLineupMatches)
        .where(eq(schema.communityLineupMatches.id, firstMatchId)),
      'first',
    );
    // `uq_lineup_match_game` is (lineup_id, game_id): the second match on
    // the same lineup must be for a DIFFERENT game.
    const otherGame = await createGame(testApp, 'Valheim');
    const [second] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineupMatches)
        .values({
          lineupId: first.lineupId,
          gameId: otherGame.id,
          status: 'suggested',
          thresholdMet: false,
          voteCount: 0,
        })
        .returning(),
      'second',
    );

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

describe('E1 reconcile — live LFM groups with no message', () => {
  // ROK-1505 D4: the floor is `LIVE_FLOOR` (one hand) — a one-hand group
  // whose first post was lost to a restart is healed too, so the solo game
  // is listed alongside the two-hand one. Tracked and dead games stay out.
  it('lists every game with a live hand and no open row, and nothing else', async () => {
    const untracked = await createGame(testApp, 'Deep Rock Galactic');
    const tracked = await createGame(testApp, 'Valheim');
    const solo = await createGame(testApp, 'Lethal Company');
    const dead = await createGame(testApp, 'Helldivers 2');
    await seedActive(await member('bosco'), untracked.id);
    await seedActive(await member('karl'), untracked.id);
    await seedActive(await member('mia'), tracked.id);
    await seedActive(await member('ola'), tracked.id);
    await post(tracked.id, 'msg-1');
    await seedActive(await member('sol'), solo.id);
    await seedConverted(await member('ann'), dead.id, {}, 5);
    await seedConverted(await member('bea'), dead.id, {}, 5);

    const listed = await listUntrackedLfmGames(testApp.db);

    expect([...listed].sort((a, b) => a - b)).toEqual(
      [solo.id, untracked.id].sort((a, b) => a - b),
    );
  });

  it('still lists a game whose one eligible hand sits beside a deactivated one', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const gone = await member('gone');
    await seedActive(gone, game.id);
    await seedActive(await member('karl'), game.id);
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, gone));

    // One eligible hand clears LIVE_FLOOR on its own.
    await expect(listUntrackedLfmGames(testApp.db)).resolves.toEqual([game.id]);
  });

  it('does not count a deactivated hand toward the floor', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const gone = await member('gone');
    await seedActive(gone, game.id);
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, gone));

    // The only hand is ineligible: eligibility composes into the live
    // predicate, so the floor is NOT met even though a row exists.
    await expect(listUntrackedLfmGames(testApp.db)).resolves.toEqual([]);
  });

  it('re-lists a game once its row is closed while two hands are still live', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await seedActive(await member('bosco'), game.id);
    await seedActive(await member('karl'), game.id);
    await post(game.id, 'msg-1');
    expect(await listUntrackedLfmGames(testApp.db)).toEqual([]);
    const row = await findOpenLfmMessage(testApp.db, game.id);
    await closeLfmMessage(testApp.db, row!.id, 'expired', 2);

    await expect(listUntrackedLfmGames(testApp.db)).resolves.toEqual([game.id]);
  });
});

/** The writers' stamp — the UPDATE's own instant (Codex P2), not tx start. */
const STAMP_NOW = sql`statement_timestamp()`;
/** An older group's corpse: converted well outside `OWN_CONVERSION_GRACE`. */
const STAMP_10_MIN_AGO = sql`statement_timestamp() - interval '10 minutes'`;

/**
 * Seed a converted intent stamped by the DB clock, exactly as every
 * conversion writer stamps it since TDB:953 (`statement_timestamp()`).
 */
async function seedStamped(
  userId: number,
  gameId: number,
  eventId: number,
  expiresAt: Date,
  stamp = STAMP_NOW,
): Promise<void> {
  await testApp.db.insert(schema.lfgIntents).values({
    userId,
    gameId,
    status: 'converted',
    visibility: 'local',
    expiresAt,
    convertedToEventId: eventId,
    convertedAt: stamp,
  });
}

/** The game's one open row, which the case needs to exist. */
async function openRowFor(gameId: number) {
  const row = await findOpenLfmMessage(testApp.db, gameId);
  if (!row) throw new Error(`no open LFM row for game ${String(gameId)}`);
  return row;
}

describe('converted_at — the provenance stamp the reconcile trusts (TDB:953)', () => {
  // conversionSincePosted compares two DB-clock stamps in SQL. The
  // latestConversionTarget cases pass a JS Date and decide on `expires_at`
  // (also JS-written), so the DB session TimeZone cannot flip them.
  it('conversionSincePosted ignores a conversion stamped BEFORE the post and finds one after', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const oldEvent = await createFutureEvent(testApp, adminToken);
    const newEvent = await createFutureEvent(testApp, adminToken);
    const future = new Date(Date.now() + 7 * DAY_MS);
    // An older group that converted before this message existed — its hands
    // have NOT expired, so the old `expires_at` bound alone would admit it.
    await seedStamped(
      await member('bosco'),
      game.id,
      oldEvent,
      future,
      STAMP_10_MIN_AGO,
    );
    await post(game.id, 'msg-1');
    const row = await openRowFor(game.id);

    await expect(conversionSincePosted(testApp.db, row)).resolves.toBeNull();
    // A legacy (NULL-stamped) conversion never matches the stamp check.
    await seedConverted(await member('karl'), game.id, { eventId: newEvent });
    await expect(conversionSincePosted(testApp.db, row)).resolves.toBeNull();

    await seedStamped(await member('doretta'), game.id, newEvent, future);
    await expect(conversionSincePosted(testApp.db, row)).resolves.toEqual({
      eventId: newEvent,
    });
  });

  it('latestConversionTarget: a stamp before postedAfter still matches while its hands outlive the post', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const eventId = await createFutureEvent(testApp, adminToken);
    await seedStamped(
      await member('bosco'),
      game.id,
      eventId,
      new Date(Date.now() + 7 * DAY_MS),
    );

    // The LFG-Now spawn stamps its conversion BEFORE its row's `posted_at`;
    // the `expires_at` leg is what still ties it to the row (review MAJOR).
    await expect(
      latestConversionTarget(
        testApp.db,
        game.id,
        new Date(Date.now() + 60 * 60_000),
      ),
    ).resolves.toEqual({ eventId });
  });

  it('latestConversionTarget keeps the expires_at fallback for a NULL-stamped legacy row', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const eventId = await createFutureEvent(testApp, adminToken);
    await testApp.db.insert(schema.lfgIntents).values({
      userId: await member('bosco'),
      gameId: game.id,
      status: 'converted',
      visibility: 'local',
      expiresAt: new Date(Date.now() + 7 * DAY_MS),
      convertedToEventId: eventId,
    });

    await expect(
      latestConversionTarget(
        testApp.db,
        game.id,
        new Date(Date.now() + 60 * 60_000),
      ),
    ).resolves.toEqual({ eventId });
  });
});

describe('conversionSincePosted — scoping and order (TDB:953 review)', () => {
  it('a conversion for ANOTHER game never closes this row; the EARLIEST of two wins', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const other = await createGame(testApp, 'Valheim');
    const first = await createFutureEvent(testApp, adminToken);
    const second = await createFutureEvent(testApp, adminToken);
    const future = new Date(Date.now() + 7 * DAY_MS);
    await post(game.id, 'msg-1');
    const row = await openRowFor(game.id);

    await seedStamped(await member('bosco'), other.id, first, future);
    await expect(conversionSincePosted(testApp.db, row)).resolves.toBeNull();

    // Two stamped conversions after posting, in statement order: the first
    // ended THIS row's group; the second belongs to a group formed after.
    await seedStamped(await member('karl'), game.id, first, future);
    await seedStamped(await member('doretta'), game.id, second, future);
    await expect(conversionSincePosted(testApp.db, row)).resolves.toEqual({
      eventId: first,
    });
    await expect(
      latestConversionTarget(testApp.db, game.id, row.postedAt),
    ).resolves.toEqual({ eventId: first });
  });

  it('a stamp within the grace BEFORE the post still counts — the LFG-Now spawn order', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const eventId = await createFutureEvent(testApp, adminToken);
    const future = new Date(Date.now() + 7 * DAY_MS);
    await seedStamped(await member('bosco'), game.id, eventId, future);
    await post(game.id, 'msg-1');

    await expect(
      conversionSincePosted(testApp.db, await openRowFor(game.id)),
    ).resolves.toEqual({ eventId });
  });
});

/**
 * TDB:953 Codex P2 (r2) — an older group's corpse AND this row's own later
 * conversion both match; the flat `converted_at ASC` returned the corpse.
 */
describe('latestConversionTarget — own later conversion vs an older corpse (Codex P2)', () => {
  it("returns the row's OWN later conversion, not the corpse the expires_at leg admits", async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const oldEvent = await createFutureEvent(testApp, adminToken);
    const ownEvent = await createFutureEvent(testApp, adminToken);
    const future = new Date(Date.now() + 7 * DAY_MS);
    // Converted before this message existed; its hands outlive the post.
    const bosco = await member('bosco');
    await seedStamped(bosco, game.id, oldEvent, future, STAMP_10_MIN_AGO);
    await post(game.id, 'msg-1');
    const row = await openRowFor(game.id);
    await seedStamped(await member('karl'), game.id, ownEvent, future);

    await expect(
      latestConversionTarget(testApp.db, game.id, row.postedAt),
    ).resolves.toEqual({ eventId: ownEvent });
  });
});

describe('conversionSincePosted — strictly-later vs a grace-window corpse (Codex P2)', () => {
  it('a conversion strictly after the post outranks one stamped inside the grace', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const corpseEvent = await createFutureEvent(testApp, adminToken);
    const ownEvent = await createFutureEvent(testApp, adminToken);
    const future = new Date(Date.now() + 7 * DAY_MS);
    // Stamped just before the post: inside OWN_CONVERSION_GRACE.
    await seedStamped(await member('bosco'), game.id, corpseEvent, future);
    await post(game.id, 'msg-1');
    const row = await openRowFor(game.id);
    await seedStamped(await member('karl'), game.id, ownEvent, future);

    await expect(conversionSincePosted(testApp.db, row)).resolves.toEqual({
      eventId: ownEvent,
    });
  });
});

/**
 * TDB:953 case (1) — the whole CONNECTED walk against real Postgres.
 *
 * Group A's message is posted, A converts through the real `convertGroup`
 * while no CONNECTED handler runs, and group B forms for the SAME game above
 * the floor. Discord I/O is stubbed at `DiscordBotClientService`; everything
 * else — the reconcile, the close, the partial unique index, the untracked
 * re-post — is the production path.
 *
 * Mutation proof: delete the `conversionSincePosted` check from
 * `reconcileView` and the FIRST assertion fails on the row state —
 * `Expected: "converted" Received: "open"` — because the live read (B, two
 * hands) passes the floor and A's message is edited in place as B; with A
 * still open the index keeps B untracked, so no second post happens either.
 */
/** Stub Discord I/O at `DiscordBotClientService`; everything else is real. */
function stubDiscord() {
  const client = testApp.app.get(DiscordBotClientService, { strict: false });
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuildId').mockReturnValue('guild-1');
  jest
    .spyOn(
      testApp.app.get(SettingsService, { strict: false }),
      'getDiscordBotDefaultChannel',
    )
    .mockResolvedValue('chan-1');
  return {
    edit: jest
      .spyOn(client, 'editEmbed')
      .mockResolvedValue({ id: 'msg-a' } as never),
    send: jest
      .spyOn(client, 'sendEmbed')
      .mockResolvedValue({ id: 'msg-b' } as never),
  };
}

/** Fire CONNECTED, then read back every message row for the game. */
async function reconnect(gameId: number) {
  await testApp.app.get(LfmEmbedService, { strict: false }).onConnected();
  return testApp.db
    .select()
    .from(schema.lfgGroupMessages)
    .where(eq(schema.lfgGroupMessages.gameId, gameId));
}

describe('reconnect after a conversion the bot missed (TDB:953)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('closes the converted group row as SCHEDULED and posts the new group fresh', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const eventId = await createFutureEvent(testApp, adminToken);
    await seedActive(await member('bosco'), game.id);
    await seedActive(await member('karl'), game.id);
    await post(game.id, 'msg-a');
    await expect(convertGroup(testApp.db, game.id, { eventId })).resolves.toBe(
      2,
    );
    await seedActive(await member('doretta'), game.id);
    await seedActive(await member('mol'), game.id);
    const { edit, send } = stubDiscord();

    const rows = await reconnect(game.id);

    expect(rows.find((r) => r.messageId === 'msg-a')?.state).toBe('converted');
    expect(edit).toHaveBeenCalledTimes(1);
    const [, editedId, embed] = at(edit.mock.calls, 0);
    expect(editedId).toBe('msg-a');
    expect(embed.data.author?.name).toBe('■ SCHEDULED · 2 players');
    expect(send).toHaveBeenCalledTimes(1);
    expect(await findOpenLfmMessage(testApp.db, game.id)).toMatchObject({
      messageId: 'msg-b',
      lastMemberCount: 2,
    });
  });
});

/**
 * TDB:953 review MAJOR — the LFG-Now spawn order: the group converts
 * (`convertGroup` on the spawn's own path) while `postText` still awaits
 * `sendEmbed`, so the stamp lands BEFORE its own row's `posted_at`.
 *
 * Mutation proof: on 85ca11d65 (strict `converted_at > posted_at`, the
 * `expires_at` leg only for NULL stamps) the first case's first assertion
 * fails `Expected: "converted" Received: "expired"`, and the second's fails
 * `Expected: "converted" Received: "open"` (B passes the floor, A's message
 * is edited as B). Dropping only `OWN_CONVERSION_GRACE` reddens the second
 * case alone. Dropping only the `expires_at` leg reddens neither (the
 * window catches both): the helper case "a stamp before postedAfter still
 * matches…" above pins that leg.
 */
describe('reconnect when the conversion was stamped BEFORE its row (TDB:953)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Group A converts, THEN its row is inserted — the spawn order. */
  async function spawnOrdered(): Promise<number> {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const eventId = await createFutureEvent(testApp, adminToken);
    const future = new Date(Date.now() + 7 * DAY_MS);
    await seedStamped(await member('bosco'), game.id, eventId, future);
    await seedStamped(await member('karl'), game.id, eventId, future);
    await post(game.id, 'msg-a');
    return game.id;
  }

  it('closes the row SCHEDULED, not EXPIRED, once the group has ended', async () => {
    const gameId = await spawnOrdered();
    const { edit, send } = stubDiscord();

    const rows = await reconnect(gameId);

    expect(rows.find((r) => r.messageId === 'msg-a')?.state).toBe('converted');
    expect(edit).toHaveBeenCalledTimes(1);
    const [, editedId, embed] = at(edit.mock.calls, 0);
    expect(editedId).toBe('msg-a');
    expect(embed.data.author?.name).toBe('■ SCHEDULED · 2 players');
    expect(send).not.toHaveBeenCalled();
  });

  it('closes the row SCHEDULED even with a NEW group above the floor, and posts it fresh', async () => {
    const gameId = await spawnOrdered();
    await seedActive(await member('doretta'), gameId);
    await seedActive(await member('mol'), gameId);
    const { edit, send } = stubDiscord();

    const rows = await reconnect(gameId);

    expect(rows.find((r) => r.messageId === 'msg-a')?.state).toBe('converted');
    const [, editedId, embed] = at(edit.mock.calls, 0);
    expect(editedId).toBe('msg-a');
    expect(embed.data.author?.name).toBe('■ SCHEDULED · 2 players');
    expect(send).toHaveBeenCalledTimes(1);
    expect(await findOpenLfmMessage(testApp.db, gameId)).toMatchObject({
      messageId: 'msg-b',
      lastMemberCount: 2,
    });
  });
});
