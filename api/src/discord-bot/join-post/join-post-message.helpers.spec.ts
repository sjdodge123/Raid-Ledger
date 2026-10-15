import { DiscordAPIError } from 'discord.js';
import {
  findOwnJoinPost,
  readStored,
  tryPin,
  type JoinPostChannel,
  type JoinPostMessage,
} from './join-post-message.helpers';
import { JOIN_POST_AUTHOR } from './join-post.constants';

const BOT = 'bot-1';

/** A discord.js API error with a code, as the client throws it. */
function discordError(code: number, message = `Discord ${code}`): Error {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError & {
    code: number;
  };
  Object.defineProperty(err, 'code', { value: code });
  Object.defineProperty(err, 'message', { value: message });
  return err;
}

function fakeMessage(
  id: string,
  over: Partial<Pick<JoinPostMessage, 'pinned' | 'author' | 'embeds'>> = {},
): JoinPostMessage & { pin: jest.Mock; edit: jest.Mock } {
  return {
    id,
    pinned: false,
    author: { id: BOT },
    embeds: [{ author: { name: JOIN_POST_AUTHOR } }],
    edit: jest.fn().mockResolvedValue(undefined),
    pin: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

/** One page of `fetchPins`, newest pin first, timestamps descending. */
function pinPage(messages: JoinPostMessage[], newest: number) {
  return messages.map((message, i) => ({
    message,
    pinnedTimestamp: newest - i,
  }));
}

function fakeChannel(opts: {
  byId?: () => Promise<JoinPostMessage>;
  pins?: JoinPostMessage[];
  /** Paged pins: page N is served when `before` is page N-1's oldest pin. */
  pinPages?: JoinPostMessage[][];
  recent?: JoinPostMessage[];
  pinsError?: Error;
}): JoinPostChannel {
  const pages = (opts.pinPages ?? [opts.pins ?? []]).map((page, n) =>
    pinPage(page, 1_000_000 - n * 1_000),
  );
  // Untyped mock: one implementation serves both `fetch` overloads.
  const fetch = jest.fn();
  fetch.mockImplementation(
    (arg: string | { limit: number } | { message: string }) => {
      if (typeof arg !== 'string' && !('message' in arg)) {
        return Promise.resolve(
          new Map((opts.recent ?? []).map((m) => [m.id, m])),
        );
      }
      return opts.byId
        ? opts.byId()
        : Promise.reject(new Error('unexpected fetch by id'));
    },
  );
  return {
    id: 'chan-1',
    send: jest.fn(),
    messages: {
      fetch,
      fetchPins: jest.fn((options?: { before?: number }) => {
        if (opts.pinsError) return Promise.reject(opts.pinsError);
        const n = options?.before
          ? pages.findIndex(
              (p, i) =>
                i > 0 &&
                pages[i - 1]?.at(-1)?.pinnedTimestamp === options.before,
            )
          : 0;
        return Promise.resolve({
          items: pages[n] ?? [],
          hasMore: n >= 0 && n < pages.length - 1,
        });
      }),
      delete: jest.fn(),
    },
  };
}

describe('readStored', () => {
  it('returns the message when Discord has it', async () => {
    const msg = fakeMessage('m1');
    const channel = fakeChannel({ byId: () => Promise.resolve(msg) });
    await expect(readStored(channel, 'm1')).resolves.toBe(msg);
  });

  it('bypasses the discord.js cache, so a deleted post is not served stale', async () => {
    const msg = fakeMessage('m1');
    const channel = fakeChannel({ byId: () => Promise.resolve(msg) });
    await readStored(channel, 'm1');
    expect(channel.messages.fetch).toHaveBeenCalledWith({
      message: 'm1',
      force: true,
    });
  });

  it('answers null only for Unknown Message (10008)', async () => {
    const channel = fakeChannel({
      byId: () => Promise.reject(discordError(10008)),
    });
    await expect(readStored(channel, 'm1')).resolves.toBeNull();
  });

  it.each([
    ['another Discord API error', discordError(50001, 'Missing Access')],
    ['a network failure', new Error('socket hang up')],
  ])('rethrows %s instead of calling the post gone', async (_label, err) => {
    const channel = fakeChannel({ byId: () => Promise.reject(err) });
    await expect(readStored(channel, 'm1')).rejects.toBe(err);
  });
});

describe('findOwnJoinPost', () => {
  it('finds the bot’s own pinned join post', async () => {
    const own = fakeMessage('own', { pinned: true });
    const channel = fakeChannel({ pins: [own] });
    await expect(findOwnJoinPost(channel, BOT)).resolves.toBe(own);
  });

  it('ignores other authors and the bot’s other embeds', async () => {
    const otherAuthor = fakeMessage('a', { author: { id: 'someone' } });
    const otherEmbed = fakeMessage('b', {
      embeds: [{ author: { name: 'LFG' } }],
    });
    const noEmbed = fakeMessage('c', { embeds: [] });
    const channel = fakeChannel({
      pins: [otherAuthor],
      recent: [otherEmbed, noEmbed],
    });
    await expect(findOwnJoinPost(channel, BOT)).resolves.toBeNull();
  });

  // Codex P2: Discord pages pins 50 at a time; a post past the first page
  // must still be found, or a lost-settings re-post duplicates it.
  it('pages through pins until it finds the post', async () => {
    const own = fakeMessage('own', { pinned: true });
    const firstPage = Array.from({ length: 50 }, (_, i) =>
      fakeMessage(`other-${i}`, { author: { id: 'someone' } }),
    );
    const channel = fakeChannel({ pinPages: [firstPage, [own]], recent: [] });
    await expect(findOwnJoinPost(channel, BOT)).resolves.toBe(own);
  });

  it('falls back to recent history for an unpinned post', async () => {
    const own = fakeMessage('own');
    const channel = fakeChannel({ pins: [], recent: [own] });
    await expect(findOwnJoinPost(channel, BOT)).resolves.toBe(own);
  });

  it('answers null when the scan itself fails', async () => {
    const channel = fakeChannel({ pinsError: discordError(50001) });
    await expect(findOwnJoinPost(channel, BOT)).resolves.toBeNull();
  });
});

describe('tryPin', () => {
  it('does not re-pin an already pinned post', async () => {
    const msg = fakeMessage('m', { pinned: true });
    await expect(tryPin(msg, jest.fn())).resolves.toEqual({
      pinned: true,
      warning: null,
    });
    expect(msg.pin).not.toHaveBeenCalled();
  });

  it('pins an unpinned post', async () => {
    const msg = fakeMessage('m');
    await expect(tryPin(msg, jest.fn())).resolves.toEqual({
      pinned: true,
      warning: null,
    });
    expect(msg.pin).toHaveBeenCalledTimes(1);
  });

  it.each([
    [50013, 'Pin Messages'],
    [50001, 'Pin Messages'],
    [30003, 'maximum of 50 pinned messages'],
    [0, 'boom'],
  ])('warns (never throws) when the pin fails with %i', async (code, says) => {
    const msg = fakeMessage('m');
    msg.pin.mockRejectedValue(discordError(code, 'boom'));
    const warn = jest.fn();
    const result = await tryPin(msg, warn);
    expect(result.pinned).toBe(false);
    expect(result.warning).toContain(says);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(says));
  });
});
