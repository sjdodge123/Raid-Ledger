/**
 * ROK-1471 D3 / AC2 — resolving (and creating) the LFG forum channel.
 *
 * The claims worth pinning, and why each needs its own assertion:
 *
 *  - **creation happens exactly once under a burst** (AC2 i / E6). Two games
 *    reaching LFM in the same tick must not leave the guild with two `lfg`
 *    forums. Both the in-memory single flight AND the setting re-read inside
 *    it are exercised: the fake settings store is real, so a second flight
 *    would see the persisted id.
 *  - **a stored id is not trusted** (AC2 ii / E3). The channel behind it can
 *    be deleted or replaced by a text channel of the same name; either way the
 *    resolver must discard it rather than hand a non-forum to the poster.
 *  - **creation NEVER throws** (AC2 iii / E1). This runs under `LFM_REACHED`,
 *    whose emitter is `POST /lfg` — a throw is a 500 on a successful signup.
 *  - **a bound forum with no tag room still resolves** (E16). A post without a
 *    tag is fine; a group without a post is not.
 */
import { ChannelType } from 'discord.js';
import type { ForumChannel, Guild } from 'discord.js';
import { Logger as NestLogger } from '@nestjs/common';
import type { SettingsService } from '../../settings/settings.service';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import { SETTING_KEYS } from '../../drizzle/schema';
import { LfgBoardChannelService } from './lfg-board-channel.service';
import * as bindings from './lfg-board-channel.db-helpers';
import {
  DISCORD_FORUM_TAG_CAP,
  LFG_BOARD_CHANNEL_NAME,
  LFG_BOARD_TAGS,
} from './lfg-board.constants';

jest.mock('./lfg-board-channel.db-helpers');

const GUILD_ID = 'guild-1';
const CREATED_ID = 'forum-created';

/** A tag list of `n` unrelated tags — used to fill the forum to Discord's cap. */
function fillerTags(n: number): { id: string; name: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t-${String(i)}`,
    name: `filler-${String(i)}`,
  }));
}

interface FakeForum {
  id: string;
  type: ChannelType.GuildForum;
  availableTags: { id: string; name: string }[];
  setAvailableTags: jest.Mock;
}

/** A forum channel whose available tags start as `tags`. */
function fakeForum(id: string, tags = fillerTags(0)): FakeForum {
  const forum: FakeForum = {
    id,
    type: ChannelType.GuildForum,
    availableTags: tags,
    setAvailableTags: jest.fn(),
  };
  forum.setAvailableTags.mockImplementation(
    (next: { id?: string; name: string }[]) => {
      forum.availableTags = next.map((t, i) => ({
        id: t.id ?? `new-${String(i)}`,
        name: t.name,
      }));
      return Promise.resolve(forum);
    },
  );
  return forum;
}

/** A text channel — the thing a stale stored id most often points at. */
function fakeTextChannel(id: string): { id: string; type: ChannelType } {
  return { id, type: ChannelType.GuildText };
}

let settingsStore: Map<string, string>;
let warn: jest.SpyInstance;

const settings = {
  get: jest.fn((key: string) => Promise.resolve(settingsStore.get(key) ?? '')),
  set: jest.fn((key: string, value: string) => {
    settingsStore.set(key, value);
    return Promise.resolve();
  }),
};

/** Build a guild whose cache/fetch knows `channels`, and record create calls. */
function makeGuild(
  channels: Record<string, unknown>,
  createImpl?: () => Promise<unknown>,
): { guild: Guild; create: jest.Mock; fetch: jest.Mock } {
  const fetch = jest.fn((id: string) => Promise.resolve(channels[id] ?? null));
  const create = jest.fn(
    createImpl ?? (() => Promise.resolve(fakeForum(CREATED_ID))),
  );
  const guild = {
    id: GUILD_ID,
    channels: { fetch, create },
  } as unknown as Guild;
  return { guild, create, fetch };
}

function makeService(): LfgBoardChannelService {
  return new LfgBoardChannelService(
    {} as unknown as LfgDb,
    settings as unknown as SettingsService,
  );
}

describe('LfgBoardChannelService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsStore = new Map<string, string>();
    warn = jest.spyOn(NestLogger.prototype, 'warn').mockImplementation();
    jest.mocked(bindings.findLfgBoardBindingChannelId).mockResolvedValue(null);
  });

  afterEach(() => warn.mockRestore());

  describe('creation', () => {
    it('creates one forum with the five board tags and persists its id', async () => {
      const { guild, create } = makeGuild({});

      const forum = await makeService().resolveForum(guild);

      expect(forum?.id).toBe(CREATED_ID);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: LFG_BOARD_CHANNEL_NAME,
          type: ChannelType.GuildForum,
          availableTags: LFG_BOARD_TAGS.map((name) => ({ name })),
        }),
      );
      expect(settingsStore.get(SETTING_KEYS.LFG_BOARD_CHANNEL_ID)).toBe(
        CREATED_ID,
      );
    });

    // AC2(i) / E6 — the regression the single flight exists for.
    it('creates exactly ONE forum for two concurrent resolves', async () => {
      let release!: (value: FakeForum) => void;
      const pending = new Promise<FakeForum>((resolve) => {
        release = resolve;
      });
      const { guild, create } = makeGuild({}, () => pending);
      const service = makeService();

      const both = Promise.all([
        service.resolveForum(guild),
        service.resolveForum(guild),
      ]);
      release(fakeForum(CREATED_ID));
      const [a, b] = await both;

      expect(create).toHaveBeenCalledTimes(1);
      expect(a?.id).toBe(CREATED_ID);
      expect(b?.id).toBe(CREATED_ID);
    });

    it('re-reads the persisted id inside the flight instead of creating twice', async () => {
      const existing = fakeForum(
        'forum-persisted',
        LFG_BOARD_TAGS.map((name, i) => ({ id: `t${String(i)}`, name })),
      );
      const { guild, create } = makeGuild({ 'forum-persisted': existing });
      const service = makeService();

      // Another process won the race and wrote the setting before this flight.
      settingsStore.set(SETTING_KEYS.LFG_BOARD_CHANNEL_ID, 'forum-persisted');

      expect((await service.resolveForum(guild))?.id).toBe('forum-persisted');
      expect(create).not.toHaveBeenCalled();
    });

    // AC2(iii) / E1 — a throw here is a 500 on POST /lfg.
    it('returns null and warns when creation is denied, never throwing', async () => {
      const { guild } = makeGuild({}, () =>
        Promise.reject(new Error('Missing Permissions')),
      );

      await expect(makeService().resolveForum(guild)).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Missing Permissions'),
      );
    });
  });

  describe('the stored id', () => {
    it('is discarded and replaced when it now points at a text channel', async () => {
      settingsStore.set(SETTING_KEYS.LFG_BOARD_CHANNEL_ID, 'stale');
      const { guild, create } = makeGuild({ stale: fakeTextChannel('stale') });

      const forum = await makeService().resolveForum(guild);

      expect(forum?.id).toBe(CREATED_ID);
      expect(create).toHaveBeenCalledTimes(1);
    });

    // E3 — the operator deleted the channel by hand.
    it('is discarded and replaced when the channel is gone', async () => {
      settingsStore.set(SETTING_KEYS.LFG_BOARD_CHANNEL_ID, 'deleted');
      const { guild, create } = makeGuild({});

      expect((await makeService().resolveForum(guild))?.id).toBe(CREATED_ID);
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe('the lfg-board binding override (D3a)', () => {
    it('wins over both the stored id and creation', async () => {
      settingsStore.set(SETTING_KEYS.LFG_BOARD_CHANNEL_ID, 'forum-stored');
      const bound = fakeForum(
        'forum-bound',
        LFG_BOARD_TAGS.map((name, i) => ({ id: `t${String(i)}`, name })),
      );
      const { guild, create, fetch } = makeGuild({
        'forum-bound': bound,
        'forum-stored': fakeForum('forum-stored'),
      });
      jest
        .mocked(bindings.findLfgBoardBindingChannelId)
        .mockResolvedValue('forum-bound');

      expect((await makeService().resolveForum(guild))?.id).toBe('forum-bound');
      expect(create).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalledWith('forum-stored');
    });

    it('falls through to the stored id when the bound channel is not a forum', async () => {
      settingsStore.set(SETTING_KEYS.LFG_BOARD_CHANNEL_ID, 'forum-stored');
      const stored = fakeForum(
        'forum-stored',
        LFG_BOARD_TAGS.map((name, i) => ({ id: `t${String(i)}`, name })),
      );
      const { guild, create } = makeGuild({
        'not-a-forum': fakeTextChannel('not-a-forum'),
        'forum-stored': stored,
      });
      jest
        .mocked(bindings.findLfgBoardBindingChannelId)
        .mockResolvedValue('not-a-forum');

      expect((await makeService().resolveForum(guild))?.id).toBe(
        'forum-stored',
      );
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('ensureTags (E16)', () => {
    it('tops up a bound forum that is missing board tags', async () => {
      const bound = fakeForum('forum-bound', [
        { id: 't-keep', name: 'keep-me' },
        { id: 't-needs', name: LFG_BOARD_TAGS[0] },
      ]);
      const { guild } = makeGuild({ 'forum-bound': bound });
      jest
        .mocked(bindings.findLfgBoardBindingChannelId)
        .mockResolvedValue('forum-bound');

      await makeService().resolveForum(guild);

      expect(bound.setAvailableTags).toHaveBeenCalledTimes(1);
      expect(bound.availableTags.map((t) => t.name)).toEqual([
        'keep-me',
        ...LFG_BOARD_TAGS,
      ]);
    });

    it('skips the top-up, logs, and still returns the forum when the cap is full', async () => {
      const bound = fakeForum('forum-bound', fillerTags(DISCORD_FORUM_TAG_CAP));
      const { guild } = makeGuild({ 'forum-bound': bound });
      jest
        .mocked(bindings.findLfgBoardBindingChannelId)
        .mockResolvedValue('forum-bound');

      const forum = await makeService().resolveForum(guild);

      expect(forum?.id).toBe('forum-bound');
      expect(bound.setAvailableTags).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('tag'));
    });

    it('does not call Discord when every board tag is already present', async () => {
      const bound = fakeForum(
        'forum-bound',
        LFG_BOARD_TAGS.map((name, i) => ({ id: `t${String(i)}`, name })),
      );
      const { guild } = makeGuild({ 'forum-bound': bound });
      jest
        .mocked(bindings.findLfgBoardBindingChannelId)
        .mockResolvedValue('forum-bound');

      await makeService().resolveForum(guild);

      expect(bound.setAvailableTags).not.toHaveBeenCalled();
    });

    it('returns the forum when the top-up call itself fails', async () => {
      const bound = fakeForum('forum-bound', []);
      bound.setAvailableTags.mockRejectedValue(new Error('Missing Access'));
      const { guild } = makeGuild({ 'forum-bound': bound });
      jest
        .mocked(bindings.findLfgBoardBindingChannelId)
        .mockResolvedValue('forum-bound');

      await expect(makeService().resolveForum(guild)).resolves.toMatchObject({
        id: 'forum-bound',
      });
    });
  });

  describe('tagIdFor', () => {
    it('maps a board tag name to the forum tag id the poster applies', () => {
      const forum = fakeForum('f', [
        { id: 'tag-abc', name: LFG_BOARD_TAGS[2] },
      ]) as unknown as ForumChannel;

      expect(makeService().tagIdFor(forum, LFG_BOARD_TAGS[2])).toBe('tag-abc');
      expect(makeService().tagIdFor(forum, LFG_BOARD_TAGS[0])).toBeUndefined();
    });
  });
});
