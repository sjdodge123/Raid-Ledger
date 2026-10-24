/**
 * ROK-1936 — "When the Community Plays" heatmap buckets in the community
 * default timezone (real DB, real refresh pipeline).
 *
 * `event_voice_sessions.first_join_at` is a zone-less column holding the UTC
 * wall clock, so a 01:00 UTC Sunday join must bucket as Saturday evening for
 * an `America/New_York` community; an unset or invalid setting buckets in UTC.
 */
import type {
  CommunityTemporalResponseDto,
  TemporalHeatmapCellDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { CommunityInsightsService } from './community-insights.service';

/** Most recent Sunday 01:00 UTC at least two days back (inside the 30-day window). */
function recentSundayOneAmUtc(): Date {
  const d = new Date();
  d.setUTCHours(1, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 2);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Local hour of `d` in `tz` (20 under EST, 21 under EDT for New York). */
function localHour(d: Date, tz: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(d);
  return Number(hour);
}

const nonZero = (cells: TemporalHeatmapCellDto[]): TemporalHeatmapCellDto[] =>
  cells.filter((c) => c.activity > 0);

describe('Community temporal heatmap timezone (ROK-1936)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let adminId: number;
  const joinAt = recentSundayOneAmUtc();

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    const seed = await truncateAllTables(testApp.db);
    adminId = seed.adminUser.id;
    adminToken = await loginAsAdmin(testApp.request, seed);
    await seedVoiceJoin(testApp, adminId, joinAt);
  });

  const refreshAndRead = async (): Promise<CommunityTemporalResponseDto> => {
    await testApp.app.get(CommunityInsightsService).refreshSnapshot();
    const res = await testApp.request
      .get('/insights/community/temporal')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body as CommunityTemporalResponseDto;
  };

  it('buckets a 01:00 UTC Sunday join as Saturday evening for America/New_York', async () => {
    await testApp.app
      .get(SettingsService)
      .set(SETTING_KEYS.DEFAULT_TIMEZONE, 'America/New_York');

    const body = await refreshAndRead();

    const hour = localHour(joinAt, 'America/New_York');
    expect(nonZero(body.heatmap)).toEqual([{ weekday: 6, hour, activity: 1 }]);
    expect(body.peakHours).toEqual([{ weekday: 6, hour, activity: 1 }]);
    expect(body.timezone).toBe('America/New_York');
  });

  it('buckets in UTC when the default timezone is unset', async () => {
    const body = await refreshAndRead();

    expect(nonZero(body.heatmap)).toEqual([
      { weekday: 7, hour: 1, activity: 1 },
    ]);
    expect(body.timezone).toBe('UTC');
  });

  it('falls back to UTC instead of failing when the setting is not a real zone', async () => {
    await testApp.app
      .get(SettingsService)
      .set(SETTING_KEYS.DEFAULT_TIMEZONE, 'Not/AZone');

    const body = await refreshAndRead();

    expect(nonZero(body.heatmap)).toEqual([
      { weekday: 7, hour: 1, activity: 1 },
    ]);
    expect(body.timezone).toBe('UTC');
  });
});

async function seedVoiceJoin(
  t: TestApp,
  userId: number,
  joinAt: Date,
): Promise<void> {
  const leaveAt = new Date(joinAt.getTime() + 60 * 60_000);
  const [event] = nonEmpty(
    await t.db
      .insert(schema.events)
      .values({
        title: 'tz heatmap',
        creatorId: userId,
        duration: [joinAt, leaveAt],
      })
      .returning(),
    'event',
  );
  await t.db.insert(schema.eventVoiceSessions).values({
    eventId: event.id,
    userId,
    discordUserId: `tz-${userId}`,
    discordUsername: `tz-${userId}`,
    firstJoinAt: joinAt,
    lastLeaveAt: leaveAt,
    totalDurationSec: 3600,
    segments: [
      {
        joinAt: joinAt.toISOString(),
        leaveAt: leaveAt.toISOString(),
        durationSec: 3600,
      },
    ],
  });
}
