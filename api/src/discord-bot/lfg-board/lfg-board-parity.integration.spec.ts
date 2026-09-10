/**
 * ROK-1505 AC4 — the board mirrors the web chips, checkpoint by checkpoint.
 *
 * The invariant, stated once and asserted five times:
 *
 *   the set of `game_id` with an `open` row in `lfg_group_messages`
 *   == the set of `game_id` whose live ELIGIBLE intent count is >= 1.
 *
 * `lookingGameIds` composes `liveIntent()` + `eligibleUser()` — the SAME
 * predicates the chips' reads use — rather than writing its own WHERE. A
 * hand-written predicate that drifted from the chips' read would make this
 * test assert parity with itself; that is the most likely way to write a
 * green-but-vacuous version of it. The deactivated user's raw-seeded hand on
 * game 2 is what proves eligibility is composed, not assumed: a
 * `lookingGameIds` that forgot `eligibleUser()` would count game 2 while the
 * board (which never saw an event for it) does not.
 *
 * Discord I/O is stubbed at `LfgBoardService` — this asserts the ROW ledger,
 * not Discord. Its own file rather than an addition to
 * `lfm-embed.integration.spec.ts` (277/750) because it is one walk with five
 * checkpoints; a separate carrier is obvious if it flakes.
 *
 * Mutation proof (mandatory): put `LFM_FLOOR` back at the withdrawn branch of
 * `lfm-embed.views.ts` and checkpoint 3 fails on the set equality naming the
 * game id — `Expected: [<game1.id>] Received: []` — not on a timeout.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import {
  createGame,
  DAY_MS,
  deactivateUser,
  readIntent,
  setExpiresAt,
} from '../../lfg/lfg.integration.spec-helpers';
import { eligibleUser, liveIntent } from '../../lfg/lfg-query.helpers';
import { LfgExpiryService } from '../../lfg/lfg-expiry.service';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { setLfgBoardEnabled } from '../../settings/settings-lfg-board.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { LfmEmbedService } from '../lfm/lfm-embed.service';
import { LfgBoardService } from './lfg-board.service';

let testApp: TestApp;
let lfmEmbed: LfmEmbedService;
let threadSeq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  lfmEmbed = testApp.app.get(LfmEmbedService, { strict: false });
});

beforeEach(async () => {
  // The bot is "connected" and owns a guild with a resolvable forum; every
  // Discord write is a stub. The ledger is what this suite asserts.
  const botClient = testApp.app.get(DiscordBotClientService, {
    strict: false,
  });
  const board = testApp.app.get(LfgBoardService, { strict: false });
  jest.spyOn(botClient, 'isConnected').mockReturnValue(true);
  jest
    .spyOn(botClient, 'getGuild')
    .mockReturnValue({ id: 'guild-parity' } as never);
  jest
    .spyOn(board, 'resolveForum')
    .mockResolvedValue({ id: 'forum-parity' } as never);
  jest.spyOn(board, 'postThread').mockImplementation(() => {
    threadSeq += 1;
    return Promise.resolve({
      threadId: `thread-${String(threadSeq)}`,
      starterMessageId: `starter-${String(threadSeq)}`,
    });
  });
  jest.spyOn(board, 'editThread').mockResolvedValue(undefined);
  await setLfgBoardEnabled(
    testApp.app.get(SettingsService, { strict: false }),
    true,
  );
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  await loginAsAdmin(testApp.request, testApp.seed);
});

// ─── The two sides of the invariant ─────────────────────────────────────────

/** LEFT: every game with an `open` board row. */
async function openBoardGameIds(): Promise<number[]> {
  const rows = await testApp.db
    .select({ gameId: schema.lfgGroupMessages.gameId })
    .from(schema.lfgGroupMessages)
    .where(eq(schema.lfgGroupMessages.state, 'open'));
  return rows.map((r) => r.gameId).sort((a, b) => a - b);
}

/**
 * RIGHT: every game a chip would render for — the chips' OWN predicates,
 * composed, never re-typed.
 */
async function lookingGameIds(): Promise<number[]> {
  const rows = await testApp.db
    .selectDistinct({ gameId: schema.lfgIntents.gameId })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(and(liveIntent(new Date()), eligibleUser()));
  return rows.map((r) => r.gameId).sort((a, b) => a - b);
}

/** The invariant. `expected` is stated so a failure names the game ids. */
async function expectParity(expected: number[]): Promise<void> {
  const boardGames = await openBoardGameIds();
  const chipGames = await lookingGameIds();
  expect(chipGames).toEqual(expected);
  expect(boardGames).toEqual(chipGames);
}

// ─── Actions ────────────────────────────────────────────────────────────────

/** `POST /lfg` then drain the board's per-game chain so the row has landed. */
async function raiseHand(token: string, gameId: number): Promise<void> {
  const res = await testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
  expect(res.status).toBe(201);
  await lfmEmbed.settle(gameId);
}

/** `DELETE /lfg/:gameId` then drain the chain. */
async function withdraw(token: string, gameId: number): Promise<void> {
  const res = await testApp.request
    .delete(`/lfg/${String(gameId)}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(204);
  await lfmEmbed.settle(gameId);
}

/**
 * Run the expiry sweep, then drain the chain.
 *
 * Calls the @Cron handler DIRECTLY rather than `SchedulerRegistry
 * .getCronJob(...).fireOnTick()`. `fireOnTick` does not reliably propagate an
 * async handler's completion, so the sweep's transaction was still open when
 * `afterEach` ran `truncateAllTables` — and TRUNCATE needs ACCESS EXCLUSIVE,
 * so it blocked on the sweep's locks until the 120 s hook timeout. That wedged
 * the shared Nest app for the rest of the file: locally both hooks timed out at
 * 0% CPU, and in CI the app's HTTP server stopped answering, which surfaced as
 * `connect ECONNRESET 127.0.0.1:<port>` on this test (2026-09-09/10).
 *
 * Awaiting the method is what makes the sweep finished-when-it-returns.
 */
async function sweepExpiry(gameId: number): Promise<void> {
  await testApp.app
    .get(LfgExpiryService, { strict: false })
    .expireIntents();
  await lfmEmbed.settle(gameId);
}

/** Every `lfg_group_messages` row for a game, oldest first. */
async function boardRows(gameId: number) {
  return testApp.db
    .select()
    .from(schema.lfgGroupMessages)
    .where(eq(schema.lfgGroupMessages.gameId, gameId))
    .orderBy(schema.lfgGroupMessages.postedAt);
}

/**
 * A hand that fires NO event — the ineligible holder's stale row. Raw-seeded
 * because a deactivated user cannot authenticate to `POST /lfg`, and because
 * the point is a row the board never heard about.
 */
async function seedIneligibleHand(userId: number, gameId: number) {
  await testApp.db.insert(schema.lfgIntents).values({
    userId,
    gameId,
    status: 'active',
    expiresAt: new Date(Date.now() + 7 * DAY_MS),
  });
}

async function member(name: string) {
  return createMemberAndLogin(testApp, name, `${name}@parity.test.local`);
}

// ─── The walk ───────────────────────────────────────────────────────────────

describe('LFG board ⇄ web chips parity (ROK-1505 AC4)', () => {
  it('holds at hand 1 / hand 2 / withdraw→1 / withdraw→0 / expiry sweep', async () => {
    const [a, b, c, d] = await Promise.all([
      member('parity-a'),
      member('parity-b'),
      member('parity-c'),
      member('parity-d'),
    ]);
    const game1 = await createGame(testApp, 'Parity Game One', {
      cooptimusOnlineMax: 4,
    });
    const game2 = await createGame(testApp, 'Parity Game Two');
    // The composed-eligibility fixture: a live-looking row nobody may count.
    await deactivateUser(testApp, d.userId);
    await seedIneligibleHand(d.userId, game2.id);
    await expectParity([]);

    // 1 — the first hand posts (AC1). The story's whole point.
    await raiseHand(a.token, game1.id);
    await expectParity([game1.id]);
    const [firstRow] = await boardRows(game1.id);
    expect(firstRow).toMatchObject({
      state: 'open',
      postKind: 'forum',
      lastMemberCount: 1,
    });

    // 2 — the second hand upgrades IN PLACE: same row, same thread (AC2).
    await raiseHand(b.token, game1.id);
    await expectParity([game1.id]);
    const afterSecond = await boardRows(game1.id);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]).toMatchObject({
      id: firstRow.id,
      threadId: firstRow.threadId,
      state: 'open',
      lastMemberCount: 2,
    });

    // 3 — 2 -> 1 stays OPEN (D4). The mutation checkpoint: with the withdrawn
    // branch back on LFM_FLOOR this row closes and the sets diverge here.
    await withdraw(b.token, game1.id);
    await expectParity([game1.id]);
    const [afterWithdraw] = await boardRows(game1.id);
    expect(afterWithdraw).toMatchObject({
      id: firstRow.id,
      state: 'open',
      lastMemberCount: 1,
    });

    // 4 — 1 -> 0 closes (AC3). Zero hands is the only terminal count.
    await withdraw(a.token, game1.id);
    await expectParity([]);
    const [afterLast] = await boardRows(game1.id);
    expect(afterLast).toMatchObject({ id: firstRow.id, state: 'closed' });

    // 5 — a fresh hand on game 2, then the sweep with the clock past its TTL.
    await raiseHand(c.token, game2.id);
    await expectParity([game2.id]);
    const cIntent = await readIntent(testApp, c.userId, game2.id);
    expect(cIntent).not.toBeNull();
    await setExpiresAt(testApp, cIntent!.id, new Date(Date.now() - DAY_MS));
    await sweepExpiry(game2.id);
    await expectParity([]);
    const [game2Row] = await boardRows(game2.id);
    expect(game2Row).toMatchObject({ state: 'expired' });
  });

  it('a later hand after the last one withdrew creates a NEW post (AC3)', async () => {
    const [a, b] = await Promise.all([member('parity-e'), member('parity-f')]);
    const game = await createGame(testApp, 'Parity Game Three');

    await raiseHand(a.token, game.id);
    await withdraw(a.token, game.id);
    await raiseHand(b.token, game.id);

    await expectParity([game.id]);
    const rows = await boardRows(game.id);
    expect(rows.map((r) => r.state)).toEqual(['closed', 'open']);
    expect(rows[1].threadId).not.toBe(rows[0].threadId);
  });
});
