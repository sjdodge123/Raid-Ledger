/**
 * ROK-2187 lane 6b — GG <year> delivery against a real database: the kill
 * switch stops every send (AC11), the announcement posts exactly once across
 * repeat ticks/send-now and a failed send releases the key (AC2), DMs wait out
 * the offset and go ≤25 per tick, each user once (AC3), skips (AC4) and the
 * no-Discord in-app path (AC14), plus recompute refused after announce.
 */
import { ConflictException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SETTING_KEYS } from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { GgComputeService } from './gg-compute.service';
import { GgDeliveryService } from './gg-delivery.service';
import { GgAdminController } from './gg-admin.controller';
import { ggAnnounceKey } from './gg-delivery.schedule';
import { resetGgDmState } from './gg-dm-wave.helpers';
import { GG_DELIVERY_JOB_NAME } from './gg-delivery.cron';
import { NotificationService } from '../../../notifications/notification.service';
import { DiscordNotificationService } from '../../../notifications/discord-notification.service';

const YEAR = new Date().getUTCFullYear();
const LATER = (): Date => new Date(Date.now() + 16 * 60_000);
let testApp: TestApp;
let service: GgDeliveryService;
let sendEmbed: jest.SpyInstance;
let seq = 0;

async function insertUser(
  opts: { deactivated?: boolean; discord?: boolean } = {},
): Promise<number> {
  seq += 1;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: opts.discord === false ? null : `81000${seq}`,
        username: `gg-dm-${seq}`,
        role: 'member',
        deactivatedAt: opts.deactivated ? new Date() : null,
      })
      .returning({ id: schema.users.id }),
    'gg delivery user',
  );
  return u.id;
}

async function insertSnapshot(userId: number): Promise<void> {
  await testApp.db.execute(sql`
    INSERT INTO gg_snapshots (user_id, year, schema_version, payload, activity_tier)
    VALUES (${userId}, ${YEAR}, 1, '{}'::jsonb, 'full')`);
}

async function ggNotifications(userId?: number): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      userId === undefined
        ? eq(schema.notifications.type, 'gg_ready')
        : and(
            eq(schema.notifications.type, 'gg_ready'),
            eq(schema.notifications.userId, userId),
          ),
    );
  return rows.length;
}

async function dedupRows(): Promise<number> {
  const rows = await testApp.db.execute(
    sql`SELECT 1 FROM notification_dedup WHERE dedup_key = ${ggAnnounceKey(YEAR)}`,
  );
  return Array.from(rows).length;
}

async function enable(on = true): Promise<void> {
  const settings = testApp.app.get(SettingsService);
  await settings.set(SETTING_KEYS.GG_ENABLED, String(on));
  await settings.set(SETTING_KEYS.GG_DELIVERY_DATE, `${YEAR}-01-01`);
  await settings.set(SETTING_KEYS.GG_DELIVERY_HOUR, '0');
  await settings.set(SETTING_KEYS.GG_DM_OFFSET_MINUTES, '15');
  await settings.set(SETTING_KEYS.DISCORD_BOT_DEFAULT_CHANNEL, 'gg-chan');
  // YEAR is UTC; pin the community tz so New Year never splits the two.
  await settings.set(SETTING_KEYS.DEFAULT_TIMEZONE, 'UTC');
}

async function snapshotRow(
  userId: number,
): Promise<{ claimed: boolean; sent: boolean }> {
  const [row] = Array.from(
    await testApp.db.execute<{ claimed: boolean; sent: boolean }>(sql`
      SELECT dm_claimed_at IS NOT NULL AS claimed, dm_sent_at IS NOT NULL AS sent
      FROM gg_snapshots WHERE user_id = ${userId} AND year = ${YEAR}`),
  );
  return { claimed: row?.claimed === true, sent: row?.sent === true };
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(GgDeliveryService);
});

beforeEach(() => {
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  sendEmbed = jest
    .spyOn(client, 'sendEmbed')
    .mockResolvedValue({ id: 'gg-msg' } as never);
  // Snapshots are seeded by hand; the compute itself is lane 6a's spec.
  jest
    .spyOn(testApp.app.get(GgComputeService), 'computeAll')
    .mockResolvedValue({
      year: YEAR,
      computed: 0,
      short: 0,
      full: 0,
      noActivity: 0,
      deactivated: 0,
    });
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('GG delivery — kill switch (AC11)', () => {
  it('GG_ENABLED=false stops the announce and every DM, even on send-now', async () => {
    await enable(false);
    await insertSnapshot(await insertUser());
    const outcome = await service.runTick(LATER(), { bypassDate: true });
    expect(outcome.status).toBe('disabled');
    expect(sendEmbed).not.toHaveBeenCalled();
    expect(await ggNotifications()).toBe(0);
  });
});

describe('GG delivery — announce exactly once (AC2)', () => {
  it('posts once across repeat ticks and send-now', async () => {
    await enable();
    await service.runTick(new Date());
    await service.runTick(new Date());
    await service.runTick(new Date(), { bypassDate: true });
    expect(sendEmbed).toHaveBeenCalledTimes(1);
    expect(sendEmbed.mock.calls[0]?.[0]).toBe('gg-chan');
    expect(await dedupRows()).toBe(1);
  });

  it('a failed send releases the key so the next tick retries', async () => {
    await enable();
    sendEmbed.mockRejectedValueOnce(new Error('discord down'));
    await expect(service.runTick(new Date())).rejects.toThrow('discord down');
    expect(await dedupRows()).toBe(0);
    await service.runTick(new Date());
    expect(sendEmbed).toHaveBeenCalledTimes(2);
    expect(await dedupRows()).toBe(1);
  });
});

describe('GG delivery — DM wave (AC3, AC4, AC14)', () => {
  it('waits out the offset after the announcement', async () => {
    await enable();
    await insertSnapshot(await insertUser());
    const first = await service.runTick(new Date());
    expect(first.status).toBe('waiting-offset');
    expect(await ggNotifications()).toBe(0);
    const later = await service.runTick(LATER());
    expect(later.status).toBe('dm-wave');
    expect(await ggNotifications()).toBe(1);
  });

  it('sends ≤25 per tick and each user at most once', async () => {
    await enable();
    const ids: number[] = [];
    for (let i = 0; i < 30; i += 1) ids.push(await insertUser());
    for (const id of ids) await insertSnapshot(id);
    await service.runTick(new Date());
    const waves = [];
    for (let i = 0; i < 3; i += 1) waves.push(await service.runTick(LATER()));
    expect(waves.map((w) => ('dm' in w ? w.dm.sent : -1))).toEqual([25, 5, 0]);
    expect(await ggNotifications()).toBe(30);
    for (const id of ids) expect(await ggNotifications(id)).toBe(1);
  });

  it('skips deactivated + opted-out users; no-Discord gets in-app only', async () => {
    await enable();
    const gone = await insertUser({ deactivated: true });
    const optedOut = await insertUser();
    const noDiscord = await insertUser({ discord: false });
    for (const id of [gone, optedOut, noDiscord]) await insertSnapshot(id);
    await testApp.db.execute(sql`
      INSERT INTO ${schema.userNotificationPreferences} (user_id, channel_prefs)
      VALUES (${optedOut}, '{"gg_ready":{"inApp":false,"push":false,"discord":false}}'::jsonb)`);
    await service.runTick(new Date());
    await service.runTick(LATER());
    expect(await ggNotifications(gone)).toBe(0);
    expect(await ggNotifications(optedOut)).toBe(0);
    expect(await ggNotifications(noDiscord)).toBe(1);
  });
});

describe('GG delivery — bot disconnected after the announcement', () => {
  it('claims nothing and stamps nothing until the bot is back', async () => {
    await enable();
    const id = await insertUser();
    await insertSnapshot(id);
    await service.runTick(new Date());
    const client = testApp.app.get(DiscordBotClientService);
    jest.spyOn(client, 'isConnected').mockReturnValue(false);
    expect((await service.runTick(LATER())).status).toBe('not-connected');
    expect(await snapshotRow(id)).toEqual({ claimed: false, sent: false });
    expect(await ggNotifications(id)).toBe(0);
    jest.spyOn(client, 'isConnected').mockReturnValue(true);
    expect((await service.runTick(LATER())).status).toBe('dm-wave');
    expect(await snapshotRow(id)).toEqual({ claimed: true, sent: true });
  });
});

describe('GG delivery — early send-now keeps the wave going', () => {
  it('DMs go out after the offset even before the configured date', async () => {
    await enable();
    await testApp.app
      .get(SettingsService)
      .set(SETTING_KEYS.GG_DELIVERY_DATE, `${YEAR}-12-31`);
    const id = await insertUser();
    await insertSnapshot(id);
    const early = new Date(Date.UTC(YEAR, 0, 2));
    expect((await service.runTick(early)).status).toBe('not-due');
    await testApp.app.get(GgAdminController).sendNow();
    const wave = await service.runTick(LATER());
    expect(wave.status).toBe('dm-wave');
    expect(await ggNotifications(id)).toBe(1);
  });
});

describe('GG delivery — claim release + stale reclaim', () => {
  it('a throwing send releases the claim; the next tick sends exactly once', async () => {
    await enable();
    const id = await insertUser();
    await insertSnapshot(id);
    await service.runTick(new Date());
    const create = jest
      .spyOn(testApp.app.get(NotificationService), 'create')
      .mockRejectedValueOnce(new Error('dm down'));
    const failed = await service.runTick(LATER());
    expect('dm' in failed ? failed.dm : null).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
    });
    expect(await snapshotRow(id)).toEqual({ claimed: false, sent: false });
    create.mockRestore();
    await service.runTick(LATER());
    expect(await snapshotRow(id)).toEqual({ claimed: true, sent: true });
    expect(await ggNotifications(id)).toBe(1);
  });

  it('a failed DM enqueue then a retry leaves exactly one gg_ready row', async () => {
    await enable();
    const id = await insertUser();
    await insertSnapshot(id);
    await service.runTick(new Date());
    const dispatch = jest
      .spyOn(testApp.app.get(DiscordNotificationService), 'dispatch')
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValue(true);
    await service.runTick(LATER());
    expect(await snapshotRow(id)).toEqual({ claimed: false, sent: false });
    expect(await ggNotifications(id)).toBe(1);
    await service.runTick(LATER());
    expect(await snapshotRow(id)).toEqual({ claimed: true, sent: true });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1]?.[0].notificationId).toBe(
      dispatch.mock.calls[0]?.[0].notificationId,
    );
    expect(await ggNotifications(id)).toBe(1);
  });

  it("the DEMO reset also drops the year's gg_ready rows so a resend makes a new one", async () => {
    await enable();
    const id = await insertUser();
    await insertSnapshot(id);
    await service.runTick(new Date());
    await service.runTick(LATER());
    expect(await ggNotifications(id)).toBe(1);
    await resetGgDmState(testApp.db, YEAR);
    expect(await ggNotifications(id)).toBe(0);
    expect(await snapshotRow(id)).toEqual({ claimed: false, sent: false });
  });

  it('reclaims a claim older than 30 min, never a fresh one', async () => {
    await enable();
    const stale = await insertUser();
    const fresh = await insertUser();
    for (const id of [stale, fresh]) await insertSnapshot(id);
    await testApp.db.execute(sql`
      UPDATE gg_snapshots SET dm_claimed_at = CASE user_id
        WHEN ${stale} THEN now() - interval '31 minutes'
        ELSE now() - interval '5 minutes' END
      WHERE year = ${YEAR}`);
    await service.runTick(new Date());
    const wave = await service.runTick(LATER());
    expect('dm' in wave ? wave.dm.claimed : -1).toBe(1);
    expect(await ggNotifications(stale)).toBe(1);
    expect(await ggNotifications(fresh)).toBe(0);
  });
});

describe('GG admin — send-now (AC11, pacing)', () => {
  it('is refused while the job is paused on the Jobs page', async () => {
    await enable();
    await testApp.db.execute(sql`
      INSERT INTO cron_jobs (name, source, cron_expression, paused)
      VALUES (${GG_DELIVERY_JOB_NAME}, 'core', '0 */5 * * * *', true)
      ON CONFLICT (name) DO UPDATE SET paused = true`);
    const admin = testApp.app.get(GgAdminController);
    await expect(admin.sendNow()).rejects.toBeInstanceOf(ConflictException);
    expect(sendEmbed).not.toHaveBeenCalled();
    await testApp.db.execute(
      sql`UPDATE cron_jobs SET paused = false WHERE name = ${GG_DELIVERY_JOB_NAME}`,
    );
  });

  it('announces but never runs the DM wave, even past the offset', async () => {
    await enable();
    const id = await insertUser();
    await insertSnapshot(id);
    const admin = testApp.app.get(GgAdminController);
    await admin.sendNow();
    await testApp.db.execute(sql`
      UPDATE notification_dedup SET created_at = created_at - interval '20 minutes'
      WHERE dedup_key = ${ggAnnounceKey(YEAR)}`);
    expect((await admin.sendNow()).status).toBe('announced');
    expect(await ggNotifications(id)).toBe(0);
  });
});

describe('GG admin — recompute after announce', () => {
  it('is refused without force and allowed with it', async () => {
    await enable();
    await service.runTick(new Date());
    const admin = testApp.app.get(GgAdminController);
    await expect(admin.recompute({ year: YEAR })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(admin.recompute({ year: YEAR, force: true })).resolves.toEqual(
      expect.objectContaining({ year: YEAR }),
    );
  });
});
