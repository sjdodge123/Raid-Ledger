/**
 * ROK-1691 — a board post retires 7 days after it OPENED, whatever its
 * activity. People still looking post again.
 *
 * A +1 refreshes every hand on the group, so before this story a busy group's
 * post never left the board. The cap rides the existing 5-minute sweep: its one
 * UPDATE also lapses every live hand on a game whose open forum post opened on
 * or before `now - LFG_POST_MAX_AGE_DAYS`, and the per-game `expired` emit
 * takes the post through the ordinary expired render — terminal, so
 * `editThread` archives the thread into Older posts. No new message type.
 *
 * Discord I/O is stubbed at `LfgBoardService` (as in
 * `lfg-board-parity.integration.spec.ts`); the archive itself is `editThread`'s
 * `isTerminalRender` branch, already covered by ROK-1494. What this file proves
 * is that an AGED post reaches that branch and a young one does not.
 *
 * Mutation proof: drop the `inArray(... agedBoardPostGameIds(now))` arm from
 * `expireStaleIntents` and the first case fails on the hand statuses —
 * `Expected: ["expired", "expired"] Received: ["active", "active"]` — not on a
 * timeout.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import { createGame } from '../../lfg/lfg.integration.spec-helpers';
import { LfgExpiryService } from '../../lfg/lfg-expiry.service';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { setLfgBoardEnabled } from '../../settings/settings-lfg-board.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { LfmEmbedService } from '../lfm/lfm-embed.service';
import { isTerminalRender, type LfmGroupView } from '../lfm/lfm-embed.helpers';
import type { LfmMessageRow } from '../lfm/lfm-embed.db-helpers';
import { LfgBoardService } from './lfg-board.service';

const DAY_MS = 24 * 60 * 60 * 1000;

let testApp: TestApp;
let lfmEmbed: LfmEmbedService;
let edits: Array<{ row: LfmMessageRow; view: LfmGroupView }>;
let threadSeq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  lfmEmbed = testApp.app.get(LfmEmbedService, { strict: false });
});

beforeEach(async () => {
  edits = [];
  const botClient = testApp.app.get(DiscordBotClientService, {
    strict: false,
  });
  const board = testApp.app.get(LfgBoardService, { strict: false });
  jest.spyOn(botClient, 'isConnected').mockReturnValue(true);
  jest
    .spyOn(botClient, 'getGuild')
    .mockReturnValue({ id: 'guild-post-age' } as never);
  jest
    .spyOn(board, 'resolveForum')
    .mockResolvedValue({ id: 'forum-post-age' } as never);
  jest.spyOn(board, 'postThread').mockImplementation(() => {
    threadSeq += 1;
    return Promise.resolve({
      threadId: `thread-age-${String(threadSeq)}`,
      starterMessageId: `starter-age-${String(threadSeq)}`,
    });
  });
  jest.spyOn(board, 'editThread').mockImplementation((row, view) => {
    edits.push({ row, view });
    return Promise.resolve();
  });
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

/** `POST /lfg` then drain the board's per-game chain so the row has landed. */
async function raiseHand(token: string, gameId: number): Promise<void> {
  const res = await testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
  expect(res.status).toBe(201);
  await lfmEmbed.settle(gameId);
}

/** Run the real sweep, awaited, then drain the game's board chain. */
async function sweepExpiry(gameId: number): Promise<void> {
  await testApp.app.get(LfgExpiryService, { strict: false }).expireIntents();
  await lfmEmbed.settle(gameId);
}

/** Every `lfg_group_messages` row for a game, oldest first. */
async function boardRows(gameId: number): Promise<LfmMessageRow[]> {
  return testApp.db
    .select()
    .from(schema.lfgGroupMessages)
    .where(eq(schema.lfgGroupMessages.gameId, gameId))
    .orderBy(schema.lfgGroupMessages.postedAt);
}

/**
 * Pretend the post opened `days` ago. Written with the DB's own `now()`, the
 * same clock as the column's `DEFAULT now()` — a JS `Date` would store a UTC
 * wall-clock, which only agrees with production rows on a UTC database.
 */
async function backdatePost(rowId: string, days: number): Promise<void> {
  await testApp.db
    .update(schema.lfgGroupMessages)
    .set({ postedAt: sql`now() - make_interval(days => ${days}::int)` })
    .where(eq(schema.lfgGroupMessages.id, rowId));
}

/** The game's hands, oldest first. */
async function hands(gameId: number) {
  return testApp.db
    .select()
    .from(schema.lfgIntents)
    .where(eq(schema.lfgIntents.gameId, gameId))
    .orderBy(schema.lfgIntents.id);
}

/**
 * A two-hand group whose post opened `ageDays` ago and whose hands were JUST
 * refreshed by a +1 — so only the post's age can retire it.
 */
async function freshGroupOnPostAged(
  label: string,
  ageDays: number,
): Promise<{ gameId: number; row: LfmMessageRow }> {
  const [a, b] = await Promise.all([
    createMemberAndLogin(testApp, `${label}-a`, `${label}-a@test.dev`),
    createMemberAndLogin(testApp, `${label}-b`, `${label}-b@test.dev`),
  ]);
  const game = await createGame(testApp, `Post Age ${label}`);
  await raiseHand(a.token, game.id);
  const [row] = await boardRows(game.id);
  expect(row).toMatchObject({ state: 'open', postKind: 'forum' });
  await backdatePost(row.id, ageDays);
  await raiseHand(b.token, game.id);
  const live = await hands(game.id);
  expect(live.map((h) => h.status)).toEqual(['active', 'active']);
  // The +1 pushed both clocks days out: the hand clock alone keeps this alive.
  const soonest = Math.min(...live.map((h) => h.expiresAt.getTime()));
  expect(soonest).toBeGreaterThan(Date.now() + 6 * DAY_MS);
  edits = [];
  return { gameId: game.id, row };
}

describe('LFG board post-age cap (ROK-1691, integration)', () => {
  it('retires an 8-day-old post despite a fresh +1, and expires its hands', async () => {
    const { gameId, row } = await freshGroupOnPostAged('old', 8);

    await sweepExpiry(gameId);

    // 1 — THE checkpoint: without the post-age arm these stay `active`.
    const after = await hands(gameId);
    expect(after.map((h) => h.status)).toEqual(['expired', 'expired']);

    // 2 — the row closed as EXPIRED, like a post whose hands ran out.
    const [closed] = await boardRows(gameId);
    expect(closed.id).toBe(row.id);
    expect(closed.state).toBe('expired');
    expect(closed.closedAt).not.toBeNull();

    // 3 — one TERMINAL render reached the board: that is what archives the
    // thread into Older posts. Same view as a natural expiry, no new type.
    expect(edits.map((e) => [e.row.id, e.view.state])).toEqual([
      [row.id, 'expired'],
    ]);
    expect(isTerminalRender(edits[0].view.state)).toBe(true);
  });

  it('leaves a 3-day-old post with live hands untouched', async () => {
    const { gameId, row } = await freshGroupOnPostAged('young', 3);

    await sweepExpiry(gameId);

    const after = await hands(gameId);
    expect(after.map((h) => h.status)).toEqual(['active', 'active']);
    const [still] = await boardRows(gameId);
    expect(still).toMatchObject({ id: row.id, state: 'open', closedAt: null });
    expect(edits).toEqual([]);
  });
});
