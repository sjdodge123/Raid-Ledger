/**
 * ROK-1428 (Codex r7 P2) — a `guild.channels.create` that resolves AFTER the
 * `timedDiscordCall` cap already failed the create: nobody will ever bind or
 * clean up that channel, so `createTextChannel` deletes it when it lands.
 */
import { createTextChannel } from './channel-lifecycle.discord-ops';

jest.mock('../services/scheduled-event.helpers', () => {
  const actual = jest.requireActual<
    typeof import('../services/scheduled-event.helpers')
  >('../services/scheduled-event.helpers');
  return {
    ...actual,
    timedDiscordCall: <T>(op: string, fn: () => Promise<T>): Promise<T> =>
      actual.timedDiscordCall(op, fn, undefined, 5),
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function slowGuild(pending: Promise<{ id: string }>) {
  return {
    id: 'g-1',
    channels: {
      create: jest.fn(() => pending),
      delete: jest.fn(() => Promise.resolve()),
    },
  };
}

/** Let queued continuations (then → delete) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

const OPTS = { name: 'valheim', parentId: null, topic: 't' };

describe('createTextChannel — create that lands after the timeout (Codex r7 P2)', () => {
  it('deletes the late channel, since the run already treated the create as failed', async () => {
    const late = deferred<{ id: string }>();
    const guild = slowGuild(late.promise);
    await expect(createTextChannel(guild as never, OPTS)).rejects.toThrow(
      /timeout/,
    );
    late.resolve({ id: 'late-1' });
    await flush();
    expect(guild.channels.delete.mock.calls).toEqual([
      ['late-1', expect.stringContaining('timed out')],
    ]);
  });

  it('a late failure is swallowed (no unhandled rejection) and deletes nothing', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const late = deferred<{ id: string }>();
      const guild = slowGuild(late.promise);
      await expect(createTextChannel(guild as never, OPTS)).rejects.toThrow(
        /timeout/,
      );
      late.reject(new Error('late 500'));
      await flush();
      expect(unhandled).toEqual([]);
      expect(guild.channels.delete).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a late delete failure is swallowed too', async () => {
    const late = deferred<{ id: string }>();
    const guild = slowGuild(late.promise);
    guild.channels.delete.mockRejectedValueOnce(new Error('403'));
    await expect(createTextChannel(guild as never, OPTS)).rejects.toThrow(
      /timeout/,
    );
    late.resolve({ id: 'late-2' });
    await flush();
    expect(guild.channels.delete).toHaveBeenCalledTimes(1);
  });
});
