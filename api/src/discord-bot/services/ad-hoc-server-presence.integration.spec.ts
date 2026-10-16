/**
 * ROK-1800 L4 — the Quick Play side of the Pelican server-presence sink,
 * against a real database: spawn threshold, one Quick Play per game, the
 * voice+server one-participant rule, suppression, grace and rehydrate.
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
const STEAM_A = '76561198000000101';
const STEAM_B = '76561198000000102';
const STEAM_C = '76561198000000103';

let testApp: TestApp;
let sink: ServerPresenceSink;
let participants: AdHocParticipantService;
let enqueue: jest.SpyInstance;
let serverSeq = 9000;

/** A fresh Pelican server id per test: the sink's pending set is in memory. */
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

const rowsOf = (eventId: number) =>
  testApp.db.select().from(t).where(eq(t.eventId, eventId));

async function setEnabled(value: 'true' | 'false'): Promise<void> {
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.AD_HOC_EVENTS_ENABLED, value);
}

/** Two players → the default `minPlayers` (2) spawns; returns the event id. */
async function spawnWithTwo(src: ServerPresenceSource): Promise<number> {
  await sink.playerJoined(src, player(STEAM_A));
  await sink.playerJoined(src, player(STEAM_B));
  const [event] = nonEmpty(await adHocEvents(), 'spawned ad-hoc event');
  return event.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
  sink = testApp.app.get<ServerPresenceSink>(SERVER_PRESENCE_SINK);
  participants = testApp.app.get(AdHocParticipantService);
  const queue = testApp.app.get(AdHocGracePeriodQueueService);
  enqueue = jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);
  jest.spyOn(queue, 'cancel').mockResolvedValue(undefined);
});

beforeEach(async () => {
  enqueue.mockClear();
  await setEnabled('true');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(() => jest.restoreAllMocks());

describe('AdHocServerPresenceService — spawn and attach (real DB)', () => {
  it('holds a lone player below minPlayers, then spawns one Quick Play at two', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    expect(await adHocEvents()).toHaveLength(0);

    await sink.playerJoined(src, player(STEAM_B));
    const events = await adHocEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      adHocStatus: 'live',
      channelBindingId: null,
    });
    const rows = await rowsOf(nonEmpty(events, 'event')[0].id);
    expect(rows.map((r) => r.steamId).sort()).toEqual([STEAM_A, STEAM_B]);
  });

  it('attaches a later server player to the same event', async () => {
    const src = source();
    const eventId = await spawnWithTwo(src);
    await sink.playerJoined(src, player(STEAM_C));

    expect(await adHocEvents()).toHaveLength(1);
    expect(await rowsOf(eventId)).toHaveLength(3);
  });

  it('shows an unlinked player by their in-game name, with no user', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A, 'Ragnhild'));
    await sink.playerJoined(src, player(STEAM_B, 'Bjorn'));
    const [event] = nonEmpty(await adHocEvents(), 'event');
    const row = (await rowsOf(event.id)).find((r) => r.steamId === STEAM_A);

    expect(row).toMatchObject({
      discordUsername: 'Ragnhild',
      userId: null,
      discordUserId: null,
      source: 'steam',
    });
  });

  it('does nothing while the Quick Play kill switch is off', async () => {
    await setEnabled('false');
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    await sink.playerJoined(src, player(STEAM_B));

    expect(await adHocEvents()).toHaveLength(0);
  });

  it('a live scheduled event for the game suppresses the spawn', async () => {
    const now = Date.now();
    await testApp.db.insert(e).values({
      title: 'Valheim night',
      creatorId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      duration: [new Date(now - 600_000), new Date(now + 3_600_000)],
      isAdHoc: false,
    });
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    await sink.playerJoined(src, player(STEAM_B));

    expect(await adHocEvents()).toHaveLength(0);
  });
});

describe('AdHocServerPresenceService — guard below minPlayers', () => {
  it('a lone server player still extends a live scheduled event (Codex r4)', async () => {
    const now = Date.now();
    const scheduledEnd = new Date(now + 10 * 60_000);
    const inserted = await testApp.db
      .insert(e)
      .values({
        title: 'Valheim night',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: [new Date(now - 600_000), scheduledEnd],
        isAdHoc: false,
      })
      .returning();
    const scheduledId = nonEmpty(inserted, 'scheduled event')[0].id;

    await sink.playerJoined(source(), player(STEAM_A));

    const [row] = nonEmpty(
      await testApp.db.select().from(e).where(eq(e.id, scheduledId)),
      'scheduled event row',
    );
    // Below minPlayers, but the guard still ran and bumped the window.
    expect(row.extendedUntil?.getTime() ?? 0).toBeGreaterThan(
      scheduledEnd.getTime(),
    );
    expect(await adHocEvents()).toHaveLength(0);
  });
});

describe('AdHocServerPresenceService — one participant per person', () => {
  it('a linked user in voice who joins the server stays ONE participant', async () => {
    const src = source();
    const eventId = await spawnWithTwo(src);
    const admin = testApp.seed.adminUser;
    await testApp.db
      .update(schema.users)
      .set({ steamId: STEAM_C })
      .where(eq(schema.users.id, admin.id));
    await participants.addParticipant(eventId, {
      discordUserId: 'rok1800-l4-voice',
      discordUsername: 'VoiceName',
      discordAvatarHash: null,
      userId: admin.id,
    });

    await sink.playerJoined(src, player(STEAM_C));
    const mine = (await rowsOf(eventId)).filter((r) => r.userId === admin.id);

    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      steamId: STEAM_C,
      discordUserId: 'rok1800-l4-voice',
    });
  });

  it('a simultaneous voice join and server join for one user make one row', async () => {
    const eventId = await spawnWithTwo(source());
    const admin = testApp.seed.adminUser;
    await Promise.all([
      participants.addParticipant(eventId, {
        discordUserId: 'rok1800-l4-race',
        discordUsername: 'Racer',
        discordAvatarHash: null,
        userId: admin.id,
      }),
      participants.addServerParticipant(eventId, {
        steamId: STEAM_C,
        displayName: 'Racer',
        userId: admin.id,
      }),
    ]);
    const mine = (await rowsOf(eventId)).filter((r) => r.userId === admin.id);

    expect(mine).toHaveLength(1);
  });
});

describe('AdHocServerPresenceService — leave, grace and rehydrate', () => {
  it('starts the grace period once every server player has left', async () => {
    const src = source();
    const eventId = await spawnWithTwo(src);
    await sink.playerLeft(src, STEAM_A);
    expect(enqueue).not.toHaveBeenCalled();

    await sink.playerLeft(src, STEAM_B);
    expect(enqueue).toHaveBeenCalledWith(eventId, 5 * 60 * 1000);
    const [event] = nonEmpty(await adHocEvents(), 'event');
    expect(event.adHocStatus).toBe('grace_period');
  });

  it('serverEmptied closes every open server row and starts grace', async () => {
    const src = source();
    const eventId = await spawnWithTwo(src);
    await sink.serverEmptied(src);

    const open = (await rowsOf(eventId)).filter((r) => r.leftAt === null);
    expect(open).toEqual([]);
    expect(enqueue).toHaveBeenCalledWith(eventId, 5 * 60 * 1000);
  });

  it('openPresence returns only the server players still open', async () => {
    const src = source();
    await spawnWithTwo(src);
    await sink.playerLeft(src, STEAM_A);

    expect(await sink.openPresence(src)).toEqual([
      { steamId: STEAM_B, displayName: player(STEAM_B).displayName },
    ]);
  });
});

describe('AdHocServerPresenceService — a linked player in voice AND on the server (B1)', () => {
  it('their voice leave does not end the session while they are still in game', async () => {
    const src = source();
    const eventId = await spawnWithTwo(src);
    const admin = testApp.seed.adminUser;
    await testApp.db
      .update(schema.users)
      .set({ steamId: STEAM_C })
      .where(eq(schema.users.id, admin.id));
    await participants.addParticipant(eventId, {
      discordUserId: 'rok1800-b1-voice',
      discordUsername: 'VoiceName',
      discordAvatarHash: null,
      userId: admin.id,
    });
    await sink.playerJoined(src, player(STEAM_C));

    await participants.markLeave(eventId, 'rok1800-b1-voice');
    await sink.playerLeft(src, STEAM_A);
    await sink.playerLeft(src, STEAM_B);
    expect(enqueue).not.toHaveBeenCalled();

    await sink.playerLeft(src, STEAM_C);
    expect(enqueue).toHaveBeenCalledWith(eventId, 5 * 60 * 1000);
  });
});
