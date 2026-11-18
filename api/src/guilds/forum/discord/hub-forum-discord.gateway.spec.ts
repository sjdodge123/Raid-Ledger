/**
 * ROK-2258 review r1 — gateway writes against a fake discord.js forum:
 * `applyTag` never PATCHes a post that already carries the tag (MAJOR 2a),
 * and `setDefaultReactionIfUnset` leaves a moderator's emoji alone.
 */
import { ChannelType, DiscordAPIError } from 'discord.js';
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { HubForumDiscordGateway } from './hub-forum-discord.gateway';

interface FakeThread {
  appliedTags: string[];
  setAppliedTags: jest.Mock<Promise<void>, [string[], string]>;
}

function fakeThread(appliedTags: string[]): FakeThread {
  return {
    appliedTags,
    setAppliedTags: jest.fn<Promise<void>, [string[], string]>(() =>
      Promise.resolve(),
    ),
  };
}

function setup(
  threads: Record<string, FakeThread>,
  defaultReactionEmoji: { id: string | null; name: string | null } | null,
) {
  const forum = {
    type: ChannelType.GuildForum,
    defaultReactionEmoji,
    setDefaultReactionEmoji: jest.fn(() => Promise.resolve()),
    threads: {
      fetch: jest.fn((id: string) => Promise.resolve(threads[id] ?? null)),
    },
  };
  const guild = {
    channels: {
      fetch: jest.fn<Promise<unknown>, []>(() => Promise.resolve(forum)),
    },
    members: { me: null },
    roles: { everyone: {} },
  };
  const client = { isConnected: () => true, getGuild: () => guild };
  const gw = new HubForumDiscordGateway(
    client as unknown as DiscordBotClientService,
  );
  return { gw, forum, guild };
}

describe('ROK-2258 applyTag — no write when unchanged', () => {
  it('skips a post that already carries the tag', async () => {
    const tagged = fakeThread(['t-hub', 't-event']);
    const t = setup({ p1: tagged }, null);
    await t.gw.applyTag('c1', ['p1'], 't-event');
    expect(tagged.setAppliedTags).not.toHaveBeenCalled();
  });

  it('adds the tag to a post that lacks it, keeping its others', async () => {
    const bare = fakeThread(['t-hub']);
    const t = setup({ p2: bare }, null);
    await t.gw.applyTag('c1', ['p2'], 't-event');
    expect(bare.setAppliedTags).toHaveBeenCalledWith(
      ['t-hub', 't-event'],
      expect.any(String),
    );
  });
});

describe("ROK-2258 setDefaultReactionIfUnset — a moderator's emoji stays", () => {
  it("leaves a moderator's custom emoji alone", async () => {
    const t = setup({}, { id: '123', name: 'pepe' });
    expect(await t.gw.setDefaultReactionIfUnset('c1')).toBe(false);
    expect(t.forum.setDefaultReactionEmoji).not.toHaveBeenCalled();
  });

  it('sets 👍 when no default reaction is set', async () => {
    const t = setup({}, null);
    expect(await t.gw.setDefaultReactionIfUnset('c1')).toBe(true);
    expect(t.forum.setDefaultReactionEmoji).toHaveBeenCalledWith(
      { id: null, name: '👍' },
      expect.any(String),
    );
  });
});

function discordError(code: number, status: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `code ${String(code)}` },
    code,
    status,
    'GET',
    '/channels/c1',
    {},
  );
}

describe('ROK-2258 Codex P2 #4 — applyTag surfaces transient errors', () => {
  it('rejects on a rate limit (429) so the backfill retries', async () => {
    const bare = fakeThread([]);
    bare.setAppliedTags.mockRejectedValueOnce(discordError(0, 429));
    const t = setup({ p1: bare }, null);
    await expect(t.gw.applyTag('c1', ['p1'], 't-x')).rejects.toThrow('code 0');
  });

  it('skips a post Discord refuses for good (50013) and tags the rest', async () => {
    const refused = fakeThread([]);
    refused.setAppliedTags.mockRejectedValueOnce(discordError(50013, 403));
    const next = fakeThread([]);
    const t = setup({ p1: refused, p2: next }, null);
    await t.gw.applyTag('c1', ['p1', 'p2'], 't-x');
    expect(next.setAppliedTags).toHaveBeenCalledWith(
      ['t-x'],
      expect.any(String),
    );
  });
});

describe('ROK-2258 Codex P2 #5 — fetchForum tells gone from transient', () => {
  it('answers null for Unknown Channel (10003)', async () => {
    const t = setup({}, null);
    t.guild.channels.fetch.mockRejectedValueOnce(discordError(10003, 404));
    expect(await t.gw.fetchForum('c1')).toBeNull();
  });

  it('rejects on a transient lookup failure (5xx / network)', async () => {
    const t = setup({}, null);
    t.guild.channels.fetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(t.gw.fetchForum('c1')).rejects.toThrow('ECONNRESET');
  });
});
