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
import { LfgBoardToggleListener } from './lfg-board-toggle.listener';

const GUILD = { id: 'guild-1' } as unknown as Guild;
const INTRO_KEY = SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID;

interface Harness {
  listener: LfgBoardToggleListener;
  resolveForum: jest.Mock;
  create: jest.Mock;
  fetch: jest.Mock;
  pin: jest.Mock;
  set: jest.Mock;
  settings: Map<string, string>;
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
 */
function harness(
  opts: {
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
  } = {},
): Harness {
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
  const forum =
    opts.forum === undefined
      ? ({
          id: 'forum-1',
          threads: { create, fetch },
        } as unknown as ForumChannel)
      : opts.forum;

  const resolveForum = jest.fn(
    opts.forumThrows
      ? () => Promise.reject(new Error('boom'))
      : () => Promise.resolve(forum),
  );

  const { settings, set, settingsService } = fakeSettings(opts.stored);

  const clientService = {
    isConnected: () => opts.connected ?? true,
    getGuild: () => (opts.guild === undefined ? GUILD : opts.guild),
  } as unknown as DiscordBotClientService;

  const listener = new LfgBoardToggleListener(
    clientService,
    { resolveForum } as unknown as LfgBoardChannelService,
    settingsService,
  );
  return { listener, resolveForum, create, fetch, pin, set, settings };
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
