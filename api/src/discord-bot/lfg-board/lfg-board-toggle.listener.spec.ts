/**
 * ROK-1471 D3/E1/E4 — what flipping the master toggle does to Discord.
 *
 * The listener is the ONLY thing that provisions the board: the toggle
 * endpoint just persists + emits. The invariants under test are (a) the
 * forum + intro post are seeded exactly once no matter how often the operator
 * flips the switch, (b) disabling touches nothing, and (c) no Discord failure
 * ever escapes into the emitter's call stack (the emitter is `PUT
 * /admin/settings/discord-bot/lfg-board`).
 */
import { Logger } from '@nestjs/common';
import type { ForumChannel, Guild } from 'discord.js';
import { SETTING_KEYS } from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { LfgBoardChannelService } from './lfg-board-channel.service';
import {
  LFG_BOARD_INTRO_BODY,
  LFG_BOARD_INTRO_TITLE,
} from './lfg-board.constants';
import { LfgBoardToggleListener } from './lfg-board-toggle.listener';

const GUILD = { id: 'guild-1' } as unknown as Guild;
const INTRO_KEY = SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID;
const BOT_ID = 'bot-user-1';
/** `ChannelFlags.Pinned` — the flag a pinned forum post carries. */
const PINNED = 1 << 1;

interface FakeThread {
  id: string;
  name: string;
  ownerId: string | null;
  flags: { has: (flag: number) => boolean };
  pin: jest.Mock;
}

/**
 * A forum post as the intro rediscovery reads it (D6).
 *
 * @param over.id - Snowflake; the scan prefers the lowest when none is pinned.
 * @param over.name - Thread title; only `LFG_BOARD_INTRO_TITLE` may be adopted.
 * @param over.ownerId - Starter; only the app's own user id may be adopted.
 * @param over.pinned - Whether the post already carries `ChannelFlags.Pinned`.
 */
function fakeThread(over: {
  id: string;
  name?: string;
  ownerId?: string | null;
  pinned?: boolean;
}): FakeThread {
  const flags = over.pinned ? PINNED : 0;
  return {
    id: over.id,
    name: over.name ?? LFG_BOARD_INTRO_TITLE,
    ownerId: over.ownerId === undefined ? BOT_ID : over.ownerId,
    flags: { has: (flag: number): boolean => (flags & flag) === flag },
    pin: jest.fn(() => Promise.resolve(undefined)),
  };
}

interface Harness {
  listener: LfgBoardToggleListener;
  resolveForum: jest.Mock;
  create: jest.Mock;
  fetch: jest.Mock;
  pin: jest.Mock;
  set: jest.Mock;
  settings: Map<string, string>;
  fetchActive: jest.Mock;
}

/** Failure + fixture switches every listener case is built from. */
interface HarnessOpts {
  connected?: boolean;
  guild?: Guild | null;
  forum?: ForumChannel | null;
  forumThrows?: boolean;
  stored?: string;
  fetched?: unknown;
  fetchRejects?: boolean;
  fetchError?: Error;
  createRejects?: boolean;
  pinRejects?: boolean;
  active?: FakeThread[];
  fetchActiveRejects?: boolean;
  botUserId?: string | null;
}

/** A Map-backed `SettingsService`, so persistence is observable. */
function fakeSettings(stored?: string): {
  settings: Map<string, string>;
  set: jest.Mock;
  settingsService: SettingsService;
} {
  const settings = new Map<string, string>();
  if (stored !== undefined) settings.set(INTRO_KEY, stored);
  const set = jest.fn((key: string, value: string) => {
    settings.set(key, value);
    return Promise.resolve();
  });
  const settingsService = {
    get: (key: string) => Promise.resolve(settings.get(key) ?? null),
    set,
  } as unknown as SettingsService;
  return { settings, set, settingsService };
}

/**
 * Wire the listener over fakes.
 *
 * @param opts.connected - Bot gateway state (default connected).
 * @param opts.guild - Guild the client reports (default one guild).
 * @param opts.forum - What `resolveForum` resolves to (default a fake forum).
 * @param opts.stored - Pre-existing intro thread id in settings.
 * @param opts.fetched - What `forum.threads.fetch` resolves to.
 * @param opts.active - Forum posts `forum.threads.fetchActive` reports (D6).
 * @param opts.fetchActiveRejects - Make the rediscovery scan fail (P7).
 * @param opts.botUserId - The app's own user id; `null` = client not ready.
 */
/**
 * The board forum, with the three thread calls the listener can make.
 *
 * @param opts - The same failure switches {@link harness} accepts.
 */
function fakeForum(opts: HarnessOpts): {
  forum: ForumChannel | null;
  create: jest.Mock;
  fetch: jest.Mock;
  fetchActive: jest.Mock;
  pin: jest.Mock;
} {
  const pin = jest.fn(
    opts.pinRejects
      ? () => Promise.reject(new Error('Missing Permissions'))
      : () => Promise.resolve(undefined),
  );
  const create = jest.fn(
    opts.createRejects
      ? () => Promise.reject(new Error('Missing Permissions'))
      : () => Promise.resolve({ id: 'intro-thread', pin }),
  );
  const fetchFailure = opts.fetchError;
  const fetch = jest.fn(
    (fetchFailure ?? opts.fetchRejects)
      ? () => Promise.reject(fetchFailure ?? new Error('Unknown Channel'))
      : () => Promise.resolve(opts.fetched ?? null),
  );
  const fetchActive = jest.fn(
    opts.fetchActiveRejects
      ? () => Promise.reject(new Error('Missing Access'))
      : () =>
          Promise.resolve({
            threads: new Map((opts.active ?? []).map((t) => [t.id, t])),
          }),
  );
  const forum =
    opts.forum === undefined
      ? ({
          id: 'forum-1',
          threads: { create, fetch, fetchActive },
        } as unknown as ForumChannel)
      : opts.forum;
  return { forum, create, fetch, fetchActive, pin };
}

function harness(opts: HarnessOpts = {}): Harness {
  const { forum, create, fetch, fetchActive, pin } = fakeForum(opts);

  const resolveForum = jest.fn(
    opts.forumThrows
      ? () => Promise.reject(new Error('boom'))
      : () => Promise.resolve(forum),
  );

  const { settings, set, settingsService } = fakeSettings(opts.stored);

  const botUserId = opts.botUserId === undefined ? BOT_ID : opts.botUserId;
  const clientService = {
    isConnected: () => opts.connected ?? true,
    getGuild: () => (opts.guild === undefined ? GUILD : opts.guild),
    getBotUser: () =>
      botUserId ? { id: botUserId, username: 'raid-ledger' } : null,
  } as unknown as DiscordBotClientService;

  const listener = new LfgBoardToggleListener(
    clientService,
    { resolveForum } as unknown as LfgBoardChannelService,
    settingsService,
  );
  return {
    listener,
    resolveForum,
    create,
    fetch,
    pin,
    set,
    settings,
    fetchActive,
  };
}

let warn: jest.SpyInstance;
let log: jest.SpyInstance;

beforeEach(() => {
  warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('LfgBoardToggleListener (ROK-1471 A4)', () => {
  it('enabling resolves the forum once and seeds one intro post', async () => {
    const h = harness();

    await h.listener.onToggled({ enabled: true });

    expect(h.resolveForum).toHaveBeenCalledTimes(1);
    expect(h.resolveForum).toHaveBeenCalledWith(GUILD);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
  });

  it('the intro post explains the board, the +1 button and how to withdraw', async () => {
    const h = harness();

    await h.listener.onToggled({ enabled: true });

    const [{ name, message }] = h.create.mock.calls[0] as [
      { name: string; message: { content: string } },
    ];
    expect(name.length).toBeGreaterThan(0);
    const body = message.content;
    expect(body).toContain('+1');
    expect(body).toContain('/lfg');
    expect(body.toLowerCase()).toContain('withdraw');
    expect(body.toLowerCase()).toContain('second');
    expect(body.toLowerCase()).toContain('archive');
  });

  it('pins the intro post, and still persists the id when pinning is denied', async () => {
    const h = harness({ pinRejects: true });

    await expect(
      h.listener.onToggled({ enabled: true }),
    ).resolves.toBeUndefined();

    expect(h.pin).toHaveBeenCalledTimes(1);
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
  });

  it('enabling again does NOT post a second intro when the stored id resolves', async () => {
    const h = harness({
      stored: 'intro-thread',
      fetched: { id: 'intro-thread' },
    });

    await h.listener.onToggled({ enabled: true });

    expect(h.fetch).toHaveBeenCalledWith('intro-thread');
    expect(h.create).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });

  it('recreates the intro exactly once when the stored thread is gone', async () => {
    const h = harness({ stored: 'deleted-thread', fetched: null });

    await h.listener.onToggled({ enabled: true });

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
  });
});

describe('LfgBoardToggleListener — intro-post idempotence (E3)', () => {
  it('re-seeds when the stored thread fetch says Unknown Channel', async () => {
    const h = harness({ stored: 'deleted-thread', fetchRejects: true });

    await expect(
      h.listener.onToggled({ enabled: true }),
    ).resolves.toBeUndefined();

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
  });

  it('re-seeds on a bare Discord error CODE, with no telltale message', async () => {
    // discord.js surfaces the reason as `code`; the message is the human
    // string and can be anything, so the code alone has to be enough.
    const gone = Object.assign(new Error('The request failed'), {
      code: 10003,
    });
    const h = harness({ stored: 'deleted-thread', fetchError: gone });

    await h.listener.onToggled({ enabled: true });

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
  });

  it('does NOT re-seed when the fetch fails for a transient reason', async () => {
    // A 5xx or a rate-limit is not evidence the intro post is gone. Creating
    // one anyway pins a SECOND "How this board works" thread to a public
    // forum and overwrites the stored id, orphaning the first — repeatable
    // every time the operator re-flips the toggle while Discord is unhappy.
    const transient = Object.assign(new Error('Service Unavailable'), {
      code: 500,
    });
    const h = harness({ stored: 'intro-thread', fetchError: transient });

    await expect(
      h.listener.onToggled({ enabled: true }),
    ).resolves.toBeUndefined();

    expect(h.create).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
    expect(warn).toHaveBeenCalled();
  });
});

describe('LfgBoardToggleListener — no-ops and failures (ROK-1471 A4)', () => {
  it('disabling touches Discord not at all and only logs (E4)', async () => {
    const h = harness();

    await h.listener.onToggled({ enabled: false });

    expect(h.resolveForum).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it('does nothing when the bot is not connected', async () => {
    const h = harness({ connected: false });

    await h.listener.onToggled({ enabled: true });

    expect(h.resolveForum).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('does nothing when there is no guild', async () => {
    const h = harness({ guild: null });

    await h.listener.onToggled({ enabled: true });

    expect(h.resolveForum).not.toHaveBeenCalled();
  });

  it('warns instead of throwing when the forum cannot be resolved', async () => {
    const h = harness({ forum: null });

    await expect(
      h.listener.onToggled({ enabled: true }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });

  it('warns instead of throwing when resolveForum itself rejects', async () => {
    const h = harness({ forumThrows: true });

    await expect(
      h.listener.onToggled({ enabled: true }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
  });

  it('warns instead of throwing when the intro post cannot be created', async () => {
    const h = harness({ createRejects: true });

    await expect(
      h.listener.onToggled({ enabled: true }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    expect(h.settings.has(INTRO_KEY)).toBe(false);
  });
});

describe('LfgBoardToggleListener — intro rediscovery (ROK-1492 AC2 / D6)', () => {
  it('adopts the bot\u2019s own intro post instead of seeding a second one', async () => {
    // The restore case: `app_settings` came back without
    // LFG_BOARD_INTRO_THREAD_ID (D7 keeps it out of sanitised backups), but
    // the forum and its pinned intro survived in Discord. Seeding here pins a
    // duplicate "How this board works" to a public forum, forever.
    const existing = fakeThread({ id: 'intro-99', pinned: true });
    const h = harness({ active: [existing] });

    await h.listener.onToggled({ enabled: true });

    expect(h.create).not.toHaveBeenCalled();
    expect(h.settings.get(INTRO_KEY)).toBe('intro-99');
  });

  it('pins an adopted intro post that is no longer pinned', async () => {
    const existing = fakeThread({ id: 'intro-99', pinned: false });
    const h = harness({ active: [existing] });

    await h.listener.onToggled({ enabled: true });

    expect(existing.pin).toHaveBeenCalledTimes(1);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('does not re-pin an intro post that is already pinned', async () => {
    const existing = fakeThread({ id: 'intro-99', pinned: true });
    const h = harness({ active: [existing] });

    await h.listener.onToggled({ enabled: true });

    expect(existing.pin).not.toHaveBeenCalled();
  });

  it('refuses a same-titled post started by someone else', async () => {
    // Pre-1493 guilds have member-authored posts; the title alone is not
    // proof of authorship, so a member could otherwise hand the board an
    // "intro" it then edits and pins.
    const impostor = fakeThread({ id: 'intro-99', ownerId: 'member-7' });
    const h = harness({ active: [impostor] });

    await h.listener.onToggled({ enabled: true });

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
  });

  it('refuses one of the bot\u2019s own posts with a different title', async () => {
    const other = fakeThread({ id: 'group-42', name: 'Deep Rock Galactic' });
    const h = harness({ active: [other] });

    await h.listener.onToggled({ enabled: true });

    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('prefers the pinned candidate over an older unpinned one', async () => {
    const older = fakeThread({ id: 'intro-100' });
    const pinned = fakeThread({ id: 'intro-900', pinned: true });
    const h = harness({ active: [older, pinned] });

    await h.listener.onToggled({ enabled: true });

    expect(h.settings.get(INTRO_KEY)).toBe('intro-900');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('takes the oldest when no candidate is pinned', async () => {
    const h = harness({
      active: [
        fakeThread({ id: 'intro-900' }),
        fakeThread({ id: 'intro-100' }),
      ],
    });

    await h.listener.onToggled({ enabled: true });

    expect(h.settings.get(INTRO_KEY)).toBe('intro-100');
  });

  it('seeds one intro when the scan finds nothing', async () => {
    const h = harness({ active: [] });

    await h.listener.onToggled({ enabled: true });

    expect(h.fetchActive).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
  });

  it('seeds one intro, without throwing, when the scan itself fails (P7)', async () => {
    // No stored id means there is nothing to protect: a duplicate intro is
    // recoverable, a board with no intro is the state the operator just
    // asked to leave.
    const h = harness({ fetchActiveRejects: true });

    await expect(
      h.listener.onToggled({ enabled: true }),
    ).resolves.toBeUndefined();

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
  });

  it('seeds one intro when the client cannot name its own user', async () => {
    // Without the app's own id there is no author guard, and adopting on
    // title alone is exactly the hole the guard exists to close.
    const h = harness({
      botUserId: null,
      active: [fakeThread({ id: 'intro-99', pinned: true })],
    });

    await h.listener.onToggled({ enabled: true });

    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('never scans when a stored id still resolves', async () => {
    const h = harness({
      stored: 'intro-thread',
      fetched: { id: 'intro-thread' },
    });

    await h.listener.onToggled({ enabled: true });

    expect(h.fetchActive).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('never scans, and never seeds, when the stored fetch is unreadable', async () => {
    // The ROK-1471 contract: a 5xx is not evidence the intro is gone.
    // Rediscovery must not become a back door that re-seeds on a transient.
    const transient = Object.assign(new Error('Service Unavailable'), {
      code: 500,
    });
    const h = harness({ stored: 'intro-thread', fetchError: transient });

    await h.listener.onToggled({ enabled: true });

    expect(h.fetchActive).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.settings.get(INTRO_KEY)).toBe('intro-thread');
  });

  it('scans nothing at all when the toggle is turned off', async () => {
    const h = harness({ active: [fakeThread({ id: 'intro-99' })] });

    await h.listener.onToggled({ enabled: false });

    expect(h.fetchActive).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe('LFG_BOARD_INTRO_BODY (ROK-1493 D11 / AC4)', () => {
  it('tells members they cannot post, and where the way in is', () => {
    // The forum is locked from ROK-1493 on, so the first thing a member does
    // — try to start a post — now fails silently. The intro has to say why,
    // and name both entry points, or the board reads as broken.
    expect(LFG_BOARD_INTRO_BODY).toContain(
      '**You cannot post here yourself.** New posts are made by Raid Ledger ' +
        'only — `/lfg` or the site is the way in. Replies inside a post stay ' +
        'open, so a group can talk once it exists.',
    );
  });

  it('keeps every paragraph the board already explained', () => {
    // D11 inserts a paragraph; it edits and deletes nothing.
    expect(LFG_BOARD_INTRO_BODY).toContain('**This is the LFG board.**');
    expect(LFG_BOARD_INTRO_BODY).toContain('**Why a post appears.**');
    expect(LFG_BOARD_INTRO_BODY).toContain('**Changed your mind?**');
    expect(LFG_BOARD_INTRO_BODY).toContain('**How posts end.**');
  });
});
