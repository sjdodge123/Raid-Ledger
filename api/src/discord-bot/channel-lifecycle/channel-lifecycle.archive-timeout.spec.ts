/**
 * ROK-1428 (Codex r8 P1) — the archive lock's overwrite edits outlive the
 * `timedDiscordCall` cap: the timeout rejects but `writeLock` keeps editing.
 * The rollback must wait for those edits to settle before restoring, or a
 * late edit re-locks an active channel that has no saved overwrite record.
 * A hung edit must not hang the run: the wait is bounded and reported.
 */
import * as Sentry from '@sentry/nestjs';
import { ChannelType, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { archiveChannel } from './channel-lifecycle.archive-ops';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

jest.mock('../services/scheduled-event.helpers', () => {
  const actual = jest.requireActual<
    typeof import('../services/scheduled-event.helpers')
  >('../services/scheduled-event.helpers');
  return {
    ...actual,
    // Settle bound (2x this) = 100ms; the per-call cap is 5ms.
    DISCORD_API_TIMEOUT_MS: 50,
    timedDiscordCall: <T>(op: string, fn: () => Promise<T>): Promise<T> =>
      actual.timedDiscordCall(op, fn, undefined, 5),
  };
});

const GUILD = 'guild-1';
const BOT = 'bot-1';

type FlagName = keyof typeof PermissionFlagsBits;
interface FakeOverwrite {
  id: string;
  type: OverwriteType;
  allow: { bitfield: bigint };
  deny: { bitfield: bigint };
}

const isFlag = (f: string): f is FlagName => f in PermissionFlagsBits;
/** A Discord edit that lands `ms` later — on the FAKE clock (see below). */
const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/*
 * Fake timers: the 5ms cap, the 100ms settle bound and the mocked edit delays
 * all race on one clock that only moves when the test advances it, and every
 * promise chain drains between timers. On real timers a loaded CI runner could
 * stall long enough for the 5ms cap to beat an "instant" (setTimeout 0) edit,
 * timing out the lock instead of the move (main run 39727906755).
 */
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

/** Expect `run` to reject with a timeout once the fake clock has moved `ms`. */
async function rejectsWithin(run: Promise<unknown>, ms: number): Promise<void> {
  const assertion = expect(run).rejects.toThrow(/timeout/);
  await jest.advanceTimersByTimeAsync(ms);
  await assertion;
}

function apply(
  cache: Map<string, FakeOverwrite>,
  id: string,
  opts: Record<string, boolean | null>,
  type: OverwriteType,
): void {
  const ow = cache.get(id) ?? {
    id,
    type,
    allow: { bitfield: 0n },
    deny: { bitfield: 0n },
  };
  for (const [flag, v] of Object.entries(opts)) {
    if (!isFlag(flag)) continue;
    const bit = PermissionFlagsBits[flag];
    ow.allow.bitfield &= ~bit;
    ow.deny.bitfield &= ~bit;
    if (v === true) ow.allow.bitfield |= bit;
    if (v === false) ow.deny.bitfield |= bit;
  }
  cache.set(id, ow);
}

/** A channel whose `@everyone` edit lands after `everyoneDelayMs` (null = never). */
function slowChannel(everyoneDelayMs: number | null) {
  const cache = new Map<string, FakeOverwrite>();
  const edit = jest.fn(
    (
      id: string,
      opts: Record<string, boolean | null>,
      meta: { type: OverwriteType },
    ): Promise<void> => {
      if (id !== GUILD)
        return Promise.resolve(apply(cache, id, opts, meta.type));
      if (everyoneDelayMs === null) return new Promise<void>(() => undefined);
      return wait(everyoneDelayMs).then(() =>
        apply(cache, id, opts, meta.type),
      );
    },
  );
  const del = jest.fn((id: string) => Promise.resolve(void cache.delete(id)));
  const ch = {
    id: 'ch-1',
    type: ChannelType.GuildText,
    parentId: 'games-cat',
    permissionOverwrites: { cache, edit, delete: del },
  };
  const guild = {
    id: GUILD,
    client: { user: { id: BOT } },
    channels: {
      cache: new Map(),
      fetch: jest.fn(() => Promise.resolve(ch)),
      edit: jest.fn<Promise<typeof ch>, [string, { parent: string | null }]>(
        () => Promise.resolve(ch),
      ),
    },
  };
  return { ch, guild, cache };
}

describe('archiveChannel — lock edits that outlive the timeout (Codex r8 P1)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('waits for the late @everyone edit before rolling back, so the channel ends unlocked', async () => {
    const { guild, cache } = slowChannel(20);
    // Cap fires at 5ms, the edit lands at 20ms; 60ms lets any late edit land.
    await rejectsWithin(
      archiveChannel(guild as never, 'ch-1', { categoryId: 'a', hide: true }),
      60,
    );
    const left = [...cache.values()].map((o) => [o.id, o.deny.bitfield]);
    expect(left).toEqual([]);
    expect(guild.channels.edit).not.toHaveBeenCalled();
  });

  it('a hung edit does not hang the run: the bounded wait gives up and reports it', async () => {
    const { guild } = slowChannel(null);
    // Past the 100ms settle bound (cap at 5ms + 2x50ms).
    await rejectsWithin(
      archiveChannel(guild as never, 'ch-1', { categoryId: 'a', hide: false }),
      150,
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('ch-1'),
      expect.objectContaining({ level: 'warning' }),
    );
  });
});

describe('archiveChannel — a move that lands after its timeout (Codex r10 P2)', () => {
  beforeEach(() => jest.clearAllMocks());

  /** A channel whose parent edit lands `moveDelayMs` later (past the 5ms cap). */
  function slowMove(moveDelayMs: number) {
    const fx = slowChannel(0);
    const move = (_id: string, opts: { parent: string | null }) =>
      wait(moveDelayMs).then(() => {
        fx.ch.parentId = opts.parent ?? 'none';
        return fx.ch;
      });
    fx.guild.channels.edit.mockImplementationOnce(move);
    fx.guild.channels.edit.mockImplementation((_id, opts) => {
      fx.ch.parentId = opts.parent ?? 'none';
      return Promise.resolve(fx.ch);
    });
    return fx;
  }

  it('moves a late-landing channel back to its original parent', async () => {
    const { ch, guild } = slowMove(20);
    // Move cap at 5ms, the move lands at 20ms (inside the settle bound).
    await rejectsWithin(
      archiveChannel(guild as never, 'ch-1', {
        categoryId: 'arch',
        hide: false,
      }),
      60,
    );
    expect(ch.parentId).toBe('games-cat');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('ch-1'),
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('a move that lands after the bounded wait is still moved back', async () => {
    const { ch, guild } = slowMove(150);
    // Settle bound gives up at ~105ms; the move lands at 150ms, then reverts.
    await rejectsWithin(
      archiveChannel(guild as never, 'ch-1', {
        categoryId: 'arch',
        hide: false,
      }),
      300,
    );
    expect(ch.parentId).toBe('games-cat');
  });
});
