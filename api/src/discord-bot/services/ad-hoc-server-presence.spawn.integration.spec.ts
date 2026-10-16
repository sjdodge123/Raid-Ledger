/**
 * ROK-1800 FA2 — the server-presence spawn, against a real database: one
 * Quick Play per game across the voice and server paths, atomic spawn, the
 * spawn card's roster, pending players, per-server scoping and renames.
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
import { AdHocEventService } from './ad-hoc-event.service';
import { AdHocNotificationService } from './ad-hoc-notification.service';

const e = schema.events;
const t = schema.adHocParticipants;
const STEAM_A = '76561198000000201';
const STEAM_B = '76561198000000202';
const STEAM_C = '76561198000000203';

let testApp: TestApp;
let sink: ServerPresenceSink;
let adHoc: AdHocEventService;
let notifySpawn: jest.SpyInstance;
let enqueue: jest.SpyInstance;
let serverSeq = 9500;

const source = (): ServerPresenceSource => ({
  pelicanServerId: ++serverSeq,
  gameId: testApp.seed.game.id,
});
const player = (
  steamId: string,
  displayName = `Viking-${steamId.slice(-3)}`,
) => ({
  steamId,
  displayName,
});
const adHocEvents = () =>
  testApp.db
    .select()
    .from(e)
    .where(and(eq(e.isAdHoc, true), eq(e.gameId, testApp.seed.game.id)));
const steamIdsOf = async (eventId: number) =>
  (await testApp.db.select().from(t).where(eq(t.eventId, eventId)))
    .map((r) => r.steamId ?? r.discordUserId)
    .sort();

async function bindGame(): Promise<string> {
  const rows = await testApp.db
    .insert(schema.channelBindings)
    .values({
      guildId: 'guild-fa2',
      channelId: `fa2-voice-${serverSeq}`,
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: testApp.seed.game.id,
    })
    .returning();
  return nonEmpty(rows, 'binding')[0].id;
}

const voiceMember = (id: string) => ({
  discordUserId: id,
  discordUsername: id,
  discordAvatarHash: null,
  userId: null,
});

beforeAll(async () => {
  testApp = await getTestApp();
  sink = testApp.app.get<ServerPresenceSink>(SERVER_PRESENCE_SINK);
  adHoc = testApp.app.get(AdHocEventService);
  const queue = testApp.app.get(AdHocGracePeriodQueueService);
  enqueue = jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);
  jest.spyOn(queue, 'cancel').mockResolvedValue(undefined);
  const notes = testApp.app.get(AdHocNotificationService);
  notifySpawn = jest.spyOn(notes, 'notifySpawn').mockResolvedValue(undefined);
  jest.spyOn(notes, 'queueUpdate').mockImplementation(() => undefined);
});

beforeEach(async () => {
  enqueue.mockClear();
  notifySpawn.mockClear();
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.AD_HOC_EVENTS_ENABLED, 'true');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(() => jest.restoreAllMocks());

describe('one Quick Play per game across voice and server (m5)', () => {
  it('a voice spawn joins the live server-born Quick Play instead of making a second', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    await sink.playerJoined(src, player(STEAM_B));
    const bindingId = await bindGame();

    await adHoc.handleVoiceJoin(
      bindingId,
      voiceMember('fa2-voice-1'),
      { gameId: testApp.seed.game.id, config: null },
      testApp.seed.game.id,
    );
    const events = await adHocEvents();

    expect(events.map((ev) => ev.id)).toHaveLength(1);
    expect(await steamIdsOf(nonEmpty(events, 'event')[0].id)).toEqual(
      [STEAM_A, STEAM_B, 'fa2-voice-1'].sort(),
    );
  });

  it('a concurrent voice spawn and server spawn make ONE live Quick Play', async () => {
    const src = source();
    const bindingId = await bindGame();
    await sink.playerJoined(src, player(STEAM_A));
    await Promise.all([
      adHoc.handleVoiceJoin(
        bindingId,
        voiceMember('fa2-voice-2'),
        { gameId: testApp.seed.game.id, config: null },
        testApp.seed.game.id,
      ),
      sink.playerJoined(src, player(STEAM_B)),
    ]);

    expect((await adHocEvents()).map((ev) => ev.id)).toHaveLength(1);
  });
});

describe('atomic server spawn (m9)', () => {
  it('an enrol failure leaves no live Quick Play behind', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    // 40 chars overflows steam_id varchar(32): the enrol insert fails.
    await expect(
      sink.playerJoined(src, player('7'.repeat(40))),
    ).rejects.toThrow();

    expect((await adHocEvents()).map((ev) => ev.id)).toEqual([]);
  });
});

describe('spawn card roster (Codex: unlinked players)', () => {
  it('lists unlinked server players by character name', async () => {
    await bindGame();
    const src = source();
    await sink.playerJoined(src, player(STEAM_A, 'Ragnhild'));
    await sink.playerJoined(src, player(STEAM_B, 'Bjorn'));

    expect(notifySpawn).toHaveBeenCalledTimes(1);
    expect(notifySpawn.mock.calls[0]?.[3]).toEqual([
      { discordUserId: null, discordUsername: 'Ragnhild' },
      { discordUserId: null, discordUsername: 'Bjorn' },
    ]);
  });
});

describe('pending players and a live event (m2 / Codex)', () => {
  it('a player held below minPlayers attaches when a live event exists', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    const now = Date.now();
    const inserted = await testApp.db
      .insert(e)
      .values({
        title: 'Valheim — Quick Play',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: [new Date(now - 60_000), new Date(now + 3_600_000)],
        isAdHoc: true,
        adHocStatus: 'live',
      })
      .returning();
    const eventId = nonEmpty(inserted, 'live event')[0].id;

    await sink.playerJoined(src, player(STEAM_B));

    expect(await steamIdsOf(eventId)).toEqual([STEAM_A, STEAM_B]);
  });
});

describe('per-server scoping (m6)', () => {
  it("one server emptying leaves another server's players open", async () => {
    const one = source();
    const two = { ...source(), gameId: one.gameId };
    await sink.playerJoined(one, player(STEAM_A));
    await sink.playerJoined(one, player(STEAM_B));
    await sink.playerJoined(two, player(STEAM_C));
    await sink.serverEmptied(one);

    expect(await sink.openPresence(two)).toEqual([player(STEAM_C)]);
    expect(await sink.openPresence(one)).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('renames (n1)', () => {
  it('a rename of a never-pending player does not enrol them at spawn', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    await sink.playerRenamed(src, player(STEAM_C, 'Ghost'));
    await sink.playerJoined(src, player(STEAM_B));
    const [event] = nonEmpty(await adHocEvents(), 'spawned event');

    expect(await steamIdsOf(event.id)).toEqual([STEAM_A, STEAM_B]);
  });
});

/** A live ad-hoc event for the seeded game, inserted directly (newest id). */
async function insertLiveEvent(): Promise<number> {
  const now = Date.now();
  const inserted = await testApp.db
    .insert(e)
    .values({
      title: 'Valheim — Quick Play (other binding)',
      creatorId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      duration: [new Date(now - 60_000), new Date(now + 3_600_000)],
      isAdHoc: true,
      adHocStatus: 'live',
    })
    .returning();
  return nonEmpty(inserted, 'live event')[0].id;
}

/** Bounded poll for an async listener's write; the caller asserts after. */
async function until(cond: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100 && !(await cond()); i++)
    await new Promise((r) => setTimeout(r, 30));
}

const openRow = async (eventId: number, steamId: string) =>
  nonEmpty(
    await testApp.db
      .select()
      .from(t)
      .where(and(eq(t.eventId, eventId), eq(t.steamId, steamId))),
    `row ${steamId}`,
  )[0];

describe('Codex r2 — leaves route to the enrolled event', () => {
  it('a server departure closes the row on its own event, not the newest', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    await sink.playerJoined(src, player(STEAM_B));
    const [serverEvent] = nonEmpty(await adHocEvents(), 'server event');
    const newer = await insertLiveEvent();
    expect(newer).toBeGreaterThan(serverEvent.id);

    await sink.playerLeft(src, STEAM_A);

    const row = await openRow(serverEvent.id, STEAM_A);
    expect({ closed: row.leftAt !== null, onServer: row.onServer }).toEqual({
      closed: true,
      onServer: false,
    });
    expect(await sink.openPresence(src)).toEqual([player(STEAM_B)]);
  });
});

describe('Codex r2 — held players drain when any source spawns', () => {
  it('a voice-born Quick Play takes a player held below minPlayers', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    const bindingId = await bindGame();

    await adHoc.handleVoiceJoin(
      bindingId,
      voiceMember('fc-voice-drain'),
      { gameId: testApp.seed.game.id, config: null },
      testApp.seed.game.id,
    );
    const [event] = nonEmpty(await adHocEvents(), 'voice-born event');
    await until(async () => (await steamIdsOf(event.id)).includes(STEAM_A));

    expect(await steamIdsOf(event.id)).toEqual(
      [STEAM_A, 'fc-voice-drain'].sort(),
    );
  });

  it("another server's spawn takes a player held on this server", async () => {
    const one = source();
    const two = { ...source(), gameId: one.gameId };
    await sink.playerJoined(one, player(STEAM_A));
    await sink.playerJoined(two, player(STEAM_B));
    await sink.playerJoined(two, player(STEAM_C));
    const [event] = nonEmpty(await adHocEvents(), 'spawned event');

    expect(await steamIdsOf(event.id)).toEqual([STEAM_A, STEAM_B, STEAM_C]);
    expect(await sink.openPresence(one)).toEqual([player(STEAM_A)]);
  });
});

describe('Codex r2 — a raced voice spawn keeps its first joiner', () => {
  it("the first joiner's voice leave still closes their row", async () => {
    const bindingId = await bindGame();
    const gameId = testApp.seed.game.id;
    const binding = { gameId, config: null };
    await Promise.all([
      adHoc.handleVoiceJoin(bindingId, voiceMember('fc-v1'), binding, gameId),
      adHoc.handleVoiceJoin(bindingId, voiceMember('fc-v2'), binding, gameId),
    ]);
    const [event] = nonEmpty(await adHocEvents(), 'raced event');
    expect((await steamIdsOf(event.id)).sort()).toEqual(['fc-v1', 'fc-v2']);

    await adHoc.handleVoiceLeave(bindingId, 'fc-v1');

    const rows = await testApp.db
      .select()
      .from(t)
      .where(and(eq(t.eventId, event.id), eq(t.discordUserId, 'fc-v1')));
    expect(nonEmpty(rows, 'fc-v1 row')[0].leftAt).not.toBeNull();
  });
});
