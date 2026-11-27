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
const endedView = views.endedView as jest.MockedFunction<
  typeof views.endedView
>;
const liveFloorFor = views.liveFloorFor as jest.MockedFunction<
  typeof views.liveFloorFor
>;

function row(over: Partial<LfmMessageRow> = {}): LfmMessageRow {
  return {
    id: 'row-1',
    gameId: 7,
    channelId: 'c',
    messageId: 'm',
    postKind: 'forum',
    lastMemberCount: 3,
    postedAt: new Date(),
    groupKey: '',
    ...over,
  } as LfmMessageRow;
}

/** A Discord REST rejection carrying an API error code. */
function discordError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

const board = { editThread: jest.fn() };
const settings = {
  get: jest.fn(),
  getBranding: jest.fn(() => Promise.resolve({ communityName: 'RL' })),
  getClientUrl: jest.fn(() => Promise.resolve('https://raid.example')),
  getDefaultTimezone: jest.fn(() => Promise.resolve('UTC')),
};
/** The real chain semantics — work in, work out, per game. */
const chain = {
  serialized: jest.fn((_gameId: number, work: () => Promise<void>) => work()),
};

function service(registry?: unknown): LfgBoardRetireService {
  return new LfgBoardRetireService(
    {} as never,
    board as unknown as LfgBoardService,
    settings as unknown as SettingsService,
    chain as unknown as LfgGameChainService,
    registry as never,
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
  liveFloorFor.mockReturnValue(1);
  // The toggle as the disable left it: OFF.
  settings.get.mockResolvedValue('false');
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
    // ROK-2352 — the re-read is scoped to the row's own group (`''` here).
    expect(findOpen).toHaveBeenCalledWith({}, 11, '');
  });
});

/**
 * ROK-1523 final review — the operator re-enables while the disable pass is
 * still walking the board. The pass is sequential and queued per game, so the
 * tail of the list can run long after the toggle flipped back; retiring those
 * posts would archive live cards on a board that is ON, and nothing re-posts
 * them (the ENABLED re-post only sees UNTRACKED groups).
 */
describe('LfgBoardRetireService — the toggle is re-read per row', () => {
  it('skips a row when the board is back ON by the time it runs', async () => {
    listOpen.mockResolvedValue([row()]);
    settings.get.mockResolvedValue('true');

    const retired = await service().retireOpenPosts();

    expect(board.editThread).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(retired).toBe(0);
  });

  it('stops retiring mid-pass once the toggle flips back on', async () => {
    listOpen.mockResolvedValue([
      row({ id: 'row-1', gameId: 1 }),
      row({ id: 'good', gameId: 2 }),
    ]);
    findOpen.mockImplementation((_db, gameId) =>
      Promise.resolve(row({ id: gameId === 2 ? 'good' : 'row-1', gameId })),
    );
    settings.get.mockResolvedValueOnce('false').mockResolvedValue('true');

    const retired = await service().retireOpenPosts();

    expect(board.editThread).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({}, 'row-1', 'closed', 4);
    expect(retired).toBe(1);
  });
});

/**
 * ROK-1523 final review — a group that has actually ENDED keeps its ending.
 *
 * The reconcile never paints the board-off farewell over a terminal render;
 * the disable pass did. An open row whose group fell below its floor (the
 * ending was missed — the bot was down, the event dropped) got "the board was
 * switched off — still live on the site" about a group that is not live, and
 * was recorded `closed` over the `expired` / `converted` that happened.
 */
describe('LfgBoardRetireService — an ended group keeps its terminal render', () => {
  const emptyLive = {
    state: 'open',
    gameId: 7,
    gameName: 'DRG',
    gameSlug: 'drg',
    memberCount: 0,
  } as never;

  it('renders an expired group as EXPIRED and closes it as expired', async () => {
    listOpen.mockResolvedValue([row()]);
    currentView.mockResolvedValue(emptyLive);
    endedView.mockResolvedValue({
      state: 'expired',
      gameId: 7,
      gameName: 'DRG',
      gameSlug: 'drg',
      memberCount: 3,
    } as never);

    await service().retireOpenPosts();

    const [, view] = board.editThread.mock.calls[0] as [
      unknown,
      { state: string; boardRetired?: boolean },
    ];
    expect(view.state).toBe('expired');
    expect(view.boardRetired).toBeFalsy();
    expect(close).toHaveBeenCalledWith({}, 'row-1', 'expired', 3);
  });

  it('still retires a live group at or above its floor with the farewell', async () => {
    listOpen.mockResolvedValue([row()]);
    currentView.mockResolvedValue({
      ...(emptyLive as object),
      memberCount: 2,
    } as never);

    await service().retireOpenPosts();

    expect(endedView).not.toHaveBeenCalled();
    expect(board.editThread.mock.calls[0][1]).toMatchObject({
      state: 'closed',
      boardRetired: true,
    });
    expect(close).toHaveBeenCalledWith({}, 'row-1', 'closed', 2);
  });
});

/**
 * ROK-2352 — each row's farewell reads ONLY its own group. Unscoped, a live
 * keyed group kept the Any farewell "live", and a keyed row (never the `''`
 * row `findOpenLfmMessage` defaulted to) was skipped by the re-read and never
 * retired at all.
 */
describe('LfgBoardRetireService — per-group farewell (ROK-2352)', () => {
  /**
   * WoW with its grouping plugin active: the `''` row is the Any group. The
   * adapter answers `describeGroup` (required by `LfgGroupingAdapter`) so a
   * keyed farewell can keep its instance title.
   */
  const adapter = {
    describeGroup: jest.fn(() => Promise.resolve({ label: 'Molten Core' })),
  };
  const activeRegistry = { getAdapter: jest.fn(() => adapter) };

  beforeEach(() => {
    findOpen.mockImplementation((_db, gameId, groupKey = '') =>
      Promise.resolve(
        row({
          id: groupKey === '' ? 'row-1' : `row-${groupKey}`,
          gameId,
          groupKey,
        }),
      ),
    );
  });

  it('retires a keyed row, reading only that group', async () => {
    listOpen.mockResolvedValue([
      row({ id: 'row-raid:409', groupKey: 'raid:409' }),
    ]);

    const retired = await service(activeRegistry).retireOpenPosts();

    expect(findOpen).toHaveBeenCalledWith({}, 7, 'raid:409');
    expect(currentView).toHaveBeenCalledWith({}, expect.anything(), 'raid:409');
    expect(close).toHaveBeenCalledWith({}, 'row-raid:409', 'closed', 4);
    expect(retired).toBe(1);
    expect(board.editThread.mock.calls[0]?.[1]).toMatchObject({
      gameName: 'DRG — Molten Core',
      groupKey: 'raid:409',
      boardRetired: true,
    });
  });

  it('scopes the Any row to `` while the adapter is active', async () => {
    listOpen.mockResolvedValue([row()]);

    await service(activeRegistry).retireOpenPosts();

    expect(currentView).toHaveBeenCalledWith({}, expect.anything(), '');
  });

  it('reads the ending of the Any group only, below its floor', async () => {
    listOpen.mockResolvedValue([row()]);
    currentView.mockResolvedValue({ state: 'open', memberCount: 0 } as never);
    endedView.mockResolvedValue({ state: 'expired', memberCount: 0 } as never);

    await service(activeRegistry).retireOpenPosts();

    expect(endedView).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ id: 'row-1' }),
      '',
    );
  });

  it('reads the whole game when no adapter is active (the fold)', async () => {
    listOpen.mockResolvedValue([row()]);

    await service().retireOpenPosts();

    expect(currentView).toHaveBeenCalledWith({}, expect.anything(), null);
  });
});
