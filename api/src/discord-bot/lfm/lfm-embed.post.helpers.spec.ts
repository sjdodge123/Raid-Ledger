/**
 * ROK-1695 — `postNew`'s D3 floor must not swallow a PLAYING NOW post.
 *
 * The race: when the second `now` hand forms a group, the quick-play spawn
 * and the LFM post both react to `LFM_REACHED`. If the spawn commits first,
 * the heal path builds a `playing` view whose `memberCount` is the VOICE
 * head-count — 0 until anyone joins the channel. The D3 floor
 * (`memberCount < LFM_FLOOR` → forum only) then read that group as a one-hand
 * LFG and posted nothing; the spawn's later edit found no row, so the group
 * never got its PLAYING NOW post at all.
 *
 * The assertions, and why each exists:
 *
 *  - **(a) playing at 0 on a text surface posts.** The bug itself. Asserted
 *    on the channel ids `sendEmbed` received so a red run reads "expected
 *    ['chan-text'], received []" rather than a bare call count.
 *  - **(b) open at 1 on a text surface does NOT post.** The D3 guard this fix
 *    must not loosen: a genuine one-hand LFG group stays off the text board.
 *  - **(c) playing at 0, forum refused, falls back to text.** The other D3
 *    exit — a refused forum post at LFG has no text fallback, but a playing
 *    group is not LFG.
 *
 * TDB:954 — the E3 heal (`replaceDeletedPost`) drops the tracking row before
 * posting its replacement. `postNew` now reports whether a row landed, and the
 * heal restores the ORIGINAL row whenever one did not — otherwise the group is
 * left untracked and every later change returns early (E4).
 */
import { at } from '../../common/testing/narrow';
import { Logger } from '@nestjs/common';
import type { EmbedContext } from '../services/discord-embed.factory';
import { resolveLfgBoardSurface } from '../lfg-board/lfg-board-surface.helpers';
import { resolveLfmChannel } from './lfm-channel.helpers';
import {
  deleteLfmMessage,
  insertLfmMessage,
  restoreLfmMessage,
  type LfmMessageRow,
} from './lfm-embed.db-helpers';
import type { LfmGroupView } from './lfm-embed.helpers';
import {
  postNew,
  replaceDeletedPost,
  type LfmPostDeps,
} from './lfm-embed.post.helpers';

jest.mock('../lfg-board/lfg-board-surface.helpers');
jest.mock('./lfm-channel.helpers');
jest.mock('./lfm-embed.db-helpers', () => ({
  ...jest.requireActual<object>('./lfm-embed.db-helpers'),
  insertLfmMessage: jest.fn(),
  deleteLfmMessage: jest.fn(),
  restoreLfmMessage: jest.fn(),
}));

const GAME_ID = 12;
const GUILD_ID = 'guild-1';
const TEXT = { guildId: GUILD_ID, channelId: 'chan-text' };
const FORUM = {
  kind: 'forum' as const,
  guildId: GUILD_ID,
  channelId: 'forum-1',
};

const CONTEXT: EmbedContext = {
  communityName: 'Deep Rock',
  clientUrl: 'https://raid.example',
  timezone: 'UTC',
};

function view(overrides: Partial<LfmGroupView>): LfmGroupView {
  return {
    state: 'open',
    gameId: GAME_ID,
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    memberCount: 1,
    memberNames: ['Bosco'],
    viabilityThreshold: 4,
    expiresAt: '2026-09-17T23:30:00.000Z',
    ...overrides,
  };
}

/** The spawn-first render: PLAYING, but nobody is in voice yet. */
const PLAYING_EMPTY_VOICE = view({
  state: 'playing',
  memberCount: 0,
  memberNames: [],
});

function makeDeps() {
  const sendEmbed = jest.fn().mockResolvedValue({ id: 'msg-new' });
  const postThread = jest.fn().mockResolvedValue(null);
  const deps = {
    db: {},
    board: { postThread },
    clientService: { sendEmbed },
    channelDeps: {},
    surfaceDeps: {},
    events: { emit: jest.fn() },
    context: CONTEXT,
  } as unknown as LfmPostDeps;
  return { deps, sendEmbed, postThread };
}

/** Channel ids the text board was sent to, in order. */
function sentTo(sendEmbed: jest.Mock): unknown[] {
  return sendEmbed.mock.calls.map((call: unknown[]) => call[0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(resolveLfmChannel).mockResolvedValue(TEXT);
});

describe('postNew — D3 floor vs a playing group (ROK-1695)', () => {
  it('(a) posts a PLAYING view to the text surface even at voice head-count 0', async () => {
    jest
      .mocked(resolveLfgBoardSurface)
      .mockResolvedValue({ kind: 'text', ...TEXT });
    const { deps, sendEmbed } = makeDeps();

    await postNew(deps, GAME_ID, PLAYING_EMPTY_VOICE);

    expect(sentTo(sendEmbed)).toEqual(['chan-text']);
    expect(insertLfmMessage).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({ gameId: GAME_ID, postKind: 'text' }),
    );
  });

  it('(b) keeps a one-hand OPEN group off the text surface (D3 guard)', async () => {
    jest
      .mocked(resolveLfgBoardSurface)
      .mockResolvedValue({ kind: 'text', ...TEXT });
    const { deps, sendEmbed } = makeDeps();

    await postNew(deps, GAME_ID, view({ state: 'open', memberCount: 1 }));

    expect(sentTo(sendEmbed)).toEqual([]);
    expect(insertLfmMessage).not.toHaveBeenCalled();
  });

  it('(c) falls back to text when the forum refuses a PLAYING post', async () => {
    jest.mocked(resolveLfgBoardSurface).mockResolvedValue(FORUM);
    const { deps, sendEmbed, postThread } = makeDeps();

    await postNew(deps, GAME_ID, PLAYING_EMPTY_VOICE);

    expect(postThread).toHaveBeenCalledWith(
      FORUM.channelId,
      PLAYING_EMPTY_VOICE,
      CONTEXT,
    );
    expect(sentTo(sendEmbed)).toEqual(['chan-text']);
  });
});

/** A two-hand render: above the D3 floor, so every surface may post it. */
const TWO_HANDS = view({ memberCount: 2, memberNames: ['Bosco', 'Karl'] });

/** The tracking row whose Discord message a human deleted. */
const DELETED_ROW: LfmMessageRow = {
  id: 'row-1',
  gameId: GAME_ID,
  guildId: GUILD_ID,
  channelId: 'chan-text',
  messageId: 'msg-gone',
  state: 'open',
  lastMemberCount: 2,
  threadId: null,
  postKind: 'text',
  postedAt: new Date('2026-09-01T10:00:00.000Z'),
  updatedAt: new Date('2026-09-01T10:00:00.000Z'),
  closedAt: null,
};

describe('postNew — reports whether a row now tracks the post (TDB:954)', () => {
  it('returns true after a text post', async () => {
    jest
      .mocked(resolveLfgBoardSurface)
      .mockResolvedValue({ kind: 'text', ...TEXT });
    const { deps } = makeDeps();

    await expect(postNew(deps, GAME_ID, TWO_HANDS)).resolves.toBe(true);
  });

  it('returns true after a forum post', async () => {
    jest.mocked(resolveLfgBoardSurface).mockResolvedValue(FORUM);
    const { deps, postThread, sendEmbed } = makeDeps();
    postThread.mockResolvedValue({
      threadId: 'thread-9',
      starterMessageId: 'starter-9',
    });

    await expect(postNew(deps, GAME_ID, TWO_HANDS)).resolves.toBe(true);
    expect(sentTo(sendEmbed)).toEqual([]);
  });

  it('returns false when D3 keeps a one-hand open group off text', async () => {
    jest
      .mocked(resolveLfgBoardSurface)
      .mockResolvedValue({ kind: 'text', ...TEXT });
    const { deps } = makeDeps();

    await expect(postNew(deps, GAME_ID, view({}))).resolves.toBe(false);
  });

  it('returns false when no surface resolves', async () => {
    jest.mocked(resolveLfgBoardSurface).mockResolvedValue(null);
    const { deps } = makeDeps();

    await expect(postNew(deps, GAME_ID, TWO_HANDS)).resolves.toBe(false);
  });
});

function useTextSurface(): void {
  jest
    .mocked(resolveLfgBoardSurface)
    .mockResolvedValue({ kind: 'text', ...TEXT });
}

describe('replaceDeletedPost — the E3 heal never drops a row it cannot replace (TDB:954)', () => {
  it('restores the ORIGINAL row and rethrows when sendEmbed rejects', async () => {
    useTextSurface();
    const { deps, sendEmbed } = makeDeps();
    sendEmbed.mockRejectedValue(new Error('Missing Access'));

    await expect(
      replaceDeletedPost(deps, DELETED_ROW, TWO_HANDS),
    ).rejects.toThrow('Missing Access');
    expect(jest.mocked(restoreLfmMessage).mock.calls).toEqual([
      [deps.db, DELETED_ROW],
    ]);
    expect(jest.mocked(restoreLfmMessage).mock.calls[0]?.[1]).toBe(DELETED_ROW);
  });

  it('rethrows the POST error, not the restore error, when both fail', async () => {
    useTextSurface();
    const { deps, sendEmbed } = makeDeps();
    sendEmbed.mockRejectedValue(new Error('Missing Access'));
    jest
      .mocked(restoreLfmMessage)
      .mockRejectedValueOnce(new Error('connection reset'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(
      replaceDeletedPost(deps, DELETED_ROW, TWO_HANDS),
    ).rejects.toThrow('Missing Access');
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining('connection reset'),
    ]);
    warn.mockRestore();
  });

  it('restores the row when no surface resolves', async () => {
    jest.mocked(resolveLfgBoardSurface).mockResolvedValue(null);
    const { deps } = makeDeps();

    await replaceDeletedPost(deps, DELETED_ROW, TWO_HANDS);

    expect(jest.mocked(restoreLfmMessage).mock.calls).toEqual([
      [deps.db, DELETED_ROW],
    ]);
  });

  it('does not restore once the replacement is tracked', async () => {
    useTextSurface();
    const { deps } = makeDeps();

    await replaceDeletedPost(deps, DELETED_ROW, TWO_HANDS);

    expect(insertLfmMessage).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({ gameId: GAME_ID, messageId: 'msg-new' }),
    );
    expect(restoreLfmMessage).not.toHaveBeenCalled();
  });

  it('drops the row BEFORE posting, so the replacement clears the unique index', async () => {
    useTextSurface();
    const { deps, sendEmbed } = makeDeps();

    await replaceDeletedPost(deps, DELETED_ROW, TWO_HANDS);

    expect(deleteLfmMessage).toHaveBeenCalledWith(deps.db, 'row-1');
    expect(
      jest.mocked(deleteLfmMessage).mock.invocationCallOrder[0],
    ).toBeLessThan(at(sendEmbed.mock.invocationCallOrder, 0));
  });
});
