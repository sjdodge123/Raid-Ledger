/**
 * ROK-2208 codex P2 — a lone hub binding a forum that already requires tags
 * (left on by an earlier share, or set by a moderator) must still get a tag,
 * or its outbound posts go out with `appliedTags: []` and Discord refuses.
 */
import type { HubForumDiscordForumSelect } from '../../../drizzle/schema';
import type {
  ForumInfo,
  HubForumDiscordGateway,
} from './hub-forum-discord.gateway';
import * as queries from './hub-forum-discord.queries';
import { shareForumTags } from './hub-forum-discord.share';

jest.mock('./hub-forum-discord.queries');
const q = jest.mocked(queries);

const db = {} as unknown as queries.ForumDiscordDb;

function forumRow(requireTagSet: boolean): HubForumDiscordForumSelect {
  return {
    id: 7,
    discordGuildId: 'g1',
    channelId: 'c1',
    managed: false,
    webhookId: null,
    webhookTokenEnc: null,
    requireTagSet,
    createdAt: new Date(0),
  };
}

function info(over: Partial<ForumInfo> = {}): ForumInfo {
  return {
    id: 'c1',
    name: 'forum',
    tags: [],
    missing: [],
    canManage: true,
    isPublic: true,
    requireTag: false,
    ...over,
  };
}

/** `addTags` answers with every tag the forum now holds (as Discord does). */
function fakeGateway(existing: ForumInfo['tags'] = []) {
  const addTags = jest.fn((_ch: string, names: string[]) =>
    Promise.resolve([
      ...existing,
      ...names.map((name) => ({ id: `tag:${name}`, name })),
    ]),
  );
  const requireTags = jest.fn(() => Promise.resolve());
  const applyTag = jest.fn(() => Promise.resolve());
  const gw = { addTags, requireTags, applyTag };
  return { gw, gateway: gw as unknown as HubForumDiscordGateway };
}

beforeEach(() => {
  jest.resetAllMocks();
  q.listForumBindings.mockResolvedValue([]);
  q.hubName.mockResolvedValue('Night Owls');
});

describe('shareForumTags — lone hub', () => {
  it('returns no tag on a forum that requires none', async () => {
    const { gw, gateway } = fakeGateway();
    const tag = await shareForumTags(db, gateway, {
      guildId: 1,
      forum: forumRow(false),
      info: info(),
    });
    expect(tag).toBeNull();
    expect(gw.addTags).not.toHaveBeenCalled();
  });

  it('assigns a tag when Discord already requires tags (moderator flag)', async () => {
    const { gw, gateway } = fakeGateway();
    const tag = await shareForumTags(db, gateway, {
      guildId: 1,
      forum: forumRow(false),
      info: info({ requireTag: true }),
    });
    expect(tag).toBe('tag:Night Owls');
    expect(gw.addTags).toHaveBeenCalledWith('c1', ['Night Owls']);
    expect(gw.requireTags).not.toHaveBeenCalled();
  });

  it('assigns a tag when the bot left Require tags on after an old share', async () => {
    const tags = [{ id: 'old', name: 'Night Owls' }];
    const { gateway } = fakeGateway(tags);
    const tag = await shareForumTags(db, gateway, {
      guildId: 1,
      forum: forumRow(true),
      info: info({ tags }),
    });
    expect(tag).toBe('old');
  });
});

describe('shareForumTags — a 2nd hub joins (ROK-2258)', () => {
  it("re-tags the 1st hub's posts with the tag it got while alone", async () => {
    const { gw, gateway } = fakeGateway([{ id: 't-a', name: 'Alpha' }]);
    q.listForumBindings.mockResolvedValue([
      { guildId: 2, tagId: 't-a', hubName: 'Alpha' },
    ]);
    q.linkedThreadIds.mockResolvedValue(['post-a']);
    const tag = await shareForumTags(db, gateway, {
      guildId: 1,
      forum: forumRow(false),
      info: info({ tags: [{ id: 't-a', name: 'Alpha' }] }),
    });
    expect(tag).toBe('tag:Night Owls');
    expect(q.linkedThreadIds).toHaveBeenCalledWith(db, 2);
    expect(gw.applyTag).toHaveBeenCalledWith('c1', ['post-a'], 't-a');
    expect(gw.requireTags).toHaveBeenCalledWith('c1');
  });

  it('leaves tagged hubs alone when a 3rd hub joins (Require tags is already on)', async () => {
    const tags = [
      { id: 't-a', name: 'Alpha' },
      { id: 't-b', name: 'Beta' },
    ];
    const { gw, gateway } = fakeGateway(tags);
    q.listForumBindings.mockResolvedValue([
      { guildId: 2, tagId: 't-a', hubName: 'Alpha' },
      { guildId: 3, tagId: 't-b', hubName: 'Beta' },
    ]);
    await shareForumTags(db, gateway, {
      guildId: 1,
      forum: forumRow(true),
      info: info({ tags, requireTag: true }),
    });
    expect(gw.applyTag).not.toHaveBeenCalled();
  });
});
