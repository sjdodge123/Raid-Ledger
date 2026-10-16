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
import {
  SERVER_PRESENCE_READER,
  type ServerPresenceReader,
  type ServerRosterPlayer,
} from '../../plugins/pelican/presence/server-presence.reader';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { AdHocServerPresenceService } from './ad-hoc-server-presence.service';

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

const signupsOf = (eventId: number) =>
  testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));

async function linkAdminTo(steamId: string): Promise<number> {
  const admin = testApp.seed.adminUser;
  await testApp.db
    .update(schema.users)
    .set({ steamId })
    .where(eq(schema.users.id, admin.id));
  return admin.id;
}

describe('AdHocServerPresenceService — held players across a session restart (ROK-1802)', () => {
  it('a player held before a session restart is not a phantom in the next spawn', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    // Plugin reactivated: the new session rehydrates; STEAM_A left meanwhile.
    await sink.openPresence(src);
    await sink.playerJoined(src, player(STEAM_B));
    expect(await adHocEvents()).toHaveLength(0);

    await sink.playerJoined(src, player(STEAM_C));
    const [event] = nonEmpty(await adHocEvents(), 'spawned ad-hoc event');
    const steamIds = (await rowsOf(event.id)).map((r) => r.steamId).sort();
    expect(steamIds).toEqual([STEAM_B, STEAM_C]);
  });

  it('a held player still on the server is enrolled once a heartbeat covers the count', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    // Reactivated; STEAM_A's join is older than the replay, so only a count vouches for them.
    await sink.openPresence(src);
    await sink.playerJoined(src, player(STEAM_B));
    expect(await adHocEvents()).toHaveLength(0);

    await sink.playerCount(src, 2);
    const [event] = nonEmpty(await adHocEvents(), 'spawned ad-hoc event');
    const steamIds = (await rowsOf(event.id)).map((r) => r.steamId).sort();
    expect(steamIds).toEqual([STEAM_A, STEAM_B]);
  });

  it('reports a held player to the new session, and their leave after a heartbeat enrolled them starts grace (Codex r4)', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    await sink.openPresence(src);
    // The session seeds its departure tracking from this.
    expect(await sink.heldPresence(src)).toEqual([player(STEAM_A)]);
    await sink.playerJoined(src, player(STEAM_B));
    await sink.playerCount(src, 2);
    const [event] = nonEmpty(await adHocEvents(), 'spawned ad-hoc event');

    await sink.playerLeft(src, STEAM_A);
    await sink.playerLeft(src, STEAM_B);
    const open = (await rowsOf(event.id)).filter((r) => r.leftAt === null);
    expect(open).toEqual([]);
    expect(enqueue).toHaveBeenCalledWith(event.id, 5 * 60 * 1000);
  });
});

describe('AdHocServerPresenceService — linked players are signed up (ROK-1802)', () => {
  it('signs a linked server player up at spawn; the unlinked one gets none', async () => {
    const adminId = await linkAdminTo(STEAM_A);
    const eventId = await spawnWithTwo(source());
    const signups = await signupsOf(eventId);
    expect(signups.map((s) => s.userId)).toEqual([adminId]);
    expect(signups[0]).toMatchObject({ status: 'signed_up' });
  });

  it('signs a linked server player up when they attach to a live Quick Play', async () => {
    const adminId = await linkAdminTo(STEAM_C);
    const src = source();
    const eventId = await spawnWithTwo(src);
    expect(await signupsOf(eventId)).toHaveLength(0);

    await sink.playerJoined(src, player(STEAM_C));
    const signups = await signupsOf(eventId);
    expect(signups.map((s) => s.userId)).toEqual([adminId]);
  });
});

describe('AdHocServerPresenceService — tracker reader resolved through DI (Codex r2 P1)', () => {
  let reader: ServerPresenceReader;
  let service: AdHocServerPresenceService;
  const strict = { strict: false };
  const tracked = (src: ServerPresenceSource, steamId: string) =>
    jest
      .spyOn(reader, 'playersForGame')
      .mockReturnValue([
        { ...src, steamId, name: 'Tracked' } satisfies ServerRosterPlayer,
      ]);

  beforeAll(() => {
    reader = testApp.app.get<ServerPresenceReader>(SERVER_PRESENCE_READER, strict);
    service = testApp.app.get(AdHocServerPresenceService, strict);
  });

  afterEach(() => jest.mocked(reader.playersForGame).mockRestore());

  // With the old `@Optional() moduleRef: ModuleRef | null` (no @Inject) the
  // paramtype was `Object`, Nest injected nothing and the reader read as null:
  // onTrackerEnrol answered false and STEAM_C never got a row.
  it('the app-resolved service reads the tracker and enrols a tracked player', async () => {
    const src = source();
    const eventId = await spawnWithTwo(src);
    tracked(src, STEAM_C);

    await expect(
      service.onTrackerEnrol({ eventId, gameId: src.gameId }),
    ).resolves.toBe(true);
    const row = (await rowsOf(eventId)).find((r) => r.steamId === STEAM_C);
    expect(row).toMatchObject({
      onServer: true,
      leftAt: null,
      pelicanServerId: src.pelicanServerId,
    });
  });

  it('a player open on another server of the game is not re-attached (Codex r2 P2)', async () => {
    const src = source();
    const eventId = await spawnWithTwo(src);
    tracked(source(), STEAM_A); // the tracker already sees them on a new server

    await service.onTrackerEnrol({ eventId, gameId: src.gameId });
    const rows = (await rowsOf(eventId)).filter((r) => r.steamId === STEAM_A);
    expect(rows.map((r) => r.pelicanServerId)).toEqual([src.pelicanServerId]);
  });
});
