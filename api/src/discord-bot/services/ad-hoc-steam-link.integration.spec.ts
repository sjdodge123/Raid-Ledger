/**
 * ROK-1888 L4 (ruling 2) against a real database:
 * - AC8: linking Steam mid-session folds the unlinked server row into the
 *   user's voice row (or claims it when they are not in voice), so the
 *   `· on server` entry disappears and the person is counted once.
 * - AC9: an RL-linked voice member with no Steam, on a Quick Play holding an
 *   unlinked server row, gets ONE `lineup_steam_nudge` per 30 days; none when
 *   their prefs are off, none when they already have Steam linked.
 *
 * Driven through the app's real EventEmitter2 (`emitAsync` awaits every
 * listener), spying on the real singleton `NotificationService.create`.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { NotificationService } from '../../notifications/notification.service';
import { STEAM_ACCOUNT_LINKED } from '../../steam/steam.constants';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { AD_HOC_EVENTS } from '../discord-bot.constants';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import {
  isCountedParticipant,
  readParticipants,
} from './ad-hoc-notification.helpers';

const t = schema.adHocParticipants;
const STEAM = '76561198000001888';
const NUDGE_KEY = (userId: number) => `quick-play-steam-nudge:${userId}`;

let testApp: TestApp;
let emitter: EventEmitter2;
let rows: AdHocParticipantService;
let create: jest.SpyInstance;
let rosterEmit: jest.SpyInstance;
let seq = 0;

async function insertEvent(status: 'live' | 'ended' = 'live') {
  const now = new Date();
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Quick Play',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: [now, new Date(now.getTime() + 3_600_000)],
        isAdHoc: true,
        adHocStatus: status,
      })
      .returning(),
    'event',
  );
  return event.id;
}

/** An active RL member with Discord linked; Steam only when asked. */
async function insertUser(steamId: string | null = null) {
  const n = ++seq;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username: `l4-user-${n}`, discordId: `l4-d-${n}`, steamId })
      .returning(),
    'user',
  );
  await testApp.app.get<Redis>(REDIS_CLIENT).del(NUDGE_KEY(user.id));
  return user;
}

const joinVoice = (
  eventId: number,
  user: { id: number; discordId: string | null },
) =>
  rows.addParticipant(eventId, {
    discordUserId: user.discordId ?? 'missing',
    discordUsername: `voice-${user.id}`,
    discordAvatarHash: null,
    userId: user.id,
  });

const joinServerUnlinked = (eventId: number) =>
  rows.addServerParticipant(eventId, {
    steamId: STEAM,
    displayName: 'Loanati',
    userId: null,
    pelicanServerId: 7,
  });

const rowsOf = (eventId: number) =>
  testApp.db.select().from(t).where(eq(t.eventId, eventId));

const emitJoin = (
  eventId: number,
  userId: number | null,
  discordUserId?: string,
) =>
  emitter.emitAsync(AD_HOC_EVENTS.PARTICIPANT_JOINED, {
    eventId,
    userId,
    ...(discordUserId === undefined ? {} : { discordUserId }),
  });

async function linkSteam(userId: number) {
  await testApp.db
    .update(schema.users)
    .set({ steamId: STEAM })
    .where(eq(schema.users.id, userId));
  await emitter.emitAsync(STEAM_ACCOUNT_LINKED, { userId, steamId64: STEAM });
}

beforeAll(async () => {
  testApp = await getTestApp();
  emitter = testApp.app.get(EventEmitter2);
  // Seed rows through a detached service so no seeding emit races the test.
  rows = new AdHocParticipantService(testApp.db, new EventEmitter2());
  create = jest.spyOn(testApp.app.get(NotificationService), 'create');
  rosterEmit = jest
    .spyOn(testApp.app.get(AdHocEventsGateway), 'emitRosterUpdate')
    .mockImplementation(() => undefined);
});

beforeEach(() => {
  create.mockClear();
  rosterEmit.mockClear();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('AC8 — merge-on-link', () => {
  it('folds the unlinked server row into the voice row and re-renders', async () => {
    const eventId = await insertEvent();
    const user = await insertUser();
    await joinVoice(eventId, user);
    await joinServerUnlinked(eventId);

    await linkSteam(user.id);

    const after = await rowsOf(eventId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      userId: user.id,
      discordUserId: user.discordId,
      steamId: STEAM,
      onServer: true,
      pelicanServerId: 7,
    });
    const participants = await readParticipants(testApp.db, eventId);
    expect(participants.filter((p) => p.unlinkedOnServer)).toEqual([]);
    expect(participants.filter(isCountedParticipant)).toHaveLength(1);
    expect(rosterEmit).toHaveBeenCalledWith(eventId, expect.any(Array), 1);
  });

  it('claims the server row for the user when they are not in voice', async () => {
    const eventId = await insertEvent();
    const user = await insertUser();
    await joinServerUnlinked(eventId);

    await linkSteam(user.id);

    const after = await rowsOf(eventId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ userId: user.id, steamId: STEAM });
  });

  it('leaves an ended event untouched', async () => {
    const eventId = await insertEvent('ended');
    const user = await insertUser();
    await joinServerUnlinked(eventId);

    await linkSteam(user.id);

    const after = await rowsOf(eventId);
    expect(after[0]).toMatchObject({ userId: null, steamId: STEAM });
  });
});

const nudgeFor = (userId: number, eventId: number) => ({
  userId,
  type: 'lineup_steam_nudge',
  title: 'Link your Steam account',
  message: expect.stringContaining(
    'Quick Play and a Steam player is on the game server',
  ),
  payload: { eventId, gameId: testApp.seed.game.id },
});

describe('AC9 — Steam-link nudge', () => {
  it('nudges a voice member without Steam once per 30 days', async () => {
    const user = await insertUser();
    const first = await insertEvent();
    await joinServerUnlinked(first);
    await joinVoice(first, user);
    await emitJoin(first, user.id, user.discordId ?? undefined);

    const second = await insertEvent();
    await joinServerUnlinked(second);
    await joinVoice(second, user);
    await emitJoin(second, user.id, user.discordId ?? undefined);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(nudgeFor(user.id, first));
  });

  it('m1: a failed send releases the 30-day cooldown so the next join retries', async () => {
    const user = await insertUser();
    create.mockRejectedValueOnce(new Error('send failed'));
    const first = await insertEvent();
    await joinServerUnlinked(first);
    await joinVoice(first, user);
    await emitJoin(first, user.id, user.discordId ?? undefined);

    const second = await insertEvent();
    await joinServerUnlinked(second);
    await joinVoice(second, user);
    await emitJoin(second, user.id, user.discordId ?? undefined);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith(nudgeFor(user.id, second));
  });

  it('nudges voice members when the unlinked server row arrives second', async () => {
    const user = await insertUser();
    const eventId = await insertEvent();
    await joinVoice(eventId, user);
    await joinServerUnlinked(eventId);
    await emitJoin(eventId, null);

    expect(create).toHaveBeenCalledWith(nudgeFor(user.id, eventId));
  });

  it('writes no notification when the member turned the nudge off', async () => {
    const user = await insertUser();
    await testApp.app.get(NotificationService).updatePreferences(user.id, {
      channelPrefs: {
        lineup_steam_nudge: { inApp: false, push: false, discord: false },
      },
    });
    const eventId = await insertEvent();
    await joinServerUnlinked(eventId);
    await joinVoice(eventId, user);
    await emitJoin(eventId, user.id, user.discordId ?? undefined);

    const notes = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, user.id));
    expect(notes).toEqual([]);
  });

  it('sends nothing to a member with Steam linked, or with no unlinked row', async () => {
    const linked = await insertUser('76561198000009999');
    const plain = await insertUser();
    const withServer = await insertEvent();
    await joinServerUnlinked(withServer);
    await joinVoice(withServer, linked);
    await emitJoin(withServer, linked.id, linked.discordId ?? undefined);
    const noServer = await insertEvent();
    await joinVoice(noServer, plain);
    await emitJoin(noServer, plain.id, plain.discordId ?? undefined);

    expect(create).not.toHaveBeenCalled();
  });
});

describe('ROK-1888 Codex r1 P2 — merge-on-link keeps attendance', () => {
  const ago = (ms: number) => new Date(Date.now() - ms);

  /** A voice row closed at t1 (600s banked) + an open server row since t2. */
  async function seedClosedVoiceOpenServer(userId: number, eventId: number) {
    const t2 = ago(1_200_000);
    await testApp.db
      .update(t)
      .set({
        joinedAt: ago(3_600_000),
        leftAt: ago(2_400_000),
        inVoice: false,
        totalDurationSeconds: 600,
      })
      .where(and(eq(t.eventId, eventId), eq(t.userId, userId)));
    await joinServerUnlinked(eventId);
    await testApp.db
      .update(t)
      .set({ joinedAt: t2, totalDurationSeconds: 120 })
      .where(and(eq(t.eventId, eventId), eq(t.steamId, STEAM)));
    return t2;
  }

  const clock = async (eventId: number) => {
    const [row, ...rest] = await rowsOf(eventId);
    if (!row || rest.length > 0) throw new Error('expected exactly one row');
    return {
      leftAt: row.leftAt,
      joinedAt: row.joinedAt.toISOString(),
      totalDurationSeconds: row.totalDurationSeconds,
      sessionCount: row.sessionCount,
    };
  };

  it('a reopened voice row starts its clock at the server session and banks both totals', async () => {
    const eventId = await insertEvent();
    const user = await insertUser();
    await joinVoice(eventId, user);
    const t2 = await seedClosedVoiceOpenServer(user.id, eventId);

    await linkSteam(user.id);

    expect(await clock(eventId)).toEqual({
      leftAt: null,
      joinedAt: t2.toISOString(),
      totalDurationSeconds: 720,
      sessionCount: 2,
    });
  });

  it('a second link event changes nothing — no row is counted twice', async () => {
    const eventId = await insertEvent();
    const user = await insertUser();
    await joinVoice(eventId, user);
    await seedClosedVoiceOpenServer(user.id, eventId);
    await linkSteam(user.id);
    const once = await clock(eventId);

    await linkSteam(user.id);

    expect(await clock(eventId)).toEqual(once);
  });
});

describe('ROK-1888 Codex r1 P2 — a voice REJOIN triggers the nudge', () => {
  it('nudges a member who left, then rejoined after the unlinked row arrived', async () => {
    const user = await insertUser();
    const eventId = await insertEvent();
    await joinVoice(eventId, user);
    await rows.markLeave(eventId, user.discordId ?? 'missing');
    await joinServerUnlinked(eventId);
    // Capture what the REAL service emits on the rejoin, then deliver it to
    // the app's emitter with emitAsync so every listener is awaited.
    const relay = new EventEmitter2({ wildcard: false });
    const seen: Array<[string, unknown]> = [];
    relay.onAny((name, payload) => {
      seen.push([String(name), payload]);
    });
    await new AdHocParticipantService(testApp.db, relay).addParticipant(
      eventId,
      {
        discordUserId: user.discordId ?? 'missing',
        discordUsername: `voice-${user.id}`,
        discordAvatarHash: null,
        userId: user.id,
      },
    );
    for (const [name, payload] of seen) await emitter.emitAsync(name, payload);

    expect(create).toHaveBeenCalledWith(nudgeFor(user.id, eventId));
  });
});
