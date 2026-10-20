/**
 * ROK-1428 Codex r4b P2s — the archive lock covers thread replies/creation,
 * and a restore skips overwrite targets deleted while the channel was archived.
 */
import {
  DiscordAPIError,
  OverwriteType,
  PermissionFlagsBits,
  type PermissionOverwriteManager,
} from 'discord.js';
import {
  planArchive,
  restorePriors,
  writeLock,
  type OverwriteIds,
} from './channel-lifecycle.overwrites';

type FlagName = keyof typeof PermissionFlagsBits;
interface FakeOw {
  id: string;
  type: OverwriteType;
  allow: { bitfield: bigint };
  deny: { bitfield: bigint };
}
type Opts = Partial<Record<string, boolean | null>>;

const IDS: OverwriteIds = { everyoneId: 'g1', botId: 'bot' };
const THREAD_FLAGS = [
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
] as const;

function isFlag(f: string): f is FlagName {
  return f in PermissionFlagsBits;
}

/** A permission-overwrite manager that applies edits like Discord. */
function fakePo(): {
  po: PermissionOverwriteManager;
  cache: Map<string, FakeOw>;
  edit: jest.Mock;
} {
  const cache = new Map<string, FakeOw>();
  const edit = jest.fn(
    (id: string, opts: Opts, meta: { type: OverwriteType }) => {
      const ow = cache.get(id) ?? {
        id,
        type: meta.type,
        allow: { bitfield: 0n },
        deny: { bitfield: 0n },
      };
      for (const [flag, v] of Object.entries(opts)) {
        if (!isFlag(flag) || v === undefined) continue;
        const bit = PermissionFlagsBits[flag];
        ow.allow.bitfield &= ~bit;
        ow.deny.bitfield &= ~bit;
        if (v === true) ow.allow.bitfield |= bit;
        if (v === false) ow.deny.bitfield |= bit;
      }
      cache.set(id, ow);
      return Promise.resolve();
    },
  );
  const del = jest.fn((id: string) => Promise.resolve(cache.delete(id)));
  const po = { cache, edit, delete: del };
  return { po: po as unknown as PermissionOverwriteManager, cache, edit };
}

const bits = (...flags: FlagName[]): bigint =>
  flags.reduce((acc, f) => acc | PermissionFlagsBits[f], 0n);

describe('archive lock covers threads (hideOnArchive:false)', () => {
  it('denies thread replies + thread creation for @everyone and turns a role Allow into a Deny', async () => {
    const { po, cache } = fakePo();
    cache.set('members', {
      id: 'members',
      type: OverwriteType.Role,
      allow: { bitfield: bits('SendMessagesInThreads') },
      deny: { bitfield: 0n },
    });
    const changes = planArchive(po, IDS, false);
    await writeLock(po, IDS, changes);
    const everyone = cache.get('g1');
    for (const flag of THREAD_FLAGS) {
      expect({
        flag,
        denied: (everyone?.deny.bitfield ?? 0n) & bits(flag),
      }).toEqual({
        flag,
        denied: bits(flag),
      });
    }
    expect(cache.get('members')?.deny.bitfield).toBe(
      bits('SendMessagesInThreads'),
    );
  });

  it('unarchive restores the thread bits exactly (role Allow back, @everyone cleared)', async () => {
    const { po, cache } = fakePo();
    const allow = bits('SendMessagesInThreads');
    cache.set('members', {
      id: 'members',
      type: OverwriteType.Role,
      allow: { bitfield: allow },
      deny: { bitfield: 0n },
    });
    const changes = planArchive(po, IDS, false);
    await writeLock(po, IDS, changes);
    await restorePriors(po, IDS, changes);
    expect(cache.get('members')?.allow.bitfield).toBe(allow);
    expect(cache.get('members')?.deny.bitfield).toBe(0n);
    expect(cache.has('g1')).toBe(false);
  });
});

describe('restore skips targets deleted while archived', () => {
  it('a deleted role (10011) is skipped; @everyone is still restored', async () => {
    const { po, cache, edit } = fakePo();
    cache.set('g1', {
      id: 'g1',
      type: OverwriteType.Role,
      allow: { bitfield: 0n },
      deny: { bitfield: bits('SendMessages') },
    });
    const gone = new DiscordAPIError(
      { code: 10011, message: 'Unknown Role' },
      10011,
      404,
      'PUT',
      '/channels/c/permissions/r-gone',
      {},
    );
    const real = edit.getMockImplementation();
    edit.mockImplementation((id: string, ...rest: unknown[]) =>
      id === 'r-gone' ? Promise.reject(gone) : real?.(id, ...rest),
    );
    await expect(
      restorePriors(po, IDS, [
        { target: 'role', id: 'r-gone', flag: 'SendMessages', prior: 'allow' },
        { target: 'everyone', flag: 'SendMessages', prior: 'inherit' },
      ]),
    ).resolves.toBeUndefined();
    expect(cache.has('g1')).toBe(false);
  });
});
