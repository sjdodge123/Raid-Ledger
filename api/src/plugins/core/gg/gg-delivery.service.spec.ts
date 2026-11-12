/**
 * ROK-2187 — GgDeliveryService.runTick pacing/guard rules with mocked
 * collaborators: send-now (`announceOnly`) never runs a DM wave, a failed
 * announce does not recompute every player on the next tick, and two passes
 * never overlap. The real-DB behaviour lives in gg-delivery.integration.spec.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import { SETTING_KEYS } from '../../../drizzle/schema';
import type { SettingsService } from '../../../settings/settings.service';
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import type { NotificationDedupService } from '../../../notifications/notification-dedup.service';
import type { NotificationService } from '../../../notifications/notification.service';
import type { GgComputeService } from './gg-compute.service';
import { GgDeliveryService } from './gg-delivery.service';
import { findGgAnnouncedAt, runGgDmWave } from './gg-dm-wave.helpers';

jest.mock('./gg-dm-wave.helpers', () => ({
  findGgAnnouncedAt: jest.fn(),
  runGgDmWave: jest.fn(),
}));

const findAnnounced = jest.mocked(findGgAnnouncedAt);
const runWave = jest.mocked(runGgDmWave);
const NOW = new Date('2026-12-20T12:00:00Z');
const SETTINGS: Record<string, string> = {
  [SETTING_KEYS.GG_ENABLED]: 'true',
  [SETTING_KEYS.GG_DELIVERY_DATE]: '2026-12-07',
};

function build(): {
  service: GgDeliveryService;
  computeAll: jest.Mock;
  sendEmbed: jest.Mock;
  bot: { connected: boolean };
  create: jest.Mock;
} {
  const marked = new Set<string>();
  const dedup = {
    checkAndMarkSent: jest.fn((key: string) => {
      const had = marked.has(key);
      marked.add(key);
      return Promise.resolve(had);
    }),
    releaseKey: jest.fn((key: string) => {
      marked.delete(key);
      return Promise.resolve();
    }),
  };
  const settings = {
    get: jest.fn((k: string) => Promise.resolve(SETTINGS[k] ?? null)),
    getDiscordBotDefaultChannel: jest.fn().mockResolvedValue('chan'),
    getClientUrl: jest.fn().mockResolvedValue(null),
  };
  const computeAll = jest.fn().mockResolvedValue(undefined);
  const compute = {
    communityTimeZone: jest.fn().mockResolvedValue('UTC'),
    computeAll,
  };
  const sendEmbed = jest.fn().mockResolvedValue(undefined);
  const state = { connected: true };
  const bot = { isConnected: () => state.connected, sendEmbed };
  const create = jest.fn().mockResolvedValue(null);
  const service = new GgDeliveryService(
    {} as PostgresJsDatabase<typeof schema>,
    settings as unknown as SettingsService,
    compute as unknown as GgComputeService,
    dedup as unknown as NotificationDedupService,
    bot as unknown as DiscordBotClientService,
    { create } as unknown as NotificationService,
  );
  return { service, computeAll, sendEmbed, bot: state, create };
}

beforeEach(() => {
  jest.clearAllMocks();
  runWave.mockResolvedValue({ claimed: 1, sent: 1, failed: 0 });
});

it('send-now (announceOnly) after the offset never runs a DM wave', async () => {
  findAnnounced.mockResolvedValue(new Date('2026-12-07T00:00:00Z'));
  const { service } = build();
  const out = await service.runTick(NOW, {
    bypassDate: true,
    announceOnly: true,
  });
  expect(out.status).toBe('announced');
  expect(runWave).not.toHaveBeenCalled();
  expect((await service.runTick(NOW)).status).toBe('dm-wave');
  expect(runWave).toHaveBeenCalledTimes(1);
});

it('a failed announce does not recompute every player on the next tick', async () => {
  findAnnounced.mockResolvedValue(null);
  const { service, computeAll, sendEmbed } = build();
  sendEmbed.mockRejectedValueOnce(new Error('discord down'));
  await expect(service.runTick(NOW)).rejects.toThrow('discord down');
  await service.runTick(NOW);
  expect(sendEmbed).toHaveBeenCalledTimes(2);
  expect(computeAll).toHaveBeenCalledTimes(1);
});

it('a pass still running makes the next one return busy', async () => {
  findAnnounced.mockResolvedValue(null);
  const { service, computeAll } = build();
  let finish: () => void = () => undefined;
  computeAll.mockReturnValueOnce(
    new Promise<void>((resolve) => (finish = resolve)),
  );
  const first = service.runTick(NOW);
  await new Promise((r) => setImmediate(r));
  expect((await service.runTick(NOW)).status).toBe('busy');
  finish();
  await first;
  expect(computeAll).toHaveBeenCalledTimes(1);
});

it('an announced year keeps its DM wave going before the configured date', async () => {
  const early = new Date('2026-12-01T12:00:00Z');
  findAnnounced.mockResolvedValue(null);
  const { service } = build();
  expect((await service.runTick(early)).status).toBe('not-due');
  findAnnounced.mockResolvedValue(new Date('2026-11-30T12:00:00Z'));
  expect((await service.runTick(early)).status).toBe('dm-wave');
  expect(runWave).toHaveBeenCalledTimes(1);
});

it('a disconnected bot claims nothing: no DM wave runs', async () => {
  findAnnounced.mockResolvedValue(new Date('2026-12-07T00:00:00Z'));
  const { service, bot } = build();
  bot.connected = false;
  expect((await service.runTick(NOW)).status).toBe('not-connected');
  expect(runWave).not.toHaveBeenCalled();
});

it('a bot dropping mid-wave fails the send so the claim is released', async () => {
  findAnnounced.mockResolvedValue(new Date('2026-12-07T00:00:00Z'));
  const { service, bot, create } = build();
  runWave.mockImplementation(async (_db, _year, send) => {
    bot.connected = false;
    await expect(send({ id: 1, userId: 7 })).rejects.toThrow(/not connected/);
    return { claimed: 1, sent: 0, failed: 1 };
  });
  await service.runTick(NOW);
  expect(runWave).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled();
});

it('the gg_ready notification carries the GG link for the DM button', async () => {
  findAnnounced.mockResolvedValue(new Date('2026-12-07T00:00:00Z'));
  const { service, create } = build();
  runWave.mockImplementation(async (_db, _year, send) => {
    await send({ id: 1, userId: 7 });
    return { claimed: 1, sent: 1, failed: 0 };
  });
  await service.runTick(NOW);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'gg_ready',
      payload: { year: 2026, url: '/gg/2026' },
    }),
  );
});
