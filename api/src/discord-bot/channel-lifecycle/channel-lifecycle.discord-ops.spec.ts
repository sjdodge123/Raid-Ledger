/**
 * Unit tests for the channel-lifecycle Discord ops (ROK-1431, spec ROK-1428
 * D5/D6/D10/D14). Mirrors `ephemeral-voice.discord-ops.spec.ts`: a fake
 * `Guild` whose permission-overwrite manager really applies allow/deny bits,
 * so archive → unarchive can be checked as an exact inverse.
 */
import {
  ChannelType,
  Collection,
  DiscordAPIError,
  OverwriteType,
  PermissionFlagsBits,
} from 'discord.js';
import {
  archiveChannel,
  createTextChannel,
  ensureCategory,
  setTopic,
  unarchiveChannel,
} from './channel-lifecycle.discord-ops';
import {
  ChannelGoneError,
  LifecyclePermissionError,
} from './channel-lifecycle.errors';

jest.mock('../services/scheduled-event.helpers', () => ({
  timedDiscordCall: (_label: string, fn: () => unknown) => fn(),
}));

const GUILD = 'guild-1';
const BOT = 'bot-1';
type FlagName = keyof typeof PermissionFlagsBits;
type FlagOpts = Partial<Record<FlagName, boolean | null>>;

interface FakeOverwrite {
  id: string;
  type: OverwriteType;
  allow: { bitfield: bigint };
  deny: { bitfield: bigint };
}

interface FakeChannel {
  id: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  permissionOverwrites: {
    cache: Map<string, FakeOverwrite>;
    edit: jest.Mock<Promise<void>, [string, FlagOpts, { type: OverwriteType }]>;
    delete: jest.Mock;
  };
}

function isFlag(flag: string): flag is FlagName {
  return flag in PermissionFlagsBits;
}

/** Apply one `{Flag: true|false|null}` entry to an overwrite, like Discord. */
function applyFlag(ow: FakeOverwrite, flag: FlagName, v: boolean | null): void {
  const bit = PermissionFlagsBits[flag];
  ow.allow.bitfield &= ~bit;
  ow.deny.bitfield &= ~bit;
  if (v === true) ow.allow.bitfield |= bit;
  if (v === false) ow.deny.bitfield |= bit;
}

function makeOverwrites(): FakeChannel['permissionOverwrites'] {
  const cache = new Map<string, FakeOverwrite>();
  const edit = jest.fn<
    Promise<void>,
    [string, FlagOpts, { type: OverwriteType }]
  >((id, opts, meta) => {
    const ow = cache.get(id) ?? {
      id,
      type: meta.type,
      allow: { bitfield: 0n },
      deny: { bitfield: 0n },
    };
    for (const [flag, v] of Object.entries(opts)) {
      if (isFlag(flag) && v !== undefined) applyFlag(ow, flag, v);
    }
    cache.set(id, ow);
    return Promise.resolve();
  });
  const del = jest.fn((id: string) => {
    cache.delete(id);
    return Promise.resolve();
  });
  return { cache, edit, delete: del };
}

function makeChannel(
  id: string,
  over: Partial<Omit<FakeChannel, 'permissionOverwrites'>> = {},
): FakeChannel {
  return {
    id,
    name: id,
    type: ChannelType.GuildText,
    parentId: null,
    ...over,
    permissionOverwrites: makeOverwrites(),
  };
}

function makeGuild() {
  const cache = new Collection<string, FakeChannel>();
  let seq = 0;
  return {
    id: GUILD,
    client: { user: { id: BOT } },
    channels: {
      cache,
      fetch: jest.fn((id: string) => Promise.resolve(cache.get(id) ?? null)),
      create: jest.fn((opts: { name: string; type: ChannelType }) => {
        seq += 1;
        const ch = makeChannel(`new-${seq}`, {
          name: opts.name,
          type: opts.type,
        });
        cache.set(ch.id, ch);
        return Promise.resolve(ch);
      }),
      edit: jest.fn((id: string, opts: { parent?: string | null }) => {
        const ch = cache.get(id);
        if (ch && opts.parent !== undefined) ch.parentId = opts.parent;
        return Promise.resolve(ch);
      }),
    },
  };
}
type FakeGuild = ReturnType<typeof makeGuild>;

function discordError(code: number): DiscordAPIError {
  const err: DiscordAPIError = Object.create(DiscordAPIError.prototype);
  Object.defineProperty(err, 'code', { value: code });
  Object.defineProperty(err, 'message', { value: `Discord ${code}` });
  return err;
}

function addCategory(guild: FakeGuild, id: string, name: string, kids = 0) {
  guild.channels.cache.set(
    id,
    makeChannel(id, { name, type: ChannelType.GuildCategory }),
  );
  for (let i = 0; i < kids; i += 1) {
    const kid = makeChannel(`${id}-kid-${i}`, { parentId: id });
    guild.channels.cache.set(kid.id, kid);
  }
}

function snapshot(ch: FakeChannel): Record<string, [bigint, bigint]> {
  const out: Record<string, [bigint, bigint]> = {};
  for (const ow of ch.permissionOverwrites.cache.values()) {
    out[ow.id] = [ow.allow.bitfield, ow.deny.bitfield];
  }
  return out;
}

function setup(parentId: string | null = 'games-cat') {
  const guild = makeGuild();
  const ch = makeChannel('ch-1', { parentId });
  guild.channels.cache.set(ch.id, ch);
  return { guild, ch };
}

describe('createTextChannel', () => {
  it('creates a text channel under the parent with the topic', async () => {
    const guild = makeGuild();
    const id = await createTextChannel(guild as never, {
      name: 'valheim',
      parentId: 'games-cat',
      topic: 'Valheim on Raid Ledger',
    });
    expect(id).toBe('new-1');
    expect(guild.channels.create).toHaveBeenCalledWith({
      name: 'valheim',
      type: ChannelType.GuildText,
      parent: 'games-cat',
      topic: 'Valheim on Raid Ledger',
    });
  });

  it('truncates the name to 100 and the topic to 1024 chars', async () => {
    const guild = makeGuild();
    await createTextChannel(guild as never, {
      name: 'a'.repeat(140),
      parentId: null,
      topic: 't'.repeat(2000),
    });
    const opts = guild.channels.create.mock.calls[0]?.[0];
    expect(opts?.name).toHaveLength(100);
    expect(opts).toMatchObject({ topic: 't'.repeat(1024) });
    expect(opts).not.toHaveProperty('parent');
  });

  it('maps 50013 to LifecyclePermissionError', async () => {
    const guild = makeGuild();
    guild.channels.create.mockRejectedValueOnce(discordError(50013));
    await expect(
      createTextChannel(guild as never, {
        name: 'x',
        parentId: null,
        topic: '',
      }),
    ).rejects.toBeInstanceOf(LifecyclePermissionError);
  });
});

describe('archiveChannel', () => {
  it('denies @everyone SendMessages and moves under the archive category', async () => {
    const { guild, ch } = setup();
    const res = await archiveChannel(guild as never, 'ch-1', {
      categoryId: 'arch-cat',
      hide: false,
    });
    expect(res).toEqual({ previousParentId: 'games-cat' });
    expect(snapshot(ch)).toEqual({
      [GUILD]: [0n, PermissionFlagsBits.SendMessages],
    });
    expect(guild.channels.edit).toHaveBeenCalledWith('ch-1', {
      parent: 'arch-cat',
      lockPermissions: false,
    });
  });

  it('also denies ViewChannel when hide, keeping the bot able to see it', async () => {
    const { guild, ch } = setup();
    await archiveChannel(guild as never, 'ch-1', {
      categoryId: 'arch-cat',
      hide: true,
    });
    expect(snapshot(ch)).toEqual({
      [GUILD]: [
        0n,
        PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel,
      ],
      [BOT]: [PermissionFlagsBits.ViewChannel, 0n],
    });
  });

  it('fetches an uncached channel before archiving', async () => {
    const { guild, ch } = setup();
    guild.channels.cache.delete('ch-1');
    guild.channels.fetch.mockResolvedValueOnce(ch);
    await archiveChannel(guild as never, 'ch-1', {
      categoryId: 'arch-cat',
      hide: false,
    });
    expect(guild.channels.fetch).toHaveBeenCalledWith('ch-1');
    expect(guild.channels.edit).toHaveBeenCalledWith('ch-1', {
      parent: 'arch-cat',
      lockPermissions: false,
    });
    expect(snapshot(ch)).toEqual({
      [GUILD]: [0n, PermissionFlagsBits.SendMessages],
    });
  });
});

describe('archiveChannel — Discord errors', () => {
  it('throws ChannelGoneError when Discord answers 10003', async () => {
    const guild = makeGuild();
    guild.channels.fetch.mockRejectedValueOnce(discordError(10003));
    await expect(
      archiveChannel(guild as never, 'gone', { categoryId: 'a', hide: false }),
    ).rejects.toBeInstanceOf(ChannelGoneError);
  });

  it('throws ChannelGoneError when the fetch resolves null', async () => {
    const guild = makeGuild();
    await expect(
      archiveChannel(guild as never, 'gone', { categoryId: 'a', hide: false }),
    ).rejects.toMatchObject({ channelId: 'gone' });
  });

  it('maps 50001 on the move to LifecyclePermissionError', async () => {
    const { guild } = setup();
    guild.channels.edit.mockRejectedValueOnce(discordError(50001));
    await expect(
      archiveChannel(guild as never, 'ch-1', { categoryId: 'a', hide: false }),
    ).rejects.toMatchObject({ code: 50001, op: 'archive.move' });
  });

  it('propagates any other error untouched', async () => {
    const { guild } = setup();
    const boom = new Error('boom');
    guild.channels.edit.mockRejectedValueOnce(boom);
    await expect(
      archiveChannel(guild as never, 'ch-1', { categoryId: 'a', hide: false }),
    ).rejects.toBe(boom);
  });
});

describe('unarchiveChannel', () => {
  it('moves back to parentId and never writes an explicit Allow', async () => {
    const { guild, ch } = setup();
    await archiveChannel(guild as never, 'ch-1', {
      categoryId: 'arch-cat',
      hide: true,
    });
    const archiveEdits = ch.permissionOverwrites.edit.mock.calls.length;
    await unarchiveChannel(guild as never, 'ch-1', { parentId: 'games-cat' });
    expect(ch.parentId).toBe('games-cat');
    const calls = ch.permissionOverwrites.edit.mock.calls;
    for (const call of calls.slice(archiveEdits)) {
      expect(Object.values(call[1])).not.toContain(true);
    }
  });

  it.each([true, false])(
    'archive(hide=%s) then unarchive restores an empty overwrite map',
    async (hide) => {
      const { guild, ch } = setup();
      await archiveChannel(guild as never, 'ch-1', { categoryId: 'a', hide });
      await unarchiveChannel(guild as never, 'ch-1', { parentId: 'games-cat' });
      expect(snapshot(ch)).toEqual({});
    },
  );

  it('keeps pre-existing unrelated overwrites exactly as they were', async () => {
    const { guild, ch } = setup();
    const po = ch.permissionOverwrites;
    await po.edit(GUILD, { AddReactions: false }, { type: OverwriteType.Role });
    await po.edit(
      'role-x',
      { SendMessages: true },
      { type: OverwriteType.Role },
    );
    const before = snapshot(ch);
    await archiveChannel(guild as never, 'ch-1', {
      categoryId: 'a',
      hide: true,
    });
    await unarchiveChannel(guild as never, 'ch-1', { parentId: 'games-cat' });
    expect(snapshot(ch)).toEqual(before);
  });

  it('throws ChannelGoneError on 10003', async () => {
    const guild = makeGuild();
    guild.channels.fetch.mockRejectedValueOnce(discordError(10003));
    await expect(
      unarchiveChannel(guild as never, 'gone', { parentId: null }),
    ).rejects.toBeInstanceOf(ChannelGoneError);
  });
});

describe('setTopic', () => {
  it('edits the topic, truncated to 1024 chars', async () => {
    const { guild } = setup();
    await setTopic(guild as never, 'ch-1', 'x'.repeat(1100));
    expect(guild.channels.edit).toHaveBeenCalledWith('ch-1', {
      topic: 'x'.repeat(1024),
    });
  });

  it('maps 10003 to ChannelGoneError', async () => {
    const { guild } = setup();
    guild.channels.edit.mockRejectedValueOnce(discordError(10003));
    await expect(setTopic(guild as never, 'ch-1', 't')).rejects.toBeInstanceOf(
      ChannelGoneError,
    );
  });
});

describe('ensureCategory (D5)', () => {
  it('returns the configured id when it resolves to a category', async () => {
    const guild = makeGuild();
    addCategory(guild, 'cat-9', 'My Games');
    await expect(
      ensureCategory(guild as never, {
        id: 'cat-9',
        name: 'Games',
        needsRoom: false,
      }),
    ).resolves.toEqual({ id: 'cat-9', name: 'My Games', created: false });
    expect(guild.channels.create).not.toHaveBeenCalled();
  });

  it('falls back to a case-insensitive name match when the id is unknown', async () => {
    const guild = makeGuild();
    guild.channels.fetch.mockRejectedValueOnce(discordError(10003));
    addCategory(guild, 'cat-1', 'GAMES');
    const res = await ensureCategory(guild as never, {
      id: 'stale',
      name: 'Games',
      needsRoom: false,
    });
    expect(res).toEqual({ id: 'cat-1', name: 'GAMES', created: false });
  });

  it('creates the category when nothing matches', async () => {
    const guild = makeGuild();
    const res = await ensureCategory(guild as never, {
      id: null,
      name: 'Archived',
      needsRoom: true,
    });
    expect(res).toEqual({ id: 'new-1', name: 'Archived', created: true });
    expect(guild.channels.create).toHaveBeenCalledWith({
      name: 'Archived',
      type: ChannelType.GuildCategory,
    });
  });
});

describe('ensureCategory (D5) — 50-children overflow', () => {
  it('overflows a full category to "<name> 2"', async () => {
    const guild = makeGuild();
    addCategory(guild, 'arch', 'Archived', 50);
    const res = await ensureCategory(guild as never, {
      id: 'arch',
      name: 'Archived',
      needsRoom: true,
    });
    expect(res).toEqual({ id: 'new-1', name: 'Archived 2', created: true });
  });

  it('reuses an existing overflow category with room', async () => {
    const guild = makeGuild();
    addCategory(guild, 'arch', 'Archived', 50);
    addCategory(guild, 'arch2', 'archived 2', 10);
    const res = await ensureCategory(guild as never, {
      id: null,
      name: 'Archived',
      needsRoom: true,
    });
    expect(res).toEqual({ id: 'arch2', name: 'archived 2', created: false });
  });

  it('creates "<name> 3" when the base and "<name> 2" are both full', async () => {
    const guild = makeGuild();
    addCategory(guild, 'arch', 'Archived', 50);
    addCategory(guild, 'arch2', 'Archived 2', 50);
    const res = await ensureCategory(guild as never, {
      id: 'arch',
      name: 'Archived',
      needsRoom: true,
    });
    expect(res.name).toBe('Archived 3');
    expect(res.created).toBe(true);
  });

  it('ignores a full category when room is not needed', async () => {
    const guild = makeGuild();
    addCategory(guild, 'arch', 'Archived', 50);
    const res = await ensureCategory(guild as never, {
      id: null,
      name: 'archived',
      needsRoom: false,
    });
    expect(res).toEqual({ id: 'arch', name: 'Archived', created: false });
  });

  it('maps 50013 on create to LifecyclePermissionError', async () => {
    const guild = makeGuild();
    guild.channels.create.mockRejectedValueOnce(discordError(50013));
    await expect(
      ensureCategory(guild as never, {
        id: null,
        name: 'Games',
        needsRoom: false,
      }),
    ).rejects.toBeInstanceOf(LifecyclePermissionError);
  });
});
