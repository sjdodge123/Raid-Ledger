/**
 * ROK-1471 D2 — which surface an LFM group's post lands on.
 *
 * `resolveLfmChannel` is deliberately NOT mocked here. The whole claim of D2 is
 * "otherwise delegate to 1454's chain, unchanged" — mocking it would assert
 * that a mock was called, not that the fallback still resolves the way 1454's
 * users expect. The real helper runs against fake deps instead, so the text
 * branch is pinned end to end, including the single warning it emits when
 * nothing resolves (E4/E5).
 */
import type { ForumChannel, Guild } from 'discord.js';
import { SETTING_KEYS } from '../../drizzle/schema';
import {
  resolveLfgBoardSurface,
  type LfgBoardSurfaceDeps,
} from './lfg-board-surface.helpers';

const GUILD_ID = 'guild-1';
const GAME_ID = 42;

const forumChannel = { id: 'forum-1' } as unknown as ForumChannel;
const guild = { id: GUILD_ID } as unknown as Guild;

let settingsStore: Map<string, string>;

const logger = { warn: jest.fn() };
const channelBindings = { getChannelForGame: jest.fn() };
const channelService = { resolveForum: jest.fn() };
const clientService = { getGuildId: jest.fn(() => GUILD_ID as string | null) };
const settings = {
  get: jest.fn((key: string) => Promise.resolve(settingsStore.get(key) ?? '')),
  set: jest.fn(() => Promise.resolve()),
  getDiscordBotDefaultChannel: jest.fn(),
};

/** Deps with the board toggle ON or OFF; everything else defaults to "nothing". */
function deps(opts: {
  enabled: boolean;
  guild?: Guild | null;
}): LfgBoardSurfaceDeps {
  settingsStore.set(
    SETTING_KEYS.LFG_BOARD_ENABLED,
    opts.enabled ? 'true' : 'false',
  );
  return {
    clientService,
    channelBindings,
    settingsService:
      settings as unknown as LfgBoardSurfaceDeps['settingsService'],
    logger,
    channelService,
    guild: opts.guild === undefined ? guild : opts.guild,
  };
}

describe('resolveLfgBoardSurface', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsStore = new Map<string, string>();
    clientService.getGuildId.mockReturnValue(GUILD_ID);
    channelBindings.getChannelForGame.mockResolvedValue(null);
    settings.getDiscordBotDefaultChannel.mockResolvedValue(null);
    channelService.resolveForum.mockResolvedValue(null);
  });

  // E5 — the toggle is off by default; 1454's board must be untouched.
  it('delegates to the 1454 chain and returns text when the toggle is OFF', async () => {
    channelBindings.getChannelForGame.mockResolvedValue('chan-bound');

    await expect(
      resolveLfgBoardSurface(deps({ enabled: false }), GAME_ID),
    ).resolves.toEqual({
      kind: 'text',
      guildId: GUILD_ID,
      channelId: 'chan-bound',
    });
    expect(channelService.resolveForum).not.toHaveBeenCalled();
  });

  it('returns the forum when the toggle is ON and one resolves', async () => {
    channelService.resolveForum.mockResolvedValue(forumChannel);
    channelBindings.getChannelForGame.mockResolvedValue('chan-bound');

    await expect(
      resolveLfgBoardSurface(deps({ enabled: true }), GAME_ID),
    ).resolves.toEqual({
      kind: 'forum',
      guildId: GUILD_ID,
      channelId: 'forum-1',
    });
    // The text chain is not consulted when the forum wins.
    expect(channelBindings.getChannelForGame).not.toHaveBeenCalled();
  });

  // E1 — no Manage Channels: the forum resolver returns null, not a throw.
  it('falls back to text when the toggle is ON but no forum resolves', async () => {
    settings.getDiscordBotDefaultChannel.mockResolvedValue('chan-default');

    await expect(
      resolveLfgBoardSurface(deps({ enabled: true }), GAME_ID),
    ).resolves.toEqual({
      kind: 'text',
      guildId: GUILD_ID,
      channelId: 'chan-default',
    });
  });

  it('returns null with exactly one warning when neither surface resolves', async () => {
    await expect(
      resolveLfgBoardSurface(deps({ enabled: true }), GAME_ID),
    ).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(String(GAME_ID)),
    );
  });

  it('falls back to text rather than throwing when the forum resolver blows up', async () => {
    channelService.resolveForum.mockRejectedValue(new Error('db is down'));
    channelBindings.getChannelForGame.mockResolvedValue('chan-bound');

    await expect(
      resolveLfgBoardSurface(deps({ enabled: true }), GAME_ID),
    ).resolves.toEqual({
      kind: 'text',
      guildId: GUILD_ID,
      channelId: 'chan-bound',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('db is down'),
    );
  });

  it('never throws when the text chain itself blows up', async () => {
    channelBindings.getChannelForGame.mockRejectedValue(
      new Error('db is down'),
    );

    await expect(
      resolveLfgBoardSurface(deps({ enabled: false }), GAME_ID),
    ).resolves.toBeNull();
  });

  it('skips the forum branch entirely when the bot has no guild', async () => {
    channelService.resolveForum.mockResolvedValue(forumChannel);
    clientService.getGuildId.mockReturnValue(null);

    await expect(
      resolveLfgBoardSurface(deps({ enabled: true, guild: null }), GAME_ID),
    ).resolves.toBeNull();
    expect(channelService.resolveForum).not.toHaveBeenCalled();
  });
});
