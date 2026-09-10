/**
 * ROK-1505 — the board posts at the FIRST hand (D1/D2/D3/D4/R1).
 *
 * A sibling of `lfm-embed.service.spec.ts` on the shared fixtures — that file
 * is at its 750-line cap. The claims pinned here, and why each needs its own
 * assertion:
 *
 *  - **one hand posts to the FORUM ONLY (D3 / AC5).** With the board off the
 *    resolved surface is the text channel, and a one-hand group must post
 *    NOTHING there — the text embed is the "looking for MORE" ping (Q1). A
 *    refused forum post has no text fallback either. Both are asserted on the
 *    row ledger AND on `sendEmbed`, because a post that writes no row is a
 *    message nobody can ever edit.
 *  - **the second hand edits the first hand's row (D2 / AC2).** Same row id,
 *    same thread id, ONE `postThread`. This is the invariant ROK-1471 D9 and
 *    ROK-1483's mirror depend on.
 *  - **2 -> 1 keeps a FORUM row open, closes a TEXT row (D4 / R1).** The
 *    single line that archived a board post on a 2 -> 1 withdrawal is the
 *    highest-risk change in the story; the text case proves the surface seam
 *    did not leak the new floor onto ROK-1454's embed.
 */
import * as store from './lfm-embed.db-helpers';
import type { LfmEmbedService } from './lfm-embed.service';
import {
  BOARD_THREAD,
  board,
  client,
  createService,
  edited,
  GAME_ID,
  live,
  openRow,
  rowById,
  seedOpenRow,
  settings,
} from './lfm-embed.service.spec-helpers';

jest.mock('./lfm-embed.db-helpers');

const FIRST_HAND = {
  gameId: GAME_ID,
  activeCount: 1,
  urgency: 'week' as const,
  ttlMinutes: null,
};

const SECOND_HAND = { ...FIRST_HAND, activeCount: 2 };

let service: LfmEmbedService;

beforeEach(async () => {
  service = await createService();
  jest.mocked(store).readLiveGroup.mockResolvedValue(live(['Bosco']));
});

/** Flip the master toggle on. The surface helper reads it through `get`. */
function enableBoard(): void {
  settings.get.mockResolvedValue('true');
}

describe('HAND_RAISED — the first post (D1 / AC1)', () => {
  it('posts a one-hand LOOKING thread to the forum and tracks it', async () => {
    enableBoard();

    await service.onHandRaised(FIRST_HAND);

    expect(board.postThread).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ state: 'open', memberCount: 1 }),
      expect.anything(),
    );
    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(openRow()).toMatchObject({
      postKind: 'forum',
      threadId: BOARD_THREAD,
      lastMemberCount: 1,
    });
  });

  it('posts NOTHING when the resolved surface is a text channel (D3 / AC5)', async () => {
    // Board off: `resolveLfgBoardSurface` lands on the default text channel,
    // exactly where a two-hand group would post. One hand must not.
    await service.onHandRaised(FIRST_HAND);

    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(board.postThread).not.toHaveBeenCalled();
    expect(openRow()).toBeNull();
  });

  it('has no text fallback when the forum refuses a one-hand post (D3)', async () => {
    enableBoard();
    board.postThread.mockResolvedValue(null);

    await service.onHandRaised(FIRST_HAND);

    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(openRow()).toBeNull();
  });

  it('still falls back to text for a TWO-hand group whose forum refused (E2, unchanged)', async () => {
    enableBoard();
    board.postThread.mockResolvedValue(null);
    jest.mocked(store).readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl']));

    await service.onLfmReached(SECOND_HAND);

    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
    expect(openRow()).toMatchObject({ postKind: 'text' });
  });

  it('E1 — returns quietly while the bot is disconnected', async () => {
    enableBoard();
    client.isConnected.mockReturnValue(false);

    await service.onHandRaised(FIRST_HAND);

    expect(board.postThread).not.toHaveBeenCalled();
    expect(jest.mocked(store).loadLfmGame).not.toHaveBeenCalled();
  });

  it('the offline reconcile obeys D3 too — a one-hand game with no forum posts nowhere', async () => {
    jest.mocked(store).listUntrackedLfmGames.mockResolvedValue([GAME_ID]);

    await service.onConnected();

    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(openRow()).toBeNull();
  });
});

describe('HAND_RAISED then LFM_REACHED — one thread, edited in place (D2 / AC2)', () => {
  it('the second hand edits the first hand row: same id, same thread, ONE post', async () => {
    enableBoard();
    await service.onHandRaised(FIRST_HAND);
    const first = openRow();
    expect(first).not.toBeNull();

    jest.mocked(store).readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl']));
    await service.onLfmReached(SECOND_HAND);

    expect(board.postThread).toHaveBeenCalledTimes(1);
    expect(board.editThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: first?.id }),
      expect.objectContaining({ state: 'open', memberCount: 2 }),
      expect.anything(),
    );
    expect(openRow()).toMatchObject({
      id: first?.id,
      threadId: first?.threadId,
      lastMemberCount: 2,
    });
  });
});

describe('a 2 -> 1 withdrawal — forum stays open, text closes (D4 / R1)', () => {
  it('re-titles a FORUM row back to LOOKING and leaves it open (AC3 regression)', async () => {
    const row = seedOpenRow({ postKind: 'forum', threadId: BOARD_THREAD });
    enableBoard();

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'withdrawn' });

    expect(board.editThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id }),
      expect.objectContaining({ state: 'open', memberCount: 1 }),
      expect.anything(),
    );
    expect(rowById(row.id)).toMatchObject({
      state: 'open',
      lastMemberCount: 1,
      closedAt: null,
    });
  });

  it('closes a TEXT row exactly as ROK-1454 did (R1)', async () => {
    seedOpenRow({ postKind: 'text' });

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'withdrawn' });

    expect(edited().author?.name).toBe('■ CLOSED · 1 still looking');
    expect(rowById('row-1')).toMatchObject({ state: 'closed' });
  });

  it('a 1 -> 0 withdrawal closes a FORUM row — zero hands is terminal', async () => {
    const row = seedOpenRow({
      postKind: 'forum',
      threadId: BOARD_THREAD,
      lastMemberCount: 1,
    });
    enableBoard();
    jest.mocked(store).readLiveGroup.mockResolvedValue(live([]));

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'withdrawn' });

    expect(rowById(row.id)).toMatchObject({ state: 'closed' });
  });
});

describe('restart reconcile at one hand (D4 / R1)', () => {
  it('re-renders a one-hand FORUM row as open, never expired', async () => {
    const row = seedOpenRow({ postKind: 'forum', threadId: BOARD_THREAD });
    enableBoard();

    await service.onConnected();

    expect(board.editThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id }),
      expect.objectContaining({ state: 'open', memberCount: 1 }),
      expect.anything(),
    );
    expect(rowById(row.id)).toMatchObject({ state: 'open' });
  });

  it('still expires a one-hand TEXT row', async () => {
    seedOpenRow({ postKind: 'text', lastMemberCount: 2 });

    await service.onConnected();

    expect(edited().author?.name).toBe('■ EXPIRED · 2 were looking');
    expect(rowById('row-1')).toMatchObject({ state: 'expired' });
  });
});
