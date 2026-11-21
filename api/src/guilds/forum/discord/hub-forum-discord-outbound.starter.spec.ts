/**
 * ROK-2292 — the gateway's starter-card edit: the author comes from our
 * records (no `fetchStarterMessage` GET), a missing webhook is a typed
 * `'gone'` (Codex P2), the webhook is reused across edits (review MINOR),
 * an event post gets a 1-week auto-archive after create (review MAJOR).
 */
import { ChannelType, ThreadAutoArchiveDuration } from 'discord.js';
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { HubForumDiscordRouteResolver } from './hub-forum-discord-route';

const CARD = { embeds: [], components: [] };
const TARGET = { channelId: 'forum-1', webhookId: 'wh-1' };
const WEBHOOK = { kind: 'webhook' as const, target: TARGET };

function setup() {
  const hook = {
    token: 'tok',
    editMessage: jest.fn(() => Promise.resolve()),
    send: jest.fn(() => Promise.resolve({ channelId: 'post-1', id: 'm1' })),
  };
  const hooks = new Map([['wh-1', hook]]);
  const forum = {
    type: ChannelType.GuildForum,
    fetchWebhooks: jest.fn(() => Promise.resolve(hooks)),
    availableTags: [],
  };
  const thread = {
    isThread: () => true,
    archived: true,
    messages: { edit: jest.fn(() => Promise.resolve()) },
    fetchStarterMessage: jest.fn(),
    setArchived: jest.fn(() => Promise.resolve()),
    setAutoArchiveDuration: jest.fn(() => Promise.resolve()),
  };
  const fetch = jest.fn((id: string) =>
    Promise.resolve(id === 'forum-1' ? forum : thread),
  );
  const guild = { channels: { fetch, cache: new Map() } };
  const client = { isConnected: () => true, getGuild: () => guild };
  const gw = new HubForumDiscordOutboundGateway(
    client as unknown as DiscordBotClientService,
    {
      resolve: () => Promise.resolve(null),
    } as unknown as HubForumDiscordRouteResolver,
  );
  return { gw, hook, hooks, forum, thread };
}

describe('ROK-2292 HubForumDiscordOutboundGateway.editStarterCard', () => {
  it('a bot starter is edited by the bot (message id = thread id), no starter GET', async () => {
    const t = setup();
    await expect(
      t.gw.editStarterCard('post-1', CARD, { kind: 'bot' }),
    ).resolves.toBe('ok');
    expect(t.thread.messages.edit).toHaveBeenCalledWith(
      'post-1',
      expect.objectContaining({ content: '', embeds: [], components: [] }),
    );
    expect(t.thread.fetchStarterMessage).not.toHaveBeenCalled();
  });

  it('a webhook starter is edited through the webhook, which is reused', async () => {
    const t = setup();
    await t.gw.editStarterCard('post-1', CARD, WEBHOOK);
    await t.gw.editStarterCard('post-2', CARD, WEBHOOK);
    expect(t.hook.editMessage).toHaveBeenCalledWith(
      'post-2',
      expect.objectContaining({ threadId: 'post-2', content: '' }),
    );
    expect(t.forum.fetchWebhooks).toHaveBeenCalledTimes(1);
  });

  it('Codex P2: a deleted webhook is gone (not a retried plain Error)', async () => {
    const t = setup();
    t.hooks.clear();
    await expect(t.gw.editStarterCard('post-1', CARD, WEBHOOK)).resolves.toBe(
      'gone',
    );
  });

  it('a failed webhook edit drops the cached webhook (re-fetched next time)', async () => {
    const t = setup();
    t.hook.editMessage.mockRejectedValueOnce(new Error('boom'));
    await expect(t.gw.editStarterCard('post-1', CARD, WEBHOOK)).rejects.toThrow(
      'boom',
    );
    await t.gw.editStarterCard('post-1', CARD, WEBHOOK);
    expect(t.forum.fetchWebhooks).toHaveBeenCalledTimes(2);
  });

  it('unarchiveThread reopens an archived post', async () => {
    const t = setup();
    await t.gw.unarchiveThread('post-1');
    expect(t.thread.setArchived).toHaveBeenCalledWith(
      false,
      expect.any(String),
    );
  });
});

describe('ROK-2292 HubForumDiscordOutboundGateway.createPost auto-archive', () => {
  const author = { username: 'RL', avatarURL: null };
  const post = { title: 'Raid', content: 'text', tagIds: [] };

  it('an event (card) post is set to a 1-week auto-archive', async () => {
    const t = setup();
    await t.gw.createPost(TARGET, { ...post, card: CARD }, author);
    expect(t.thread.setAutoArchiveDuration).toHaveBeenCalledWith(
      ThreadAutoArchiveDuration.OneWeek,
      expect.any(String),
    );
  });

  it('a failure to set it never fails the create (no duplicate post on retry)', async () => {
    const t = setup();
    t.thread.setAutoArchiveDuration.mockRejectedValueOnce(new Error('429'));
    await expect(
      t.gw.createPost(TARGET, { ...post, card: CARD }, author),
    ).resolves.toEqual({ threadId: 'post-1', messageId: 'm1' });
  });

  it('a text post is left alone', async () => {
    const t = setup();
    await t.gw.createPost(TARGET, post, author);
    expect(t.thread.setAutoArchiveDuration).not.toHaveBeenCalled();
  });
});
