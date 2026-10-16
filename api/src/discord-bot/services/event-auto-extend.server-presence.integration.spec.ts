/**
 * ROK-1800 Codex r2 P1 — a server-only Quick Play (nobody in voice) is kept
 * alive by its game-server players: auto-extend counts open on-server rows,
 * so the reaper does not end the session while people are still playing.
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
import { EventAutoExtendService } from './event-auto-extend.service';
import { findOrphanedAdHocEvents } from './ad-hoc-event.helpers';

const e = schema.events;
let testApp: TestApp;
let autoExtend: EventAutoExtendService;
let participants: AdHocParticipantService;

/** A live server-born Quick Play whose window closes in two minutes. */
async function insertEndingEvent(): Promise<{ id: number; end: Date }> {
  const now = Date.now();
  const end = new Date(now + 2 * 60_000);
  const rows = await testApp.db
    .insert(e)
    .values({
      title: 'Valheim — Quick Play',
      creatorId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      duration: [new Date(now - 58 * 60_000), end],
      isAdHoc: true,
      adHocStatus: 'live',
    })
    .returning();
  return { id: nonEmpty(rows, 'event')[0].id, end };
}

beforeAll(async () => {
  testApp = await getTestApp();
  autoExtend = testApp.app.get(EventAutoExtendService);
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

describe('auto-extend counts game-server presence (Codex r2 P1)', () => {
  it('extends a server-only Quick Play with open on-server players', async () => {
    const event = await insertEndingEvent();
    for (const steamId of ['76561198000000401', '76561198000000402'])
      await participants.addServerParticipant(event.id, {
        steamId,
        displayName: `Viking-${steamId.slice(-3)}`,
        userId: null,
        pelicanServerId: 9800,
      });
    await testApp.app.get(ActiveEventCacheService).handleRefresh();

    await autoExtend.checkAndExtendEvents();

    const [row] = nonEmpty(
      await testApp.db.select().from(e).where(eq(e.id, event.id)),
      'event row',
    );
    expect(row.extendedUntil?.getTime() ?? null).toBeGreaterThan(
      event.end.getTime(),
    );
    expect(row.adHocStatus).toBe('live');
    const orphanIds = (await findOrphanedAdHocEvents(testApp.db)).map(
      (o) => o.id,
    );
    expect(orphanIds).not.toContain(event.id);
  });
});
