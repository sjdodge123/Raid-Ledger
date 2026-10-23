/**
 * ROK-1933 Part 4 — the welcome's find / edit-or-post rules, on structural
 * fakes (the helpers' whole contract).
 */
import { discordError } from '../join-post/join-post.integration.spec-helpers';
import type {
  JoinPostChannel,
  JoinPostMessage,
  JoinPostPayload,
} from '../join-post/join-post-message.helpers';
import {
  isOwnHubWelcome,
  locateHubWelcome,
  writeHubWelcome,
} from './hub-welcome-message.helpers';

const BOT = 'bot-1933';
const PAYLOAD = { embeds: [], components: [] } as unknown as JoinPostPayload;

function msg(
  id: string,
  over: { authorId?: string; author?: string; title?: string } = {},
): JoinPostMessage & { edit: jest.Mock } {
  return {
    id,
    pinned: false,
    author: { id: over.authorId ?? BOT },
    embeds: [
      {
        author: { name: over.author ?? 'Raid Ledger' },
        title: over.title ?? 'Ashlands on Raid Ledger',
      },
    ],
    edit: jest.fn(() => Promise.resolve(undefined)),
    pin: jest.fn(() => Promise.resolve(undefined)),
  };
}

function channel(opts: {
  stored?: JoinPostMessage | Error;
  recent?: JoinPostMessage[];
}): JoinPostChannel & { send: jest.Mock } {
  const fetch = jest.fn((arg: { message?: string; limit?: number }) => {
    if (arg.message === undefined) {
      return Promise.resolve(
        new Map((opts.recent ?? []).map((m) => [m.id, m])),
      );
    }
    const s = opts.stored;
    return s instanceof Error || s === undefined
      ? Promise.reject(s ?? discordError(10008))
      : Promise.resolve(s);
  });
  return {
    id: 'c1',
    send: jest.fn(() => Promise.resolve(msg('new'))),
    messages: {
      fetch: fetch as unknown as JoinPostChannel['messages']['fetch'],
      fetchPins: jest.fn(() => Promise.resolve({ items: [], hasMore: false })),
      delete: jest.fn(() => Promise.resolve(undefined)),
    },
  };
}

describe('isOwnHubWelcome', () => {
  it('matches the bot author, the author line and this hub title', () => {
    expect(isOwnHubWelcome(msg('a'), BOT, 'Ashlands')).toBe(true);
  });

  it.each([
    ['another author', { authorId: 'someone' }],
    ['a generic Raid Ledger embed', { title: 'Raid night tonight' }],
    ["another hub's welcome", { title: 'Mistlands on Raid Ledger' }],
    ['the join post', { author: '\u{1F44B} JOIN RAID LEDGER' }],
  ])('rejects %s', (_label, over) => {
    expect(isOwnHubWelcome(msg('a', over), BOT, 'Ashlands')).toBe(false);
  });
});

describe('locateHubWelcome', () => {
  it('returns the stored message when Discord still has it', async () => {
    const stored = msg('s1');
    const found = await locateHubWelcome(
      channel({ stored }),
      's1',
      BOT,
      'Ashlands',
    );
    expect(found?.id).toBe('s1');
  });

  it('falls back to a history scan on 10008', async () => {
    const orphan = msg('o1');
    const ch = channel({ stored: discordError(10008), recent: [orphan] });
    const found = await locateHubWelcome(ch, 's1', BOT, 'Ashlands');
    expect(found?.id).toBe('o1');
  });

  it('rethrows any other read failure (no duplicate)', async () => {
    const ch = channel({ stored: discordError(50001) });
    await expect(locateHubWelcome(ch, 's1', BOT, 'Ashlands')).rejects.toThrow(
      'Discord 50001',
    );
  });

  it('scans when no id is stored and ignores other hubs', async () => {
    const other = msg('x', { title: 'Mistlands on Raid Ledger' });
    const ch = channel({ recent: [other] });
    expect(await locateHubWelcome(ch, null, BOT, 'Ashlands')).toBeNull();
  });
});

describe('writeHubWelcome', () => {
  it('edits the located message in place', async () => {
    const located = msg('s1');
    const ch = channel({});
    const out = await writeHubWelcome(ch, located, PAYLOAD);
    expect(out).toEqual({ message: located, result: 'edited' });
    expect(ch.send).not.toHaveBeenCalled();
  });

  it('posts when the edit answers 10008', async () => {
    const located = msg('s1');
    located.edit.mockRejectedValue(discordError(10008));
    const out = await writeHubWelcome(channel({}), located, PAYLOAD);
    expect(out.result).toBe('posted');
    expect(out.message.id).toBe('new');
  });

  it('rethrows a transient edit failure without posting', async () => {
    const located = msg('s1');
    located.edit.mockRejectedValue(discordError(500));
    const ch = channel({});
    await expect(writeHubWelcome(ch, located, PAYLOAD)).rejects.toThrow();
    expect(ch.send).not.toHaveBeenCalled();
  });

  it('posts when nothing was located', async () => {
    const out = await writeHubWelcome(channel({}), null, PAYLOAD);
    expect(out.result).toBe('posted');
  });
});
