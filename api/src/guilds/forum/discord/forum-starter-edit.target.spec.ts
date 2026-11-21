/**
 * ROK-2292 Codex P2 — the starter edit applies the hub binding guard
 * `HubForumDiscordOutboundService.jobFor` enforces (a binding with a webhook,
 * a post no older than `bound_at`), so unlinking or rebinding a hub stops the
 * card sync on its old posts; and `locked` comes from our lock/delete stamps.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import { findStarterPost } from './forum-starter-edit.target';
import { isCurrentBindingLink } from './hub-forum-discord-links.queries';
import { findBinding, type ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./hub-forum-discord.queries', () => ({ findBinding: jest.fn() }));
jest.mock('./hub-forum-discord-links.queries', () => ({
  isCurrentBindingLink: jest.fn(),
}));
const binding = jest.mocked(findBinding);
const current = jest.mocked(isCurrentBindingLink);

const OPEN = { discordLockedAt: null, discordDeletedAt: null };
const LINK = {
  ...OPEN,
  guildId: 7,
  origin: 'raidledger',
  createdAt: new Date(),
};
const BOUND = {
  binding: {},
  forum: { channelId: 'forum-1', webhookId: 'wh-1' },
};

function setup(registry: unknown[], hub: unknown[]) {
  const db: MockDb = createDrizzleMock();
  db.limit.mockResolvedValueOnce(registry).mockResolvedValueOnce(hub);
  binding.mockReset().mockResolvedValue(BOUND as never);
  current.mockReset().mockResolvedValue(true);
  return db as unknown as ForumDiscordDb;
}

describe('ROK-2292 findStarterPost', () => {
  it('a registry post is the bot’s; locked from its lock stamp', async () => {
    const db = setup([{ ...OPEN, discordLockedAt: new Date() }], []);
    await expect(findStarterPost(db, 't1')).resolves.toEqual({
      author: { kind: 'bot' },
      locked: true,
    });
  });

  it('a current-binding hub post is the webhook’s', async () => {
    const db = setup([], [LINK]);
    await expect(findStarterPost(db, 't1')).resolves.toEqual({
      author: {
        kind: 'webhook',
        target: { channelId: 'forum-1', webhookId: 'wh-1' },
      },
      locked: false,
    });
    expect(binding).toHaveBeenCalledWith(db, 7);
  });

  it('an unlinked hub (no binding) → gone', async () => {
    const db = setup([], [LINK]);
    binding.mockResolvedValue(null);
    await expect(findStarterPost(db, 't1')).resolves.toBe('gone');
  });

  it('a binding without a webhook yet → gone', async () => {
    const db = setup([], [LINK]);
    const noHook = { ...BOUND, forum: { ...BOUND.forum, webhookId: null } };
    binding.mockResolvedValue(noHook as never);
    await expect(findStarterPost(db, 't1')).resolves.toBe('gone');
  });

  it('a post from a previous binding (rebound, older than bound_at) → gone', async () => {
    const db = setup([], [LINK]);
    current.mockResolvedValue(false);
    await expect(findStarterPost(db, 't1')).resolves.toBe('gone');
  });

  it('a Discord-authored post or no record at all → gone', async () => {
    const db = setup([], [{ ...LINK, origin: 'discord' }]);
    await expect(findStarterPost(db, 't1')).resolves.toBe('gone');
    const none = setup([], []);
    await expect(findStarterPost(none, 't2')).resolves.toBe('gone');
  });
});
