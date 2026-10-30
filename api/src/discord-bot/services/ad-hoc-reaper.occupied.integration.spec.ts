/**
 * ROK-2052 — prod Quick Play 288 was extended once, missed the next ±5 min
 * auto-extend window while one player was briefly alone, then was reaped as
 * an "orphan" with two players still in it — freeing the binding to spawn a
 * duplicate Quick Play two minutes later.
 *
 * Pinned here against a real DB (both fixes are SQL predicates):
 *  - the reaper spares a LIVE Quick Play with an open participant row, and
 *    still reaps one whose rows are all closed — or whose end is past the
 *    occupied ceiling (a stale open row must not pin it live forever);
 *  - auto-extend picks up a live, occupied Quick Play whose end slipped out
 *    of the window and moves its end past now.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { ActiveEventCacheService } from '../../events/active-event-cache.service';
import { SettingsService } from '../../settings/settings.service';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { AdHocReaperService } from './ad-hoc-reaper.service';
import { EventAutoExtendService } from './event-auto-extend.service';
import {
  AD_HOC_OCCUPIED_REAP_CEILING_MS,
  findOrphanedAdHocEvents,
  forceClaimOrphanedEvent,
} from './ad-hoc-event.helpers';

const e = schema.events;
const SERVER_ID = 9813;
let testApp: TestApp;
let participants: AdHocParticipantService;

/** A server-born Quick Play whose end passed `overdueMs` ago (40 min). */
async function insertOverdueQuickPlay(
  overdueMs = 40 * 60_000,
  adHocStatus: 'live' | 'grace_period' = 'live',
): Promise<number> {
  const end = Date.now() - overdueMs;
  const rows = await testApp.db
    .insert(e)
    .values({
      title: 'Valheim — Quick Play',
      creatorId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      duration: [new Date(end - 60 * 60_000), new Date(end)],
      isAdHoc: true,
      adHocStatus,
    })
    .returning();
  return nonEmpty(rows, 'event')[0].id;
}

/** Put a Steam-only player on the event's game server (open row). */
async function joinServer(eventId: number, steamId: string): Promise<void> {
  await participants.addServerParticipant(eventId, {
    steamId,
    displayName: `Viking-${steamId.slice(-3)}`,
    userId: null,
    pelicanServerId: SERVER_ID,
  });
}

async function eventRow(id: number) {
  const rows = await testApp.db.select().from(e).where(eq(e.id, id));
  return nonEmpty(rows, 'event row')[0];
}

/** Run one auto-extend tick and return the event's `extended_until`. */
async function extendTick(id: number): Promise<Date | null> {
  await testApp.app.get(ActiveEventCacheService).handleRefresh();
  await testApp.app.get(EventAutoExtendService).checkAndExtendEvents();
  return (await eventRow(id)).extendedUntil;
}

async function orphanIds(): Promise<number[]> {
  return (await findOrphanedAdHocEvents(testApp.db)).map((o) => o.id);
}

beforeAll(async () => {
  testApp = await getTestApp();
  participants = new AdHocParticipantService(testApp.db, new EventEmitter2());
  const notes = testApp.app.get(AdHocNotificationService);
  jest.spyOn(notes, 'queueUpdate').mockImplementation(() => undefined);
});

beforeEach(async () => {
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.EVENT_AUTO_EXTEND_ENABLED, 'true');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(() => jest.restoreAllMocks());

describe('reaper vs an occupied live Quick Play (ROK-2052)', () => {
  it('does not reap an overdue live Quick Play with an open participant', async () => {
    const id = await insertOverdueQuickPlay();
    await joinServer(id, '76561198000002051');

    expect(await orphanIds()).not.toContain(id);
    await testApp.app.get(AdHocReaperService).reapOrphanedEvents();

    expect((await eventRow(id)).adHocStatus).toBe('live');
  });

  it('still reaps an overdue live Quick Play whose rows are all closed', async () => {
    const id = await insertOverdueQuickPlay();
    await joinServer(id, '76561198000002052');
    await participants.markServerLeave(id, '76561198000002052', SERVER_ID);

    expect(await orphanIds()).toContain(id);
    await testApp.app.get(AdHocReaperService).reapOrphanedEvents();

    expect((await eventRow(id)).adHocStatus).toBe('ended');
  });

  it('reaps an occupied live Quick Play overdue past the ceiling (stale row)', async () => {
    const id = await insertOverdueQuickPlay(
      AD_HOC_OCCUPIED_REAP_CEILING_MS + 10 * 60_000,
    );
    await joinServer(id, '76561198000002055');

    expect(await orphanIds()).toContain(id);
    await testApp.app.get(AdHocReaperService).reapOrphanedEvents();

    expect((await eventRow(id)).adHocStatus).toBe('ended');
  });

  it('still reaps an overdue grace_period Quick Play with an open participant', async () => {
    const id = await insertOverdueQuickPlay(40 * 60_000, 'grace_period');
    await joinServer(id, '76561198000002056');

    expect(await orphanIds()).toContain(id);
    await testApp.app.get(AdHocReaperService).reapOrphanedEvents();

    expect((await eventRow(id)).adHocStatus).toBe('ended');
  });
});

describe('reaper claim re-checks orphan eligibility (ROK-2052 race)', () => {
  it('does not end an orphan that gained an open participant after selection', async () => {
    const id = await insertOverdueQuickPlay();
    expect(await orphanIds()).toContain(id);
    await joinServer(id, '76561198000002057');

    const claimed = await forceClaimOrphanedEvent(testApp.db, id, new Date());

    expect(claimed).toBeNull();
    expect((await eventRow(id)).adHocStatus).toBe('live');
  });

  it('does not end an orphan whose end was extended after selection', async () => {
    const id = await insertOverdueQuickPlay();
    expect(await orphanIds()).toContain(id);
    await testApp.db
      .update(e)
      .set({ extendedUntil: new Date(Date.now() + 15 * 60_000) })
      .where(eq(e.id, id));

    const claimed = await forceClaimOrphanedEvent(testApp.db, id, new Date());

    expect(claimed).toBeNull();
    expect((await eventRow(id)).adHocStatus).toBe('live');
  });

  it('still ends an orphan that is unchanged since selection', async () => {
    const id = await insertOverdueQuickPlay();
    expect(await orphanIds()).toContain(id);

    const claimed = await forceClaimOrphanedEvent(testApp.db, id, new Date());

    expect(claimed?.adHocStatus).toBe('ended');
  });
});

describe('auto-extend recovers a slipped live Quick Play (ROK-2052)', () => {
  it('extends past now once two players are on its server again', async () => {
    const id = await insertOverdueQuickPlay();
    await joinServer(id, '76561198000002053');
    await joinServer(id, '76561198000002054');
    await testApp.app.get(ActiveEventCacheService).handleRefresh();
    const before = Date.now();

    await testApp.app.get(EventAutoExtendService).checkAndExtendEvents();

    const row = await eventRow(id);
    expect(row.extendedUntil?.getTime() ?? 0).toBeGreaterThan(before);
    expect(row.adHocStatus).toBe('live');
  });

  it('extends a Quick Play 3h overdue that the cache no longer holds', async () => {
    const id = await insertOverdueQuickPlay(3 * 60 * 60_000);
    await joinServer(id, '76561198000002058');
    await joinServer(id, '76561198000002059');
    const cache = testApp.app.get(ActiveEventCacheService);
    await cache.handleRefresh();
    expect(cache.getActiveEvents(new Date())).toHaveLength(0);
    // Not in the cache at all: it only holds events <= 2h past their end.
    const fourHours = 4 * 60 * 60_000;
    expect(cache.getRecentlyEndedEvents(new Date(), fourHours)).toEqual([]);
    const before = Date.now();

    const until = await extendTick(id);

    expect(until?.getTime() ?? 0).toBeGreaterThan(before);
  });

  it('does not extend a slipped Quick Play whose rows are all closed', async () => {
    const id = await insertOverdueQuickPlay();
    for (const steamId of ['76561198000002060', '76561198000002061']) {
      await joinServer(id, steamId);
      await participants.markServerLeave(id, steamId, SERVER_ID);
    }

    expect(await extendTick(id)).toBeNull();
  });

  it('does not extend a slipped Quick Play with only one player on its server', async () => {
    const id = await insertOverdueQuickPlay();
    await joinServer(id, '76561198000002062');

    expect(await extendTick(id)).toBeNull();
  });
});
