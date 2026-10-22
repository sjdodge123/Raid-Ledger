/**
 * ROK-1428 (Codex r18 P2) — an unarchive whose Discord phase fails after the
 * move (an overwrite restore throws or times out once the `@everyone` lock is
 * cleared) must not leave a writable channel outside Archived while its
 * binding stays archived. The in-flight edits are settled first, then the
 * lock is re-applied and the channel moved back to its Archived parent.
 */
import { ChannelType, OverwriteType, PermissionFlagsBits } from 'discord.js';
import type { ArchivedOverwrites } from '../../drizzle/schema/channel-bindings';
import { unarchiveChannel } from './channel-lifecycle.archive-ops';

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
const SEND = PermissionFlagsBits.SendMessages;

interface FakeOverwrite {
  id: string;
  type: OverwriteType;
  allow: { bitfield: bigint };
  deny: { bitfield: bigint };
}

const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** The v2 record an archive of a plain channel writes (send lock). */
const ADDED: ArchivedOverwrites = {
  changes: [
    { target: 'bot', flag: 'SendMessages', prior: 'inherit' },
    { target: 'everyone', flag: 'SendMessages', prior: 'inherit' },
  ],
};

function setSend(
  cache: Map<string, FakeOverwrite>,
  id: string,
  v: boolean | null | undefined,
  type: OverwriteType,
): void {
  if (v === undefined) return;
  const ow = cache.get(id) ?? {
    id,
    type,
    allow: { bitfield: 0n },
    deny: { bitfield: 0n },
  };
  ow.allow.bitfield &= ~SEND;
  ow.deny.bitfield &= ~SEND;
  if (v === true) ow.allow.bitfield |= SEND;
  if (v === false) ow.deny.bitfield |= SEND;
  cache.set(id, ow);
}

interface Behaviour {
  /** Delay (ms) before the `@everyone` overwrite delete lands. */
  everyoneDeleteMs?: number;
  /** The bot overwrite delete rejects. */
  botDeleteFails?: boolean;
}

/** An archived channel (send-locked, under `arch-cat`) with scripted failures. */
function archivedChannel(b: Behaviour) {
  const cache = new Map<string, FakeOverwrite>();
  setSend(cache, GUILD, false, OverwriteType.Role);
  setSend(cache, BOT, true, OverwriteType.Member);
  const edit = jest.fn(
    (
      id: string,
      opts: { SendMessages?: boolean | null },
      meta: { type: OverwriteType },
    ): Promise<void> =>
      Promise.resolve(setSend(cache, id, opts.SendMessages, meta.type)),
  );
  const del = jest.fn((id: string): Promise<void> => {
    if (id === BOT && b.botDeleteFails)
      return Promise.reject(new Error('bot overwrite delete failed'));
    const ms = id === GUILD ? (b.everyoneDeleteMs ?? 0) : 0;
    return wait(ms).then(() => void cache.delete(id));
  });
  const ch = {
    id: 'ch-1',
    type: ChannelType.GuildText,
    parentId: 'arch-cat',
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
  return { guild, cache };
}

/** Whether `@everyone` is still denied SendMessages (the archive lock). */
function everyoneLocked(cache: Map<string, FakeOverwrite>): boolean {
  const ow = cache.get(GUILD);
  return ow !== undefined && (ow.deny.bitfield & SEND) === SEND;
}

const run = (guild: unknown) =>
  unarchiveChannel(guild as never, 'ch-1', {
    parentId: 'games-cat',
    added: ADDED,
  });

describe('unarchiveChannel — a Discord-phase failure is compensated (Codex r18 P2)', () => {
  it('re-locks and moves back to Archived when an overwrite restore throws after the @everyone unlock', async () => {
    const { guild, cache } = archivedChannel({ botDeleteFails: true });
    await expect(run(guild)).rejects.toThrow('bot overwrite delete failed');
    expect(everyoneLocked(cache)).toBe(true);
    expect(guild.channels.edit).toHaveBeenLastCalledWith('ch-1', {
      parent: 'arch-cat',
      lockPermissions: false,
    });
  });

  it('waits for a timed-out @everyone unlock to land before re-locking', async () => {
    const { guild, cache } = archivedChannel({ everyoneDeleteMs: 20 });
    await expect(run(guild)).rejects.toThrow();
    await wait(40); // let any still-pending edit land
    expect(everyoneLocked(cache)).toBe(true);
    expect(guild.channels.edit).toHaveBeenLastCalledWith('ch-1', {
      parent: 'arch-cat',
      lockPermissions: false,
    });
  });

  it('a clean unarchive is not reverted', async () => {
    const { guild, cache } = archivedChannel({});
    await expect(run(guild)).resolves.toEqual({ previousParentId: 'arch-cat' });
    expect(everyoneLocked(cache)).toBe(false);
    expect(guild.channels.edit).toHaveBeenCalledTimes(1);
  });
});
