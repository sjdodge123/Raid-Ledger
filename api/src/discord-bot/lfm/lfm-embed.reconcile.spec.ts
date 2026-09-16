/**
 * ROK-1454 D9 — the restart reconcile on CONNECTED.
 *
 * Moved out of `lfm-embed.service.spec.ts` (ROK-1505: that file was at 736 of
 * its 750 counted lines). Same fixtures, same fake table — see
 * `lfm-embed.service.spec-helpers.ts`. The high-risk claim pinned here is the
 * AC9 wedge: `insertLfmMessage` in the fixture MODELS the partial unique index
 * by throwing on a second `open` row, so a missed reconcile fails the way
 * production would — the game can never post again.
 */
import * as store from './lfm-embed.db-helpers';
import type { LfmEmbedService } from './lfm-embed.service';
import {
  board,
  BOARD_THREAD,
  client,
  createService,
  edited,
  EVENT_ID,
  GAME_ID,
  live,
  member,
  openRow,
  rowById,
  seedOpenRow,
} from './lfm-embed.service.spec-helpers';

jest.mock('./lfm-embed.db-helpers');

let service: LfmEmbedService;

beforeEach(async () => {
  service = await createService();
});

describe('restart reconcile on CONNECTED (D9)', () => {
  it('heals an edit missed while the bot was down', async () => {
    seedOpenRow();
    jest
      .mocked(store)
      .readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl', 'Doretta']));

    await service.onConnected();

    expect(client.editEmbed.mock.calls[0][1]).toBe('msg-1');
    expect(openRow()).toMatchObject({ state: 'open', lastMemberCount: 3 });
  });

  it('closes a group that converted while the bot was down', async () => {
    seedOpenRow();
    const s = jest.mocked(store);
    s.readLiveGroup.mockResolvedValue(live(['Bosco']));
    s.latestConversionTarget.mockResolvedValue({ eventId: EVENT_ID });
    s.readConvertedGroup.mockResolvedValue(
      ['Bosco', 'Karl', 'Doretta'].map(member),
    );

    await service.onConnected();

    expect(edited().author?.name).toBe('■ SCHEDULED · 3 players');
    expect(rowById('row-1')).toMatchObject({ state: 'converted' });
  });

  it('closes a group that simply died while the bot was down', async () => {
    seedOpenRow({ lastMemberCount: 2 });
    jest.mocked(store).readLiveGroup.mockResolvedValue(live([]));

    await service.onConnected();

    expect(edited().author?.name).toBe('■ EXPIRED · 2 were looking');
    expect(rowById('row-1')).toMatchObject({ state: 'expired' });
  });

  it('AC9 wedge — after reconcile the game can post a NEW message again', async () => {
    seedOpenRow({ lastMemberCount: 2 });
    const s = jest.mocked(store);
    s.readLiveGroup.mockResolvedValue(live([]));

    await service.onConnected();
    s.readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl']));
    await service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
    });

    // Without the reconcile the stale `open` row survives, `onLfmReached`
    // edits it instead of posting, and the partial unique index means this
    // game can NEVER post an LFM message again.
    expect(openRow()?.messageId).toBe('msg-new');
    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
  });

  it('one bad row does not abort the rest of the reconcile', async () => {
    seedOpenRow();
    seedOpenRow({ id: 'row-2', gameId: 43, messageId: 'msg-2' });
    client.editEmbed
      .mockRejectedValueOnce(new Error('Missing Access'))
      .mockResolvedValue({ id: 'msg-2' });

    await expect(service.onConnected()).resolves.toBeUndefined();
    expect(client.editEmbed).toHaveBeenCalledTimes(2);
  });

  it('DISCONNECTED drops nothing — the state lives in the table', () => {
    seedOpenRow();

    service.onDisconnected();

    expect(openRow()).toMatchObject({ messageId: 'msg-1' });
    expect(jest.mocked(store).closeLfmMessage).not.toHaveBeenCalled();
    expect(jest.mocked(store).deleteLfmMessage).not.toHaveBeenCalled();
  });
});

/**
 * ROK-1523 — the reconcile pass with the board switched OFF.
 *
 * The pass is the stated recovery for a retire whose farewell edit failed
 * transiently, so it re-runs the retire. Two things it must NOT do:
 *
 *  1. overwrite a TERMINAL reconcile — a group that converted or expired while
 *     the bot was down did not stay live, and a board-off farewell over it
 *     records `closed` and prints "still live on the site" about a dead group;
 *  2. treat a transient Discord failure as an ending. The retire semantics
 *     (transient leaves the row OPEN, permanent closes it anyway) are the SAME
 *     ones the disable pass applies — one implementation, shared.
 */
function seedForumRow(overrides = {}) {
  return seedOpenRow({
    postKind: 'forum',
    threadId: BOARD_THREAD,
    ...overrides,
  });
}

/** A Discord REST rejection carrying an API error code. */
function discordError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

/** The view the Nth `editThread` call rendered. */
function threadView(index = 0) {
  return board.editThread.mock.calls[index][1];
}

describe('reconcile with the LFG board OFF (ROK-1523)', () => {
  it('renders a group that ended offline as itself, not as a board-off card', async () => {
    seedForumRow({ lastMemberCount: 2 });
    jest.mocked(store).readLiveGroup.mockResolvedValue(live([]));

    await service.onConnected();

    expect(threadView()).toMatchObject({ state: 'expired' });
    expect(threadView().boardRetired).toBeFalsy();
    expect(rowById('row-1')).toMatchObject({ state: 'expired' });
  });

  it('renders a converted group as SCHEDULED, not as a board-off card', async () => {
    seedForumRow({ lastMemberCount: 3 });
    const s = jest.mocked(store);
    s.readLiveGroup.mockResolvedValue(live([]));
    s.latestConversionTarget.mockResolvedValue({ eventId: EVENT_ID });
    s.readConvertedGroup.mockResolvedValue(['Bosco', 'Karl'].map(member));

    await service.onConnected();

    expect(threadView()).toMatchObject({ state: 'scheduled' });
    expect(threadView().boardRetired).toBeFalsy();
    expect(rowById('row-1')).toMatchObject({ state: 'converted' });
  });

  it('retires a group that is still live with the board-off farewell', async () => {
    seedForumRow();

    await service.onConnected();

    expect(threadView()).toMatchObject({ state: 'closed', boardRetired: true });
    expect(rowById('row-1')).toMatchObject({ state: 'closed' });
  });

  it('leaves the row OPEN when the farewell edit fails transiently', async () => {
    seedForumRow();
    board.editThread.mockRejectedValue(discordError('rate limited', 429));

    await service.onConnected();

    expect(openRow()).toMatchObject({ state: 'open' });
    expect(jest.mocked(store).closeLfmMessage).not.toHaveBeenCalled();
  });

  it('closes the row when Discord refuses the farewell for good', async () => {
    seedForumRow();
    board.editThread.mockRejectedValue(discordError('Unknown Channel', 10003));

    await service.onConnected();

    expect(rowById('row-1')).toMatchObject({ state: 'closed' });
    expect(openRow()).toBeNull();
  });
});

/**
 * ROK-1523 final review — EVERY write path retires, not only the reconcile.
 *
 * A retire whose farewell edit failed transiently leaves the row `open`. The
 * next +1 / hand / withdraw used to reach `editRow` with a LIVE view and no
 * board-off check, and `editThread` unarchives before it edits — so a board
 * the operator switched OFF got its live card back. `editRow` itself now
 * treats board-off + open forum row + non-terminal render as "retire it".
 */
describe('hot-path edits with the LFG board OFF (ROK-1523)', () => {
  it('GROUP_CHANGED on an open forum row retires it instead of restoring the live card', async () => {
    seedForumRow();

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });

    expect(board.editThread).toHaveBeenCalledTimes(1);
    expect(threadView()).toMatchObject({ state: 'closed', boardRetired: true });
    expect(rowById('row-1')).toMatchObject({ state: 'closed' });
  });

  it('a raised hand on an open forum row retires it too', async () => {
    seedForumRow();

    await service.onHandRaised({ gameId: GAME_ID });

    expect(board.editThread).toHaveBeenCalledTimes(1);
    expect(threadView()).toMatchObject({ state: 'closed', boardRetired: true });
    expect(rowById('row-1')).toMatchObject({ state: 'closed' });
  });

  it('a TEXT row is not governed by the toggle and keeps rendering live', async () => {
    seedOpenRow();

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });

    expect(board.editThread).not.toHaveBeenCalled();
    expect(openRow()).toMatchObject({ state: 'open' });
  });
});
