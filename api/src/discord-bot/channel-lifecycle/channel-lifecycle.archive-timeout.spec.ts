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
const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

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
    await expect(
      archiveChannel(guild as never, 'ch-1', { categoryId: 'a', hide: true }),
    ).rejects.toThrow(/timeout/);
    await wait(40); // let any still-pending edit land
    const left = [...cache.values()].map((o) => [o.id, o.deny.bitfield]);
    expect(left).toEqual([]);
    expect(guild.channels.edit).not.toHaveBeenCalled();
  });

  it('a hung edit does not hang the run: the bounded wait gives up and reports it', async () => {
    const { guild } = slowChannel(null);
    await expect(
      archiveChannel(guild as never, 'ch-1', { categoryId: 'a', hide: false }),
    ).rejects.toThrow(/timeout/);
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
    await expect(
      archiveChannel(guild as never, 'ch-1', {
        categoryId: 'arch',
        hide: false,
      }),
    ).rejects.toThrow(/timeout/);
    await wait(40); // let any still-pending edit land
    expect(ch.parentId).toBe('games-cat');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('ch-1'),
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('a move that lands after the bounded wait is still moved back', async () => {
    const { ch, guild } = slowMove(150);
    await expect(
      archiveChannel(guild as never, 'ch-1', {
        categoryId: 'arch',
        hide: false,
      }),
    ).rejects.toThrow(/timeout/);
    await wait(200);
    expect(ch.parentId).toBe('games-cat');
  });
});
