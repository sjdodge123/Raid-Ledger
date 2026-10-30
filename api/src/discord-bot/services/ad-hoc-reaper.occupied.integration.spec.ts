/**
 * ROK-2052 — prod Quick Play 288 was extended once, missed the next ±5 min
 * auto-extend window while one player was briefly alone, then was reaped as
 * an "orphan" with two players still in it — freeing the binding to spawn a
 * duplicate Quick Play two minutes later.
 *
 * Pinned here against a real DB (both fixes are SQL predicates):
 *  - the reaper spares a LIVE Quick Play with an open participant row, and
 *    still reaps one whose rows are all closed;
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
import { findOrphanedAdHocEvents } from './ad-hoc-event.helpers';

const e = schema.events;
const SERVER_ID = 9813;
let testApp: TestApp;
let participants: AdHocParticipantService;

/** A live server-born Quick Play whose end passed 40 minutes ago. */
async function insertOverdueQuickPlay(): Promise<number> {
  const now = Date.now();
  const rows = await testApp.db
    .insert(e)
    .values({
      title: 'Valheim — Quick Play',
      creatorId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      duration: [new Date(now - 100 * 60_000), new Date(now - 40 * 60_000)],
      isAdHoc: true,
      adHocStatus: 'live',
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
});
