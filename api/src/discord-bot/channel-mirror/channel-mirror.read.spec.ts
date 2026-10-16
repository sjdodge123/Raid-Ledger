/**
 * ROK-1788 — one uncached channel read, against port literals.
 */
import { DiscordAPIError } from 'discord.js';
import {
  CHANNEL_MIRROR_READ_TIMEOUT_MS,
  readChannelMirror,
  type MirrorChannelPort,
} from './channel-mirror.read';
import { sourceMessage } from './channel-mirror.spec-helpers';

const CTX = {
  channelId: '555',
  discordGuildId: 'G1',
  now: new Date('2026-10-15T12:00:00.000Z'),
};

function port(overrides: Partial<MirrorChannelPort> = {}): MirrorChannelPort {
  return {
    id: '555',
    name: 'announcements',
    botCanRead: () => true,
    isPrivate: () => false,
    fetchLatest: () => Promise.resolve([sourceMessage()]),
    ...overrides,
  };
}

function rejectWith(code: number): MirrorChannelPort['fetchLatest'] {
  return () =>
    Promise.reject(
      new DiscordAPIError({ code, message: 'x' }, code, 403, 'GET', '/c', {}),
    );
}

describe('readChannelMirror (D9 states)', () => {
  it('is gone when the channel is not a text channel of the server', async () => {
    await expect(readChannelMirror(null, CTX)).resolves.toEqual({
      state: 'gone',
      channelId: '555',
      channelName: null,
    });
  });

  it('is no-access without fetching when the bot lacks read permission', async () => {
    const fetchLatest = jest.fn();
    const read = await readChannelMirror(
      port({ botCanRead: () => false, fetchLatest }),
      CTX,
    );
    expect(read).toEqual({
      state: 'no-access',
      channelId: '555',
      channelName: 'announcements',
    });
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it('classifies 50001 as no-access and 10003 as gone', async () => {
    const noAccess = await readChannelMirror(
      port({ fetchLatest: rejectWith(50001) }),
      CTX,
    );
    expect(noAccess.state).toBe('no-access');
    const gone = await readChannelMirror(
      port({ fetchLatest: rejectWith(10003) }),
      CTX,
    );
    expect(gone.state).toBe('gone');
  });

  it('reports a transient failure as disconnected and hands the error to onError', async () => {
    const onError = jest.fn();
    const boom = new Error('socket hang up');
    const read = await readChannelMirror(
      port({ fetchLatest: () => Promise.reject(boom) }),
      { ...CTX, onError },
    );
    expect(read).toEqual({ state: 'disconnected', channelId: '555' });
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('returns ok with channel, url, visibility and mapped messages', async () => {
    const read = await readChannelMirror(port({ isPrivate: () => true }), CTX);
    expect(read).toMatchObject({
      state: 'ok',
      channel: {
        id: '555',
        name: 'announcements',
        visibility: 'private',
        url: 'https://discord.com/channels/G1/555',
      },
      fetchedAt: '2026-10-15T12:00:00.000Z',
    });
    expect(read.state === 'ok' ? read.messages.length : -1).toBe(1);
  });

  it('asks Discord for the latest 10', async () => {
    const fetchLatest = jest.fn().mockResolvedValue([]);
    await readChannelMirror(port({ fetchLatest }), CTX);
    expect(fetchLatest).toHaveBeenCalledWith(10);
  });
});

describe('readChannelMirror never rejects (review MINOR 1 + 2)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('degrades a message the mapping cannot handle to disconnected', async () => {
    const onError = jest.fn();
    const unmappable = {
      ...sourceMessage(),
      get content(): string {
        throw new TypeError('unexpected message shape');
      },
    };
    await expect(
      readChannelMirror(
        port({ fetchLatest: () => Promise.resolve([unmappable]) }),
        { ...CTX, onError },
      ),
    ).resolves.toEqual({ state: 'disconnected', channelId: '555' });
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError));
  });

  it('degrades a Discord read stuck past the timeout to disconnected', async () => {
    jest.useFakeTimers();
    const onError = jest.fn();
    const stuck = readChannelMirror(
      port({ fetchLatest: () => new Promise(() => undefined) }),
      { ...CTX, onError },
    );
    await jest.advanceTimersByTimeAsync(CHANNEL_MIRROR_READ_TIMEOUT_MS);
    const outcome = await Promise.race([
      stuck,
      Promise.resolve('still pending'),
    ]);
    expect(outcome).toEqual({ state: 'disconnected', channelId: '555' });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('timed out'),
      }),
    );
  });

  it('does not time out a read that answers inside the limit', async () => {
    jest.useFakeTimers();
    const slow = readChannelMirror(
      port({
        fetchLatest: () =>
          new Promise((resolve) => {
            setTimeout(() => resolve([sourceMessage()]), 4_000);
          }),
      }),
      CTX,
    );
    await jest.advanceTimersByTimeAsync(4_000);
    await expect(slow).resolves.toMatchObject({ state: 'ok' });
  });
});
