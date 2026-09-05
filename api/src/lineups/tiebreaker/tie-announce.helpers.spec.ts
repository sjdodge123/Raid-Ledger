/**
 * ROK-1374 (Lane B) — announce-once + edit-in-place for the tie message.
 *
 * D7: ONE Discord message per tie for its whole life. A second announce is the
 * spam the embed system removed, so every later state change edits the id we
 * persisted. E4: a deleted message clears the columns and is never reposted.
 * E5: Discord is best-effort — the tie hold is the source of truth, so nothing
 * here may throw into the caller's transition path.
 */
import { createDrizzleMock, type MockDb } from '../../common/testing/drizzle-mock';
import {
  postChannelEmbed,
  resolveEmbedCtx,
} from '../lineup-notification-dispatch.helpers';
import { announceTie, editTieAnnounce } from './tie-announce.helpers';
import { buildTieExpiredEmbed } from '../lineup-notification-tie-embed.helpers';
import type { EmbedContext } from '../lineup-notification-embed.helpers';

jest.mock('../lineup-notification-dispatch.helpers', () => ({
  postChannelEmbed: jest.fn(),
  resolveEmbedCtx: jest.fn(),
}));

const mockPost = postChannelEmbed as jest.MockedFunction<
  typeof postChannelEmbed
>;
const mockCtx = resolveEmbedCtx as jest.MockedFunction<typeof resolveEmbedCtx>;

const CTX: EmbedContext = {
  baseUrl: 'https://raid.example.net',
  lineupId: 42,
  communityName: 'Gamer Night',
  phase: 'voting',
  lineupTitle: 'Friday Co-op',
};

const TIED = [
  { id: 7, name: 'Deep Rock Galactic' },
  { id: 9, name: 'Valheim' },
];

const PAYLOAD = { tiedGames: TIED, rosterSize: 6 };

class UnknownMessageError extends Error {
  code = 10008;
  constructor() {
    super('Unknown Message');
  }
}

function makeDeps(db: MockDb) {
  const botClient = { editEmbed: jest.fn().mockResolvedValue({ id: 'm1' }) };
  return {
    deps: {
      db: db as never,
      settingsService: {} as never,
      botClient: botClient as never,
      dedupService: {} as never,
    },
    botClient,
  };
}

/** `readAnnounceTarget` is the first query on every path. */
function withStoredTarget(db: MockDb, row: unknown): void {
  db.limit.mockResolvedValue([row]);
}

describe('announceTie', () => {
  let db: MockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDrizzleMock();
    mockCtx.mockResolvedValue(CTX);
    mockPost.mockResolvedValue({ channelId: 'c1', messageId: 'm1' });
    withStoredTarget(db, { channelId: null, messageId: null });
  });

  it('posts exactly one channel embed for a public lineup', async () => {
    const { deps } = makeDeps(db);
    await announceTie(deps, { id: 42, visibility: 'public' }, PAYLOAD);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][1]).toBe('lineup-tie:42');
  });

  it('persists the returned channel and message ids (D7)', async () => {
    const { deps } = makeDeps(db);
    await announceTie(deps, { id: 42, visibility: 'public' }, PAYLOAD);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        tieAnnounceChannelId: 'c1',
        tieAnnounceMessageId: 'm1',
      }),
    );
  });

  it('edits instead of posting when the columns are already set', async () => {
    withStoredTarget(db, { channelId: 'c1', messageId: 'm1' });
    const { deps, botClient } = makeDeps(db);
    await announceTie(deps, { id: 42, visibility: 'public' }, PAYLOAD);
    expect(mockPost).not.toHaveBeenCalled();
    expect(botClient.editEmbed).toHaveBeenCalledTimes(1);
    expect(botClient.editEmbed.mock.calls[0].slice(0, 2)).toEqual(['c1', 'm1']);
  });

  it('posts no channel embed for a private lineup (E22 / AC10)', async () => {
    const { deps, botClient } = makeDeps(db);
    await announceTie(deps, { id: 42, visibility: 'private' }, PAYLOAD);
    expect(mockPost).not.toHaveBeenCalled();
    expect(botClient.editEmbed).not.toHaveBeenCalled();
  });

  it('swallows a post failure — the hold is the source of truth (E5)', async () => {
    mockPost.mockRejectedValue(new Error('channel unbound'));
    const { deps } = makeDeps(db);
    await expect(
      announceTie(deps, { id: 42, visibility: 'public' }, PAYLOAD),
    ).resolves.toBeUndefined();
    expect(db.set).not.toHaveBeenCalled();
  });

  it('persists nothing when the dispatcher deduped the post', async () => {
    mockPost.mockResolvedValue(null);
    const { deps } = makeDeps(db);
    await announceTie(deps, { id: 42, visibility: 'public' }, PAYLOAD);
    expect(db.set).not.toHaveBeenCalled();
  });
});

describe('editTieAnnounce', () => {
  let db: MockDb;
  const build = (ctx: EmbedContext) => buildTieExpiredEmbed(ctx, TIED);

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDrizzleMock();
    mockCtx.mockResolvedValue(CTX);
    withStoredTarget(db, { channelId: 'c1', messageId: 'm1' });
  });

  it('does nothing when no message was ever announced', async () => {
    withStoredTarget(db, { channelId: null, messageId: null });
    const { deps, botClient } = makeDeps(db);
    await editTieAnnounce(deps, { id: 42 }, build);
    expect(botClient.editEmbed).not.toHaveBeenCalled();
  });

  it('clears both columns and does NOT repost on Unknown Message (E4)', async () => {
    const { deps, botClient } = makeDeps(db);
    botClient.editEmbed.mockRejectedValue(new UnknownMessageError());
    await editTieAnnounce(deps, { id: 42 }, build);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        tieAnnounceChannelId: null,
        tieAnnounceMessageId: null,
      }),
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('swallows any other Discord failure and keeps the columns (E5)', async () => {
    const { deps, botClient } = makeDeps(db);
    botClient.editEmbed.mockRejectedValue(new Error('bot offline'));
    await expect(
      editTieAnnounce(deps, { id: 42 }, build),
    ).resolves.toBeUndefined();
    expect(db.set).not.toHaveBeenCalled();
  });
});
