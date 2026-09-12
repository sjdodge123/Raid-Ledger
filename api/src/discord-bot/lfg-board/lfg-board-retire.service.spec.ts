/**
 * ROK-1523 — the retire pass, at unit scale.
 *
 * The integration spec proves the WALK (disable -> closed rows, terminal
 * renders). This file pins the three things that walk cannot reach without a
 * Discord outage on demand:
 *
 *  1. the farewell reads the CURRENT view, so a `playing` group's card does not
 *     go out saying "0 still looking";
 *  2. a TRANSIENT Discord failure leaves the row OPEN for the reconnect
 *     reconciliation, while a permanent refusal closes it anyway;
 *  3. one bad row never aborts the pass.
 */
import { Logger } from '@nestjs/common';
import { LfgBoardRetireService } from './lfg-board-retire.service';
import type { LfgBoardService } from './lfg-board.service';
import type { SettingsService } from '../../settings/settings.service';
import type { LfgGameChainService } from './lfg-game-chain.service';
import type { LfmMessageRow } from '../lfm/lfm-embed.db-helpers';
import * as store from '../lfm/lfm-embed.db-helpers';
import * as views from '../lfm/lfm-embed.views';

jest.mock('../lfm/lfm-embed.db-helpers');
jest.mock('../lfm/lfm-embed.views');

const listOpen = store.listOpenLfmMessages as jest.MockedFunction<
  typeof store.listOpenLfmMessages
>;
const loadGame = store.loadLfmGame as jest.MockedFunction<
  typeof store.loadLfmGame
>;
const close = store.closeLfmMessage as jest.MockedFunction<
  typeof store.closeLfmMessage
>;
const findOpen = store.findOpenLfmMessage as jest.MockedFunction<
  typeof store.findOpenLfmMessage
>;
const currentView = views.currentView as jest.MockedFunction<
  typeof views.currentView
>;
const liveView = views.liveView as jest.MockedFunction<typeof views.liveView>;

function row(over: Partial<LfmMessageRow> = {}): LfmMessageRow {
  return {
    id: 'row-1',
    gameId: 7,
    channelId: 'c',
    messageId: 'm',
    postKind: 'forum',
    lastMemberCount: 3,
    postedAt: new Date(),
    ...over,
  } as LfmMessageRow;
}

/** A Discord REST rejection carrying an API error code. */
function discordError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

const board = { editThread: jest.fn() };
const settings = {
  getBranding: jest.fn(() => Promise.resolve({ communityName: 'RL' })),
  getClientUrl: jest.fn(() => Promise.resolve('https://raid.example')),
  getDefaultTimezone: jest.fn(() => Promise.resolve('UTC')),
};
/** The real chain semantics — work in, work out, per game. */
const chain = {
  serialized: jest.fn((_gameId: number, work: () => Promise<void>) => work()),
};

function service(): LfgBoardRetireService {
  return new LfgBoardRetireService(
    {} as never,
    board as unknown as LfgBoardService,
    settings as unknown as SettingsService,
    chain as unknown as LfgGameChainService,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  loadGame.mockResolvedValue({ id: 7, name: 'DRG', slug: 'drg' } as never);
  // Default: the snapshot the pass took is still the live row.
  findOpen.mockImplementation((_db, gameId) =>
    Promise.resolve(row({ id: gameId === 2 ? 'good' : 'row-1', gameId })),
  );
  currentView.mockResolvedValue({
    state: 'playing',
    gameId: 7,
    gameName: 'DRG',
    gameSlug: 'drg',
    memberCount: 4,
  } as never);
  board.editThread.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('LfgBoardRetireService — the farewell reads the CURRENT view', () => {
  it('renders a playing group at its real head-count, not an empty live read', async () => {
    listOpen.mockResolvedValue([row()]);

    await service().retireOpenPosts();

    expect(currentView).toHaveBeenCalledTimes(1);
    expect(liveView).not.toHaveBeenCalled();
    const [, view] = board.editThread.mock.calls[0] as [
      unknown,
      { memberCount: number },
    ];
    expect(view.memberCount).toBe(4);
  });
});

describe('LfgBoardRetireService — transient vs permanent refusal', () => {
  it('leaves the row OPEN when Discord merely could not answer', async () => {
    listOpen.mockResolvedValue([row()]);
    board.editThread.mockRejectedValue(new Error('bot is not connected'));

    const retired = await service().retireOpenPosts();

    expect(close).not.toHaveBeenCalled();
    expect(retired).toBe(0);
  });

  // ROK-1523 review blocker 1 — these used to close the row: `fetchThread`
  // rephrased every rejection as `Unknown Message`, which the message-substring
  // branch of `isPermanentRefusal` then matched. A live post with a closed row
  // is invisible to reconcile forever and gets a SECOND card on re-enable.
  it.each([
    ['a rate limit', 429],
    ['a gateway error', 500],
    ['a service outage', 503],
  ])('leaves the row OPEN on %s (%i)', async (_label, code) => {
    listOpen.mockResolvedValue([row()]);
    board.editThread.mockRejectedValue(
      discordError('You are being rate limited.', code),
    );

    const retired = await service().retireOpenPosts();

    expect(close).not.toHaveBeenCalled();
    expect(retired).toBe(0);
  });

  it.each([
    ['Missing Access', 50001],
    ['Missing Permissions', 50013],
    ['Unknown Channel', 10003],
    ['Unknown Message', 10008],
  ])('closes the row anyway on a permanent %s (%i)', async (msg, code) => {
    listOpen.mockResolvedValue([row()]);
    board.editThread.mockRejectedValue(discordError(msg, code));

    const retired = await service().retireOpenPosts();

    expect(close).toHaveBeenCalledWith({}, 'row-1', 'closed', 4);
    expect(retired).toBe(1);
  });
});

describe('LfgBoardRetireService — one bad row never aborts the pass', () => {
  it('continues to the next row when a row throws outright', async () => {
    listOpen.mockResolvedValue([
      row({ id: 'bad', gameId: 1 }),
      row({ id: 'good', gameId: 2 }),
    ]);
    loadGame.mockImplementation((_db, gameId) =>
      gameId === 1
        ? Promise.reject(new Error('db blew up'))
        : (Promise.resolve({ id: 2, name: 'X', slug: 'x' }) as never),
    );

    const retired = await service().retireOpenPosts();

    expect(retired).toBe(1);
    expect(close).toHaveBeenCalledWith({}, 'good', 'closed', 4);
  });

  it('never throws when the worklist itself cannot be read', async () => {
    listOpen.mockRejectedValue(new Error('db down'));

    await expect(service().retireOpenPosts()).resolves.toBe(0);
  });

  it('runs each row through the per-game chain', async () => {
    listOpen.mockResolvedValue([row({ gameId: 11 })]);

    await service().retireOpenPosts();

    expect(chain.serialized).toHaveBeenCalledWith(11, expect.any(Function));
  });
});

/**
 * ROK-1523 review blocker 3 — the worklist is a SNAPSHOT taken before the pass
 * queues on each game's chain. A `GROUP_CHANGED` already queued ahead of it can
 * terminalise the same row first, and the retire would then unarchive that
 * final card, overwrite it with "the board was switched off — still live on the
 * site" for a group that actually got SCHEDULED, and rewrite `converted` back
 * to `closed`. The row is re-read INSIDE the chain so the retire only ever
 * touches a row that is still open and still the one it snapshotted.
 */
describe('LfgBoardRetireService — the row is re-read inside the chain', () => {
  it('leaves a row a queued GROUP_CHANGED already terminalised alone', async () => {
    listOpen.mockResolvedValue([row()]);
    findOpen.mockResolvedValue(null);

    const retired = await service().retireOpenPosts();

    expect(board.editThread).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(retired).toBe(0);
  });

  it('leaves a row that was replaced by a fresh post alone', async () => {
    listOpen.mockResolvedValue([row()]);
    findOpen.mockResolvedValue(row({ id: 'reposted-row' }));

    const retired = await service().retireOpenPosts();

    expect(board.editThread).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(retired).toBe(0);
  });

  // rl-review nit — the count is what the pass LOGS ("retired N of M ... each
  // one says the board was switched off"), so a row whose game has been deleted
  // must not be counted: nothing was edited, only the row was closed.
  it('closes a deleted game\u2019s row without counting it as retired', async () => {
    listOpen.mockResolvedValue([row()]);
    loadGame.mockResolvedValue(null);

    const retired = await service().retireOpenPosts();

    expect(board.editThread).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith({}, 'row-1', 'closed', 3);
    expect(retired).toBe(0);
  });

  it('re-reads the row on the game chain before touching Discord', async () => {
    listOpen.mockResolvedValue([row({ gameId: 11, id: 'row-11' })]);
    findOpen.mockResolvedValue(row({ gameId: 11, id: 'row-11' }));

    expect(await service().retireOpenPosts()).toBe(1);
    expect(findOpen).toHaveBeenCalledWith({}, 11);
  });
});
