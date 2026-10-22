/**
 * ROK-1888 (ruling 3) — one live Quick Play per game across ALL voice
 * channels, against a real database: a second channel joins the live event
 * (AC1), two channels spawning at once make one row (AC2), and a leave on one
 * channel never starts grace while another channel still has an open voice
 * row (AC3, the DB backstop).
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import { AdHocEventService } from './ad-hoc-event.service';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { createVoiceQuickPlay } from './ad-hoc-game-spawn-lock';

const e = schema.events;
const GUILD = 'guild-1888';

let testApp: TestApp;
let adHoc: AdHocEventService;
let enqueue: jest.SpyInstance;
let channelSeq = 0;

const gameId = () => testApp.seed.game.id;
const adHocEventsOfGame = () =>
  testApp.db
    .select({ id: e.id, status: e.adHocStatus })
    .from(e)
    .where(and(eq(e.isAdHoc, true), eq(e.gameId, gameId())));

/** A game-voice-monitor binding on its own Discord channel. */
async function bindChannel(): Promise<string> {
  const rows = await testApp.db
    .insert(schema.channelBindings)
    .values({
      guildId: GUILD,
      channelId: `1888-voice-${++channelSeq}`,
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: gameId(),
    })
    .returning();
  return nonEmpty(rows, 'binding')[0].id;
}

const spawnOn = (bindingId: string) =>
  createVoiceQuickPlay(
    testApp.db,
    bindingId,
    { gameId: gameId() },
    { userId: null },
  );

const voiceMember = (id: string) => ({
  discordUserId: id,
  discordUsername: id,
  discordAvatarHash: null,
  userId: null,
});

beforeAll(async () => {
  testApp = await getTestApp();
  adHoc = testApp.app.get(AdHocEventService);
  const queue = testApp.app.get(AdHocGracePeriodQueueService);
  enqueue = jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);
  jest.spyOn(queue, 'cancel').mockResolvedValue(undefined);
  const notes = testApp.app.get(AdHocNotificationService);
  jest.spyOn(notes, 'notifySpawn').mockResolvedValue(undefined);
  jest.spyOn(notes, 'queueUpdate').mockImplementation(() => undefined);
});

beforeEach(async () => {
  enqueue.mockClear();
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.AD_HOC_EVENTS_ENABLED, 'true');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(() => jest.restoreAllMocks());

describe('ROK-1888 — one live Quick Play per game across voice channels', () => {
  it('AC1: a spawn on channel B joins the live Quick Play born on channel A', async () => {
    const [a, b] = [await bindChannel(), await bindChannel()];
    const first = await spawnOn(a);
    const second = await spawnOn(b);

    expect(first?.existing).toBe(false);
    expect(second).toEqual({ eventId: first?.eventId, existing: true });
    expect((await adHocEventsOfGame()).map((r) => r.id)).toEqual([
      first?.eventId,
    ]);
  });

  it('AC2: two channels spawning at the same moment produce ONE event', async () => {
    const [a, b] = [await bindChannel(), await bindChannel()];
    const results = await Promise.all([spawnOn(a), spawnOn(b)]);

    const ids = new Set(results.map((r) => r?.eventId));
    expect(ids.size).toBe(1);
    expect(results.map((r) => r?.existing).sort()).toEqual([false, true]);
    expect(await adHocEventsOfGame()).toHaveLength(1);
  });

  it('AC3: leaving A while B still has an open voice row does not start grace', async () => {
    const [a] = [await bindChannel(), await bindChannel()];
    await adHoc.handleVoiceJoin(
      a,
      voiceMember('a-1888'),
      { gameId: gameId(), config: null },
      gameId(),
    );
    const [event] = nonEmpty(await adHocEventsOfGame(), 'event');
    // B's member is in the DB only (in-memory drift after a restart).
    await testApp.db.insert(schema.adHocParticipants).values({
      eventId: event.id,
      discordUserId: 'b-1888',
      discordUsername: 'b-1888',
      inVoice: true,
    });

    await adHoc.handleVoiceLeave(a, 'a-1888', gameId());

    expect(enqueue).not.toHaveBeenCalled();
    const [after] = nonEmpty(await adHocEventsOfGame(), 'event after leave');
    expect(after.status).toBe('live');
  });
});
