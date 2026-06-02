/**
 * Ad-Hoc Events Integration Tests (ROK-293)
 *
 * Verifies ad-hoc event fields persist, participant tracking works
 * with real DB operations (upsert, session counting, duration calc),
 * and the ad-hoc roster API returns correct data.
 *
 * Uses direct DB operations for participant tracking since the
 * AdHocParticipantService is triggered by Discord voice events,
 * not HTTP endpoints. The roster endpoint IS tested via HTTP.
 */
import { eq, and, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { AdHocNotificationService } from './services/ad-hoc-notification.service';
import { DiscordBotClientService } from './discord-bot-client.service';

let testApp: TestApp;
let adminToken: string;
/** Track whether we need a fresh token after truncation */
let tokenStale = false;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  tokenStale = true; // Token invalid after truncation — refresh lazily
});

/** Get a valid admin token, refreshing only if stale from truncation */
async function ensureToken(): Promise<string> {
  if (tokenStale) {
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    tokenStale = false;
  }
  return adminToken;
}

/** Create an ad-hoc event directly in DB (system-created). */
async function createAdHocEvent(title = 'Test Quick Play') {
  const now = new Date();
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      creatorId: testApp.seed.adminUser.id,
      duration: [now, new Date(now.getTime() + 3600000)],
      isAdHoc: true,
      adHocStatus: 'live',
    })
    .returning();
  return event;
}

// ── Event ad-hoc fields persistence ──────────────────────────

describe('Ad-Hoc Events — field persistence', () => {
  it('should persist isAdHoc, adHocStatus, and channelBindingId on events', async () => {
    const db = testApp.db;

    const [binding] = await db
      .insert(schema.channelBindings)
      .values({
        guildId: '111222333444',
        channelId: '555666777888',
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: testApp.seed.game.id,
        config: { gracePeriod: 5, minPlayers: 2 },
      })
      .returning();

    const now = new Date();
    const endTime = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const [event] = await db
      .insert(schema.events)
      .values({
        title: 'Test Game — Quick Play',
        creatorId: testApp.seed.adminUser.id,
        duration: [now, endTime],
        isAdHoc: true,
        adHocStatus: 'live',
        channelBindingId: binding.id,
        gameId: testApp.seed.game.id,
      })
      .returning();

    expect(event.isAdHoc).toBe(true);
    expect(event.adHocStatus).toBe('live');
    expect(event.channelBindingId).toBe(binding.id);

    const [readBack] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id))
      .limit(1);

    expect(readBack.isAdHoc).toBe(true);
    expect(readBack.adHocStatus).toBe('live');
    expect(readBack.channelBindingId).toBe(binding.id);
  });

  it('should default isAdHoc to false for regular events', async () => {
    const token = await ensureToken();
    const createRes = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Regular Event',
        startTime: '2026-06-01T18:00:00.000Z',
        endTime: '2026-06-01T20:00:00.000Z',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.isAdHoc).toBe(false);
    expect(createRes.body.adHocStatus).toBeNull();
    expect(createRes.body.channelBindingId).toBeNull();
  });

  it('should update adHocStatus from live to ended', async () => {
    const db = testApp.db;
    const event = await createAdHocEvent('Quick Play');

    await db
      .update(schema.events)
      .set({ adHocStatus: 'ended' })
      .where(eq(schema.events.id, event.id));

    const [updated] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id))
      .limit(1);

    expect(updated.adHocStatus).toBe('ended');
    expect(updated.isAdHoc).toBe(true);
  });
});

// ── Ad-hoc participant CRUD ──────────────────────────────────

describe('Ad-Hoc Events — participant insert', () => {
  let adHocEventId: number;

  beforeEach(async () => {
    const event = await createAdHocEvent();
    adHocEventId = event.id;
  });

  it('should insert a participant and persist all fields', async () => {
    const db = testApp.db;
    const now = new Date();

    const [participant] = await db
      .insert(schema.adHocParticipants)
      .values({
        eventId: adHocEventId,
        userId: testApp.seed.adminUser.id,
        discordUserId: '123456789',
        discordUsername: 'TestPlayer',
        discordAvatarHash: 'abc123hash',
        joinedAt: now,
        sessionCount: 1,
      })
      .returning();

    expect(participant.eventId).toBe(adHocEventId);
    expect(participant.userId).toBe(testApp.seed.adminUser.id);
    expect(participant.discordUserId).toBe('123456789');
    expect(participant.discordUsername).toBe('TestPlayer');
    expect(participant.discordAvatarHash).toBe('abc123hash');
    expect(participant.leftAt).toBeNull();
    expect(participant.totalDurationSeconds).toBeNull();
    expect(participant.sessionCount).toBe(1);
  });

  it('should enforce unique constraint on (eventId, discordUserId)', async () => {
    const db = testApp.db;

    await db.insert(schema.adHocParticipants).values({
      eventId: adHocEventId,
      discordUserId: '123456789',
      discordUsername: 'Player1',
      sessionCount: 1,
    });

    await expect(
      db.insert(schema.adHocParticipants).values({
        eventId: adHocEventId,
        discordUserId: '123456789',
        discordUsername: 'Player1',
        sessionCount: 1,
      }),
    ).rejects.toThrow();
  });

  it('should track anonymous participants (no userId)', async () => {
    const db = testApp.db;

    const [participant] = await db
      .insert(schema.adHocParticipants)
      .values({
        eventId: adHocEventId,
        userId: null,
        discordUserId: '999888777',
        discordUsername: 'UnlinkedPlayer',
        discordAvatarHash: null,
        sessionCount: 1,
      })
      .returning();

    expect(participant.userId).toBeNull();
    expect(participant.discordUserId).toBe('999888777');
    expect(participant.discordUsername).toBe('UnlinkedPlayer');
  });
});

describe('Ad-Hoc Events — participant upsert and rejoin', () => {
  let adHocEventId: number;

  beforeEach(async () => {
    const event = await createAdHocEvent();
    adHocEventId = event.id;
  });

  it('should upsert participant on rejoin (increment sessionCount)', async () => {
    const db = testApp.db;
    const joinTime = new Date();

    await db.insert(schema.adHocParticipants).values({
      eventId: adHocEventId,
      discordUserId: '123456789',
      discordUsername: 'Player1',
      joinedAt: joinTime,
      sessionCount: 1,
    });

    const leaveTime = new Date(joinTime.getTime() + 600_000);
    await db
      .update(schema.adHocParticipants)
      .set({ leftAt: leaveTime, totalDurationSeconds: 600 })
      .where(
        and(
          eq(schema.adHocParticipants.eventId, adHocEventId),
          eq(schema.adHocParticipants.discordUserId, '123456789'),
        ),
      );

    await db
      .insert(schema.adHocParticipants)
      .values({
        eventId: adHocEventId,
        discordUserId: '123456789',
        discordUsername: 'Player1-Updated',
        joinedAt: new Date(),
        sessionCount: 1,
      })
      .onConflictDoUpdate({
        target: [
          schema.adHocParticipants.eventId,
          schema.adHocParticipants.discordUserId,
        ],
        set: {
          leftAt: null,
          discordUsername: 'Player1-Updated',
          sessionCount: 2,
        },
      });

    const [row] = await db
      .select()
      .from(schema.adHocParticipants)
      .where(
        and(
          eq(schema.adHocParticipants.eventId, adHocEventId),
          eq(schema.adHocParticipants.discordUserId, '123456789'),
        ),
      )
      .limit(1);

    expect(row.sessionCount).toBe(2);
    expect(row.leftAt).toBeNull();
    expect(row.discordUsername).toBe('Player1-Updated');
    expect(row.totalDurationSeconds).toBe(600);
  });
});

describe('Ad-Hoc Events — multiple participants and cascade', () => {
  let adHocEventId: number;

  beforeEach(async () => {
    const event = await createAdHocEvent();
    adHocEventId = event.id;
  });

  it('should support multiple participants in the same event', async () => {
    const db = testApp.db;

    await db.insert(schema.adHocParticipants).values([
      {
        eventId: adHocEventId,
        discordUserId: '111',
        discordUsername: 'Player1',
        sessionCount: 1,
      },
      {
        eventId: adHocEventId,
        discordUserId: '222',
        discordUsername: 'Player2',
        sessionCount: 1,
      },
      {
        eventId: adHocEventId,
        discordUserId: '333',
        discordUsername: 'Player3',
        sessionCount: 1,
      },
    ]);

    const rows = await db
      .select()
      .from(schema.adHocParticipants)
      .where(eq(schema.adHocParticipants.eventId, adHocEventId));

    expect(rows.length).toBe(3);

    const active = await db
      .select()
      .from(schema.adHocParticipants)
      .where(
        and(
          eq(schema.adHocParticipants.eventId, adHocEventId),
          isNull(schema.adHocParticipants.leftAt),
        ),
      );

    expect(active.length).toBe(3);
  });

  it('should cascade delete participants when event is deleted', async () => {
    const db = testApp.db;

    await db.insert(schema.adHocParticipants).values({
      eventId: adHocEventId,
      discordUserId: '111',
      discordUsername: 'CascadeTest',
      sessionCount: 1,
    });

    await db.delete(schema.events).where(eq(schema.events.id, adHocEventId));

    const remaining = await db
      .select()
      .from(schema.adHocParticipants)
      .where(eq(schema.adHocParticipants.eventId, adHocEventId));

    expect(remaining.length).toBe(0);
  });
});

// ── Ad-hoc roster API endpoint ───────────────────────────────

describe('Ad-Hoc Events — GET roster: empty', () => {
  it('should return empty roster for event with no participants', async () => {
    const event = await createAdHocEvent('Empty Quick Play');
    const token = await ensureToken();

    const res = await testApp.request
      .get(`/events/${event.id}/ad-hoc-roster`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.eventId).toBe(event.id);
    expect(res.body.participants).toEqual([]);
    expect(res.body.activeCount).toBe(0);
  });
});

describe('Ad-Hoc Events — GET roster: with participants', () => {
  it('should return participants with correct fields', async () => {
    const db = testApp.db;
    const now = new Date();
    const event = await createAdHocEvent('Roster Test Session');
    const token = await ensureToken();

    await db.insert(schema.adHocParticipants).values([
      {
        eventId: event.id,
        userId: testApp.seed.adminUser.id,
        discordUserId: '111',
        discordUsername: 'ActivePlayer',
        discordAvatarHash: 'hash1',
        joinedAt: now,
        sessionCount: 1,
      },
      {
        eventId: event.id,
        userId: null,
        discordUserId: '222',
        discordUsername: 'LeftPlayer',
        discordAvatarHash: null,
        joinedAt: new Date(now.getTime() - 1800000),
        leftAt: now,
        totalDurationSeconds: 1800,
        sessionCount: 2,
      },
    ]);

    const res = await testApp.request
      .get(`/events/${event.id}/ad-hoc-roster`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.eventId).toBe(event.id);
    expect(res.body.participants.length).toBe(2);
    expect(res.body.activeCount).toBe(1);

    const participants = res.body.participants as Array<
      Record<string, unknown>
    >;
    const activeParticipant = participants.find(
      (p) => p.discordUserId === '111',
    );
    expect(activeParticipant).toMatchObject({
      eventId: event.id,
      userId: testApp.seed.adminUser.id,
      discordUserId: '111',
      discordUsername: 'ActivePlayer',
      discordAvatarHash: 'hash1',
      sessionCount: 1,
    });
    expect(activeParticipant?.leftAt).toBeNull();

    const leftParticipant = participants.find((p) => p.discordUserId === '222');
    expect(leftParticipant).toMatchObject({
      eventId: event.id,
      userId: null,
      discordUserId: '222',
      discordUsername: 'LeftPlayer',
      totalDurationSeconds: 1800,
      sessionCount: 2,
    });
    expect(leftParticipant!.leftAt).not.toBeNull();
  });
});

// ── Channel binding FK cascade to ad-hoc events ─────────────

describe('Ad-Hoc Events — FK cascade', () => {
  it('should set channelBindingId to null when binding is deleted', async () => {
    const db = testApp.db;
    const now = new Date();

    const [binding] = await db
      .insert(schema.channelBindings)
      .values({
        guildId: '111222333444',
        channelId: '999888777666',
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: null,
        config: {},
      })
      .returning();

    const [event] = await db
      .insert(schema.events)
      .values({
        title: 'Orphaned Ad-Hoc',
        creatorId: testApp.seed.adminUser.id,
        duration: [now, new Date(now.getTime() + 3600000)],
        isAdHoc: true,
        adHocStatus: 'ended',
        channelBindingId: binding.id,
      })
      .returning();

    await db
      .delete(schema.channelBindings)
      .where(eq(schema.channelBindings.id, binding.id));

    const [updated] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id))
      .limit(1);

    expect(updated).toBeDefined();
    expect(updated.channelBindingId).toBeNull();
    expect(updated.isAdHoc).toBe(true);
  });
});

// ── Event listing ad-hoc filter ──────────────────────────────

describe('Ad-Hoc Events — listing filter', () => {
  it('should include ad-hoc events in default event listing', async () => {
    const db = testApp.db;
    const now = new Date();
    const token = await ensureToken();

    const createRes = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Regular Event',
        startTime: '2026-06-01T18:00:00.000Z',
        endTime: '2026-06-01T20:00:00.000Z',
      });
    expect(createRes.status).toBe(201);

    await db.insert(schema.events).values({
      title: 'Quick Play',
      creatorId: testApp.seed.adminUser.id,
      duration: [now, new Date(now.getTime() + 3600000)],
      isAdHoc: true,
      adHocStatus: 'live',
    });

    const listRes = await testApp.request.get('/events');

    expect(listRes.status).toBe(200);
    const titles = (listRes.body.data as Array<{ title: string }>).map(
      (e) => e.title,
    );
    expect(titles).toContain('Regular Event');
    expect(titles).toContain('Quick Play');
  });

  it('should exclude ad-hoc events when includeAdHoc=false', async () => {
    const db = testApp.db;
    const now = new Date();
    const token = await ensureToken();

    const createRes = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Regular Event 2',
        startTime: '2026-06-01T18:00:00.000Z',
        endTime: '2026-06-01T20:00:00.000Z',
      });
    expect(createRes.status).toBe(201);

    await db.insert(schema.events).values({
      title: 'Hidden Ad-Hoc',
      creatorId: testApp.seed.adminUser.id,
      duration: [now, new Date(now.getTime() + 3600000)],
      isAdHoc: true,
      adHocStatus: 'live',
    });

    const listRes = await testApp.request.get('/events?includeAdHoc=false');

    expect(listRes.status).toBe(200);
    const titles = (listRes.body.data as Array<{ title: string }>).map(
      (e) => e.title,
    );
    expect(titles).toContain('Regular Event 2');
    expect(titles).not.toContain('Hidden Ad-Hoc');
  });
});

// ── ROK-1243: COMPLETED embed preserves every participant ────

describe('Ad-Hoc Events — COMPLETED embed historical record (ROK-1243)', () => {
  it('lists every participant struck through after finalize, even those missed mid-session', async () => {
    const db = testApp.db;
    const notificationService = testApp.app.get(AdHocNotificationService);
    const clientService = testApp.app.get(DiscordBotClientService);

    // Stub Discord I/O — we assert on the embed payload, not the network call.
    const sendSpy = jest
      .spyOn(clientService, 'sendEmbed')
      .mockResolvedValue({ id: 'spawn-msg-1243' } as never);
    const editSpy = jest
      .spyOn(clientService, 'editEmbed')
      .mockResolvedValue({ id: 'spawn-msg-1243' } as never);
    jest.spyOn(clientService, 'getGuildId').mockReturnValue('guild-1243');

    // Create a binding (so resolveNotificationChannel succeeds) + ad-hoc event.
    // `notificationChannelId` is a runtime config key used by the resolver
    // (`extractConfigChannel` in ad-hoc-notification.helpers.ts); the drizzle
    // schema's config type is narrower than runtime — cast to satisfy the
    // insert overload without changing column semantics.
    const [binding] = await db
      .insert(schema.channelBindings)
      .values({
        guildId: 'guild-1243',
        channelId: 'voice-1243',
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: testApp.seed.game.id,
        config: { notificationChannelId: 'text-1243' } as unknown as {
          minPlayers?: number;
          autoClose?: boolean;
          gracePeriod?: number;
        },
      })
      .returning();

    const now = new Date();
    const [event] = await db
      .insert(schema.events)
      .values({
        title: 'Quick Play — ROK-1243',
        creatorId: testApp.seed.adminUser.id,
        duration: [now, new Date(now.getTime() + 3600_000)],
        gameId: testApp.seed.game.id,
        isAdHoc: true,
        adHocStatus: 'live',
        channelBindingId: binding.id,
      })
      .returning();

    try {
      // Three participants ever joined; spawn embed posts with the first.
      await notificationService.notifySpawn(
        event.id,
        binding.id,
        { id: event.id, title: event.title },
        [{ discordUserId: 'disc-A', discordUsername: 'Aery' }],
      );
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Persist all three rows directly, with leftAt set on A and B so the
      // final embed mirrors a real session where two members departed and
      // the third was the last to leave (set leftAt for C too: finalize sets it).
      const leftA = new Date(now.getTime() + 5 * 60_000);
      const leftB = new Date(now.getTime() + 10 * 60_000);
      const leftC = new Date(now.getTime() + 30 * 60_000);
      await db.insert(schema.adHocParticipants).values([
        {
          eventId: event.id,
          discordUserId: 'disc-A',
          discordUsername: 'Aery',
          joinedAt: now,
          leftAt: leftA,
          totalDurationSeconds: 300,
          sessionCount: 1,
        },
        {
          eventId: event.id,
          discordUserId: 'disc-B',
          discordUsername: 'Belle',
          joinedAt: now,
          leftAt: leftB,
          totalDurationSeconds: 600,
          sessionCount: 1,
        },
        {
          eventId: event.id,
          discordUserId: 'disc-C',
          discordUsername: 'Cassie',
          joinedAt: now,
          leftAt: leftC,
          totalDurationSeconds: 1800,
          sessionCount: 1,
        },
      ]);

      editSpy.mockClear();

      // Call notifyCompleted — the reconciliation read should pick up all 3
      // even though we pass only ONE in the caller's participants array (the
      // pre-bug behavior would have lost B and C).
      await notificationService.notifyCompleted(
        event.id,
        binding.id,
        {
          id: event.id,
          title: event.title,
          startTime: now.toISOString(),
          endTime: new Date(now.getTime() + 3600_000).toISOString(),
        },
        [
          {
            discordUserId: 'disc-A',
            discordUsername: 'Aery',
            totalDurationSeconds: 300,
          },
        ],
      );

      expect(editSpy).toHaveBeenCalledTimes(1);
      const editArgs = editSpy.mock.calls[0];
      // editEmbed(channelId, messageId, embed, row?, content?)
      const embed = editArgs[2] as { data?: { description?: string } };
      const description = embed.data?.description ?? '';
      // ROSTER header reflects cumulative participation.
      expect(description).toMatch(/ROSTER:\s*3\s+signed up/);
      // Quick-play rosters render stored usernames (not <@id> mentions) so
      // ex-guild participants don't leak raw IDs (ROK). All three struck through.
      expect(description).toContain('~~Aery~~');
      expect(description).toContain('~~Belle~~');
      expect(description).toContain('~~Cassie~~');
      // No raw mention token should leak for any participant (regression guard).
      expect(description).not.toContain('<@disc-');
    } finally {
      sendSpy.mockRestore();
      editSpy.mockRestore();
    }
  });
});
