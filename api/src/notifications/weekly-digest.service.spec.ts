import { SETTING_KEYS } from '../drizzle/schema';
import { WeeklyDigestService } from './weekly-digest.service';
import {
  assembleDigestSections,
  type DigestSections,
} from './weekly-digest-data.helpers';
import {
  DIGEST_DEDUP_TTL_SECONDS,
  DIGEST_JOB_NAME,
} from './weekly-digest-schedule.helpers';

jest.mock('./weekly-digest-data.helpers', () => ({
  ...jest.requireActual('./weekly-digest-data.helpers'),
  buildDigestSources: jest.fn(() => ({})),
  assembleDigestSections: jest.fn(),
}));

const assemble = assembleDigestSections as jest.MockedFunction<
  typeof assembleDigestSections
>;

const MONDAY_0905Z = new Date('2026-09-21T09:05:00Z');
const WEEK_KEY = 'weekly-digest:2026-W39';

function sections(withLfg: boolean): DigestSections {
  const empty = { items: [], total: 0 };
  const lfg = {
    items: [
      {
        gameName: 'Valheim',
        gameSlug: 'valheim',
        activeCount: 3,
        nowCount: 1,
        isViable: false,
        playersNeeded: 1,
      },
    ],
    total: 1,
  };
  return {
    playing: empty,
    recap: null,
    deals: empty,
    lfg: withLfg ? lfg : empty,
  };
}

function setup(settings: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    [SETTING_KEYS.WEEKLY_DIGEST_ENABLED]: 'true',
    [SETTING_KEYS.WEEKLY_DIGEST_DAY]: '1',
    [SETTING_KEYS.WEEKLY_DIGEST_HOUR]: '9',
    [SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID]: 'digest-chan',
    ...settings,
  };
  const settingsService = {
    get: jest.fn((key: string) => Promise.resolve(values[key] ?? null)),
    getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
    getDiscordBotDefaultChannel: jest.fn().mockResolvedValue('default-chan'),
    getTrustedClientUrl: jest.fn().mockResolvedValue('https://raid.example'),
    getBranding: jest.fn().mockResolvedValue({ communityName: 'Guild' }),
  };
  const dedup = {
    checkAndMarkSent: jest.fn().mockResolvedValue(false),
    releaseKey: jest.fn().mockResolvedValue(undefined),
  };
  const client = {
    isConnected: jest.fn().mockReturnValue(true),
    sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
  };
  const cron = {
    executeWithTracking: jest.fn((_n: string, fn: () => Promise<unknown>) =>
      fn(),
    ),
  };
  const service = new WeeklyDigestService(
    {} as never,
    {} as never,
    dedup as never,
    settingsService as never,
    client as never,
    cron as never,
  );
  return { service, settingsService, dedup, client, cron };
}

beforeEach(() => {
  assemble.mockReset();
  assemble.mockResolvedValue(sections(true));
});

describe('WeeklyDigestService — tick gates', () => {
  it('runs under executeWithTracking with the stable job name', async () => {
    const { service, cron } = setup();
    await service.handleCron();
    expect(cron.executeWithTracking).toHaveBeenCalledWith(
      DIGEST_JOB_NAME,
      expect.any(Function),
    );
  });

  it.each([[null], ['false'], ['TRUE']])(
    'is off unless enabled is exactly "true" (%p) — reads nothing else',
    async (enabled) => {
      const { service, client } = setup({
        [SETTING_KEYS.WEEKLY_DIGEST_ENABLED]: enabled,
      });
      expect(await service.runTick(MONDAY_0905Z)).toEqual({
        status: 'disabled',
      });
      expect(assemble).not.toHaveBeenCalled();
      expect(client.sendEmbed).not.toHaveBeenCalled();
    },
  );

  it('skips a tick outside the configured day + hour', async () => {
    const { service, dedup } = setup({
      [SETTING_KEYS.WEEKLY_DIGEST_HOUR]: '10',
    });
    expect(await service.runTick(MONDAY_0905Z)).toEqual({ status: 'off-slot' });
    expect(dedup.checkAndMarkSent).not.toHaveBeenCalled();
  });

  it('reads the slot in the community timezone', async () => {
    const { service, settingsService } = setup();
    settingsService.getDefaultTimezone.mockResolvedValue('America/New_York');
    // 09:05Z = 05:05 EDT — not the 09:00 slot there.
    expect(await service.runTick(MONDAY_0905Z)).toEqual({ status: 'off-slot' });
    const outcome = await service.runTick(new Date('2026-09-21T13:05:00Z'));
    expect(outcome.status).toBe('posted');
  });

  it('posts in the configured slot with no content and no mentions', async () => {
    const { service, client, dedup } = setup();
    const outcome = await service.runTick(MONDAY_0905Z);
    expect(outcome).toEqual({
      status: 'posted',
      channelId: 'digest-chan',
      dedupKey: WEEK_KEY,
      messageId: 'msg-1',
    });
    expect(dedup.checkAndMarkSent).toHaveBeenCalledWith(
      WEEK_KEY,
      DIGEST_DEDUP_TTL_SECONDS,
    );
    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
    expect(client.sendEmbed.mock.calls[0]).toHaveLength(2);
  });
});

describe('WeeklyDigestService — dedup claim and release', () => {
  it('does not claim the key for an all-empty week', async () => {
    assemble.mockResolvedValue(sections(false));
    const { service, dedup, client } = setup();
    expect(await service.postDigest(MONDAY_0905Z)).toEqual({
      status: 'empty',
      channelId: 'digest-chan',
    });
    expect(dedup.checkAndMarkSent).not.toHaveBeenCalled();
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });

  it('does not claim the key while the bot is disconnected', async () => {
    const { service, dedup, client } = setup();
    client.isConnected.mockReturnValue(false);
    expect(await service.postDigest(MONDAY_0905Z)).toEqual({
      status: 'not-connected',
    });
    expect(dedup.checkAndMarkSent).not.toHaveBeenCalled();
  });

  it('sends nothing when this week is already claimed', async () => {
    const { service, dedup, client } = setup();
    dedup.checkAndMarkSent.mockResolvedValue(true);
    const outcome = await service.postDigest(MONDAY_0905Z);
    expect(outcome.status).toBe('duplicate');
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });

  it('releases the claim when the send fails, and rethrows', async () => {
    const { service, dedup, client } = setup();
    client.sendEmbed.mockRejectedValue(new Error('Missing Access'));
    await expect(service.postDigest(MONDAY_0905Z)).rejects.toThrow(
      'Missing Access',
    );
    expect(dedup.checkAndMarkSent).toHaveBeenCalledWith(
      WEEK_KEY,
      DIGEST_DEDUP_TTL_SECONDS,
    );
    expect(dedup.releaseKey).toHaveBeenCalledWith(WEEK_KEY);
  });

  it('keeps the claim after a successful send', async () => {
    const { service, dedup } = setup();
    await service.postDigest(MONDAY_0905Z);
    expect(dedup.releaseKey).not.toHaveBeenCalled();
  });
});

describe('WeeklyDigestService — retry after a skipped slot tick', () => {
  const MONDAY_1005Z = new Date('2026-09-21T10:05:00Z');
  const MONDAY_1105Z = new Date('2026-09-21T11:05:00Z');

  /** A dedup double that holds keys like Redis SET NX would. */
  function holdKeys(dedup: ReturnType<typeof setup>['dedup']) {
    const held = new Set<string>();
    dedup.checkAndMarkSent.mockImplementation((key: string) => {
      const already = held.has(key);
      held.add(key);
      return Promise.resolve(already);
    });
  }

  it('posts at hour+1 when the slot-hour tick was skipped (bot offline)', async () => {
    const { service, client } = setup();
    client.isConnected.mockReturnValueOnce(false);
    expect((await service.runTick(MONDAY_0905Z)).status).toBe('not-connected');
    const retry = await service.runTick(MONDAY_1005Z);
    expect(retry.status).toBe('posted');
    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
  });

  it('does not post the day before the configured day', async () => {
    const { service, client } = setup();
    const sunday = new Date('2026-09-20T23:05:00Z');
    expect(await service.runTick(sunday)).toEqual({ status: 'off-slot' });
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });

  it('posts once per week: later ticks that day find the key held', async () => {
    const { service, client, dedup } = setup();
    holdKeys(dedup);
    expect((await service.runTick(MONDAY_0905Z)).status).toBe('posted');
    expect((await service.runTick(MONDAY_1005Z)).status).toBe('duplicate');
    expect((await service.runTick(MONDAY_1105Z)).status).toBe('duplicate');
    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
  });
});

describe('WeeklyDigestService — channel resolution', () => {
  it('falls back to the bot default channel when no digest channel is set', async () => {
    const { service, client } = setup({
      [SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID]: null,
    });
    const outcome = await service.postDigest(MONDAY_0905Z);
    expect(outcome).toMatchObject({
      status: 'posted',
      channelId: 'default-chan',
    });
    expect(client.sendEmbed).toHaveBeenCalledWith(
      'default-chan',
      expect.anything(),
    );
  });

  it('skips without claiming when neither channel is set', async () => {
    const { service, settingsService, dedup } = setup({
      [SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID]: null,
    });
    settingsService.getDiscordBotDefaultChannel.mockResolvedValue(null);
    expect(await service.postDigest(MONDAY_0905Z)).toEqual({
      status: 'no-channel',
    });
    expect(dedup.checkAndMarkSent).not.toHaveBeenCalled();
  });
});
