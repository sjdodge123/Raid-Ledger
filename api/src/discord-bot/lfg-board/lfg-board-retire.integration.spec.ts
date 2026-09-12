/**
 * ROK-1523 — switching the board OFF retires its live posts.
 *
 * The walk is the ticket's own test line: enable, put N open posts on the
 * board, disable, and then assert the three things that have to be true at
 * once — every post got a TERMINAL farewell render, every row is closed, and
 * the groups themselves are untouched and still reachable on the web.
 *
 * Driven through `LfgBoardToggleListener.onToggled` rather than the admin
 * `PUT`, so the assertion is not racing `EventEmitter2`'s dispatch: the
 * listener is the unit the endpoint emits into, and calling it directly covers
 * the same wiring deterministically.
 *
 * Discord I/O is stubbed at `LfgBoardService` — the archive itself is
 * `editThread`'s existing `isTerminalRender` branch, which ROK-1494 already
 * covers. What is NEW, and what this file exists to prove, is that the disable
 * path reaches that branch at all and closes the ledger behind it.
 *
 * Mutation proof (mandatory): put the ROK-1471 E4 early `return` back in
 * `lfg-board-toggle.listener.ts::onToggled` and checkpoint 2 fails on the row
 * state — `Expected: "closed" Received: "open"` — not on a timeout.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import { createGame } from '../../lfg/lfg.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { setLfgBoardEnabled } from '../../settings/settings-lfg-board.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { LfmEmbedService } from '../lfm/lfm-embed.service';
import {
  buildLfmEmbed,
  type LfmGroupView,
} from '../lfm/lfm-embed.helpers';
import type { LfmMessageRow } from '../lfm/lfm-embed.db-helpers';
import type { EmbedContext } from '../services/discord-embed.factory';
import { LFG_BOARD_RETIRED_NOTE } from './lfg-board.constants';
import { LfgBoardService } from './lfg-board.service';
import { LfgBoardToggleListener } from './lfg-board-toggle.listener';

let testApp: TestApp;
let lfmEmbed: LfmEmbedService;
let toggle: LfgBoardToggleListener;
let edits: Array<{ row: LfmMessageRow; view: LfmGroupView }>;
let context: EmbedContext;
let threadSeq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  lfmEmbed = testApp.app.get(LfmEmbedService, { strict: false });
  toggle = testApp.app.get(LfgBoardToggleListener, { strict: false });
});

beforeEach(async () => {
  edits = [];
  const botClient = testApp.app.get(DiscordBotClientService, { strict: false });
  const board = testApp.app.get(LfgBoardService, { strict: false });
  jest.spyOn(botClient, 'isConnected').mockReturnValue(true);
  jest
    .spyOn(botClient, 'getGuild')
    .mockReturnValue({ id: 'guild-retire' } as never);
  jest
    .spyOn(board, 'resolveForum')
    .mockResolvedValue({ id: 'forum-retire' } as never);
  jest.spyOn(board, 'postThread').mockImplementation(() => {
    threadSeq += 1;
    return Promise.resolve({
      threadId: `thread-${String(threadSeq)}`,
      starterMessageId: `starter-${String(threadSeq)}`,
    });
  });
  jest
    .spyOn(board, 'editThread')
    .mockImplementation((row, view, ctx) => {
      edits.push({ row, view });
      context = ctx;
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

/** Every tracked row for a game, newest last. */
async function boardRows(gameId: number): Promise<LfmMessageRow[]> {
  return testApp.db
    .select()
    .from(schema.lfgGroupMessages)
    .where(eq(schema.lfgGroupMessages.gameId, gameId))
    .orderBy(schema.lfgGroupMessages.postedAt);
}

/** The farewell render's description, exactly as Discord would receive it. */
function descriptionOf(view: LfmGroupView): string {
  const { embed } = buildLfmEmbed(view, context, Date.now(), {
    linkStyle: 'button',
  });
  return embed.data.description ?? '';
}

describe('LFG board disable retires live posts (ROK-1523, integration)', () => {
  it('retires every open forum post, closes every row, and leaves the groups live', async () => {
    const [a, b] = await Promise.all([
      createMemberAndLogin(testApp, 'retire-a', 'retire-a@test.dev'),
      createMemberAndLogin(testApp, 'retire-b', 'retire-b@test.dev'),
    ]);
    const gameOne = await createGame(testApp, 'Retire Game One');
    const gameTwo = await createGame(testApp, 'Retire Game Two');
    await raiseHand(a.token, gameOne.id);
    await raiseHand(b.token, gameOne.id);
    await raiseHand(a.token, gameTwo.id);

    // 1 — the board is populated: two live posts, two open rows.
    const [openOne] = await boardRows(gameOne.id);
    const [openTwo] = await boardRows(gameTwo.id);
    expect(openOne).toMatchObject({ state: 'open', postKind: 'forum' });
    expect(openTwo).toMatchObject({ state: 'open', postKind: 'forum' });
    edits = [];

    await toggle.onToggled({ enabled: false });

    // 2 — every row is closed. THE checkpoint: with E4's early return back in
    // the listener these rows are still `open`.
    const [closedOne] = await boardRows(gameOne.id);
    const [closedTwo] = await boardRows(gameTwo.id);
    expect(closedOne.state).toBe('closed');
    expect(closedTwo.state).toBe('closed');
    expect(closedOne.closedAt).not.toBeNull();
    expect(closedTwo.closedAt).not.toBeNull();

    // 3 — each post got a TERMINAL render, which is what archives its thread.
    expect(edits).toHaveLength(2);
    const retired = edits.map((e) => e.view);
    expect(retired.every((v) => v.state === 'closed')).toBe(true);
    expect(retired.every((v) => v.boardRetired === true)).toBe(true);
    expect(edits.map((e) => e.row.id).sort()).toEqual(
      [openOne.id, openTwo.id].sort(),
    );

    // 4 — the copy says the BOARD went away, and still links the group. It
    // must never read as a cancellation: the group is untouched.
    const rendered = descriptionOf(retired[0]);
    expect(rendered).toContain(LFG_BOARD_RETIRED_NOTE);
    expect(rendered).toContain(`/lfg/${gameOne.slug}`);

    // 5 — the group itself survives: both hands are still live, so the web
    // surface the farewell links to has something to show.
    const intents = await testApp.db
      .select()
      .from(schema.lfgIntents)
      .where(eq(schema.lfgIntents.gameId, gameOne.id));
    expect(intents).toHaveLength(2);
    expect(intents.every((i) => i.status === 'active')).toBe(true);
  });

  it('leaves no open row behind, so the game can post again on re-enable', async () => {
    const a = await createMemberAndLogin(testApp, 'retire-reenable', 'retire-reenable@test.dev');
    const game = await createGame(testApp, 'Retire Reenable Game');
    await raiseHand(a.token, game.id);
    await toggle.onToggled({ enabled: false });

    // ROK-1520's hazard from the other side: a stale `open` row would wedge
    // this game behind `uq_lfg_group_messages_game_open` and the re-enabled
    // board would never post for it again.
    const rows = await boardRows(game.id);
    expect(rows.filter((r) => r.state === 'open')).toHaveLength(0);

    await setLfgBoardEnabled(
      testApp.app.get(SettingsService, { strict: false }),
      true,
    );
    const b = await createMemberAndLogin(testApp, 'retire-reenable-b', 'retire-reenable-b@test.dev');
    await raiseHand(b.token, game.id);

    const after = await boardRows(game.id);
    expect(after.filter((r) => r.state === 'open')).toHaveLength(1);
    expect(after).toHaveLength(2);
  });

  it('closes the row even when Discord refuses the farewell edit', async () => {
    const board = testApp.app.get(LfgBoardService, { strict: false });
    jest
      .spyOn(board, 'editThread')
      .mockRejectedValue(new Error('Missing Access'));
    const a = await createMemberAndLogin(testApp, 'retire-refused', 'retire-refused@test.dev');
    const game = await createGame(testApp, 'Retire Refused Game');
    await raiseHand(a.token, game.id);

    await expect(toggle.onToggled({ enabled: false })).resolves.toBeUndefined();

    // The wedge class: an unclosable `open` row holds the game hostage to the
    // partial unique index for a post nobody can edit any more.
    const [row] = await boardRows(game.id);
    expect(row.state).toBe('closed');
  });
});
