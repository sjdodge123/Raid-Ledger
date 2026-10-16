/**
 * ROK-1800 Codex r3 — server presence is routed by the player's ENROLLMENT
 * on the reporting server, not by the game's newest event:
 * - P2: a late leave from a server the player moved away from is ignored.
 * - P3: a character rename lands on the event the player is enrolled in.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import {
  SERVER_PRESENCE_SINK,
  type ServerPresenceSink,
  type ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import { AdHocParticipantService } from './ad-hoc-participant.service';

const e = schema.events;
const t = schema.adHocParticipants;
const STEAM_A = '76561198000000501';
const STEAM_B = '76561198000000502';

let testApp: TestApp;
let sink: ServerPresenceSink;
let participants: AdHocParticipantService;
let serverSeq = 9900;

const source = (): ServerPresenceSource => ({
  pelicanServerId: ++serverSeq,
  gameId: testApp.seed.game.id,
});

const player = (steamId: string, displayName: string = steamId) => ({
  steamId,
  displayName,
});

const rowOf = async (eventId: number, steamId: string) => {
  const rows = await testApp.db
    .select()
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.steamId, steamId)));
  return nonEmpty(rows, `row for ${steamId}`)[0];
};

async function insertLiveEvent(title: string): Promise<number> {
  const now = new Date();
  const rows = await testApp.db
    .insert(e)
    .values({
      title,
      creatorId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      duration: [now, new Date(now.getTime() + 3_600_000)],
      isAdHoc: true,
      adHocStatus: 'live',
    })
    .returning();
  return nonEmpty(rows, title)[0].id;
}

beforeAll(async () => {
  testApp = await getTestApp();
  sink = testApp.app.get<ServerPresenceSink>(SERVER_PRESENCE_SINK);
  participants = testApp.app.get(AdHocParticipantService);
  const queue = testApp.app.get(AdHocGracePeriodQueueService);
  jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);
  jest.spyOn(queue, 'cancel').mockResolvedValue(undefined);
});

beforeEach(async () => {
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.AD_HOC_EVENTS_ENABLED, 'true');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(() => jest.restoreAllMocks());

describe('AdHocServerPresenceService — enrollment routing (Codex r3)', () => {
  it('ignores a late leave from the server a player moved away from', async () => {
    const oldServer = source();
    const newServer = source();
    await sink.playerJoined(oldServer, player(STEAM_A));
    await sink.playerJoined(oldServer, player(STEAM_B));
    const [event] = nonEmpty(
      await testApp.db.select().from(e).where(eq(e.isAdHoc, true)),
      'spawned event',
    );
    await sink.playerJoined(newServer, player(STEAM_A));

    await sink.playerLeft(oldServer, STEAM_A);

    const row = await rowOf(event.id, STEAM_A);
    expect({
      closed: row.leftAt !== null,
      onServer: row.onServer,
      pelicanServerId: row.pelicanServerId,
    }).toEqual({
      closed: false,
      onServer: true,
      pelicanServerId: newServer.pelicanServerId,
    });
  });

  it('renames the player on the event they are enrolled in, not the newest', async () => {
    const src = source();
    const enrolled = await insertLiveEvent('Older Quick Play');
    await insertLiveEvent('Newer Quick Play');
    await participants.addServerParticipant(enrolled, {
      steamId: STEAM_A,
      displayName: STEAM_A,
      userId: null,
      pelicanServerId: src.pelicanServerId,
    });

    await sink.playerRenamed(src, player(STEAM_A, 'Ragnhild'));

    expect((await rowOf(enrolled, STEAM_A)).discordUsername).toBe('Ragnhild');
  });
});
