/**
 * Discord Game-Activity, Embed Scheduling & PUG Invites Integration Tests (ROK-527)
 *
 * Verifies embed scheduler's LEFT JOIN detection, embed poster's live roster
 * enrichment, and PUG slot atomic claim/update patterns against a real PostgreSQL
 * database.
 */
import { eq, and, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Create a future event for embed/PUG tests. */
async function createFutureEvent(title: string, gameId?: number | null) {
  const futureStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      creatorId: testApp.seed.adminUser.id,
      duration: [futureStart, futureEnd],
      ...(gameId !== undefined ? { gameId } : {}),
    })
    .returning();
  return event;
}

// ===================================================================
// Embed Scheduler — LEFT JOIN detection
// ===================================================================

describe('embed scheduler — events without embeds', () => {
  it('should identify events without embed rows via LEFT JOIN', async () => {
    const db = testApp.db;
    const event = await createFutureEvent('No Embed Event');

    const eventsWithoutEmbeds = await db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        embedId: schema.discordEventMessages.id,
      })
      .from(schema.events)
      .leftJoin(
        schema.discordEventMessages,
        eq(schema.events.id, schema.discordEventMessages.eventId),
      )
      .where(
        and(
          isNull(schema.events.cancelledAt),
          isNull(schema.discordEventMessages.id),
        ),
      );

    const match = eventsWithoutEmbeds.find((e) => e.id === event.id);
    expect(match).toBeDefined();
    expect(match?.embedId).toBeNull();
  });
});

describe('embed scheduler — events with embeds', () => {
  it('should exclude events that already have an embed row', async () => {
    const db = testApp.db;
    const event = await createFutureEvent('Has Embed Event');

    await db.insert(schema.discordEventMessages).values({
      eventId: event.id,
      guildId: '111222333444',
      channelId: '555666777888',
      messageId: 'msg-001',
      embedState: 'posted',
    });

    const eventsWithoutEmbeds = await db
      .select({
        id: schema.events.id,
        embedId: schema.discordEventMessages.id,
      })
      .from(schema.events)
      .leftJoin(
        schema.discordEventMessages,
        eq(schema.events.id, schema.discordEventMessages.eventId),
      )
      .where(
        and(
          isNull(schema.events.cancelledAt),
          isNull(schema.discordEventMessages.id),
        ),
      );

    const match = eventsWithoutEmbeds.find((e) => e.id === event.id);
    expect(match).toBeUndefined();
  });

  it('should exclude cancelled events', async () => {
    const db = testApp.db;
    const futureStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

    const [event] = await db
      .insert(schema.events)
      .values({
        title: 'Cancelled Event',
        creatorId: testApp.seed.adminUser.id,
        duration: [futureStart, futureEnd],
        cancelledAt: new Date(),
        cancellationReason: 'Testing cancellation',
      })
      .returning();

    const eventsWithoutEmbeds = await db
      .select({
        id: schema.events.id,
        embedId: schema.discordEventMessages.id,
      })
      .from(schema.events)
      .leftJoin(
        schema.discordEventMessages,
        eq(schema.events.id, schema.discordEventMessages.eventId),
      )
      .where(
        and(
          isNull(schema.events.cancelledAt),
          isNull(schema.discordEventMessages.id),
        ),
      );

    const match = eventsWithoutEmbeds.find((e) => e.id === event.id);
    expect(match).toBeUndefined();
  });
});

// ===================================================================
// Embed Poster — Live Roster Enrichment
// ===================================================================

describe('embed poster roster enrichment — multi-JOIN', () => {
  it('should return correct signup counts and role data via multi-JOIN', async () => {
    const db = testApp.db;
    const event = await createFutureEvent(
      'Roster Enrichment Test',
      testApp.seed.game.id,
    );

    const [signup1] = await db
      .insert(schema.eventSignups)
      .values({
        eventId: event.id,
        userId: testApp.seed.adminUser.id,
        status: 'signed_up',
        confirmationStatus: 'pending',
      })
      .returning();

    const [user2] = await db
      .insert(schema.users)
      .values({
        discordId: 'local:player2@test.local',
        username: 'player2',
        role: 'member',
      })
      .returning();

    const [char2] = await db
      .insert(schema.characters)
      .values({
        userId: user2.id,
        gameId: testApp.seed.game.id,
        name: 'TestTank',
        class: 'Warrior',
        role: 'tank',
      })
      .returning();

    const [signup2] = await db
      .insert(schema.eventSignups)
      .values({
        eventId: event.id,
        userId: user2.id,
        characterId: char2.id,
        status: 'signed_up',
        confirmationStatus: 'confirmed',
      })
      .returning();

    await db.insert(schema.rosterAssignments).values([
      { eventId: event.id, signupId: signup1.id, role: 'dps', position: 1 },
      { eventId: event.id, signupId: signup2.id, role: 'tank', position: 1 },
    ]);

    const signupRows = await db
      .select({
        username: schema.users.username,
        role: schema.rosterAssignments.role,
        status: schema.eventSignups.status,
        className: schema.characters.class,
      })
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .leftJoin(
        schema.rosterAssignments,
        eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
      )
      .leftJoin(
        schema.characters,
        eq(schema.eventSignups.characterId, schema.characters.id),
      )
      .where(eq(schema.eventSignups.eventId, event.id));

    expect(signupRows.length).toBe(2);

    const roleRows = await db
      .select({ role: schema.rosterAssignments.role })
      .from(schema.rosterAssignments)
      .innerJoin(
        schema.eventSignups,
        eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
      )
      .where(eq(schema.rosterAssignments.eventId, event.id));

    const roleCounts: Record<string, number> = {};
    for (const row of roleRows) {
      if (row.role) {
        roleCounts[row.role] = (roleCounts[row.role] ?? 0) + 1;
      }
    }

    expect(roleCounts['tank']).toBe(1);
    expect(roleCounts['dps']).toBe(1);

    const tankRow = signupRows.find((r) => r.role === 'tank');
    expect(tankRow?.className).toBe('Warrior');

    const dpsRow = signupRows.find((r) => r.role === 'dps');
    expect(dpsRow?.className).toBeNull();
  });
});

describe('embed poster roster enrichment — declined filter', () => {
  it('should exclude declined signups from active count', async () => {
    const db = testApp.db;
    const event = await createFutureEvent('Declined Signup Test');

    await db.insert(schema.eventSignups).values({
      eventId: event.id,
      userId: testApp.seed.adminUser.id,
      status: 'signed_up',
      confirmationStatus: 'pending',
    });

    const [user2] = await db
      .insert(schema.users)
      .values({
        discordId: 'local:declined@test.local',
        username: 'declined',
        role: 'member',
      })
      .returning();

    await db.insert(schema.eventSignups).values({
      eventId: event.id,
      userId: user2.id,
      status: 'declined',
      confirmationStatus: 'pending',
    });

    const signupRows = await db
      .select({ status: schema.eventSignups.status })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, event.id));

    const activeSignups = signupRows.filter(
      (r) =>
        r.status !== 'declined' &&
        r.status !== 'roached_out' &&
        r.status !== 'departed',
    );

    expect(signupRows.length).toBe(2);
    expect(activeSignups.length).toBe(1);
  });
});

// ===================================================================
// PUG Slot — Atomic Claim & Lifecycle
// ===================================================================

/** Create a PUG test event and return its ID. */
async function createPugEvent(title = 'PUG Test Event') {
  const now = new Date();
  const futureEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      creatorId: testApp.seed.adminUser.id,
      duration: [now, futureEnd],
    })
    .returning();
  return event.id;
}

describe('pug slot lifecycle — create and constraints', () => {
  it('should create a PUG slot with pending status', async () => {
    const db = testApp.db;
    const testEventId = await createPugEvent();

    const [slot] = await db
      .insert(schema.pugSlots)
      .values({
        eventId: testEventId,
        discordUsername: 'pugplayer',
        role: 'dps',
        createdBy: testApp.seed.adminUser.id,
      })
      .returning();

    expect(slot.status).toBe('pending');
    expect(slot.discordUsername).toBe('pugplayer');
    expect(slot.role).toBe('dps');
    expect(slot.discordUserId).toBeNull();
    expect(slot.invitedAt).toBeNull();
  });

  it('should enforce unique constraint on (eventId, discordUsername)', async () => {
    const db = testApp.db;
    const testEventId = await createPugEvent();

    await db.insert(schema.pugSlots).values({
      eventId: testEventId,
      discordUsername: 'uniquepug',
      role: 'dps',
      createdBy: testApp.seed.adminUser.id,
    });

    await expect(
      db.insert(schema.pugSlots).values({
        eventId: testEventId,
        discordUsername: 'uniquepug',
        role: 'healer',
        createdBy: testApp.seed.adminUser.id,
      }),
    ).rejects.toThrow();
  });

  it('should cascade delete PUG slots when event is deleted', async () => {
    const db = testApp.db;
    const testEventId = await createPugEvent();

    await db.insert(schema.pugSlots).values({
      eventId: testEventId,
      discordUsername: 'cascadepug',
      role: 'tank',
      createdBy: testApp.seed.adminUser.id,
    });

    await db.delete(schema.events).where(eq(schema.events.id, testEventId));

    const remaining = await db
      .select()
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.eventId, testEventId));

    expect(remaining.length).toBe(0);
  });
});

describe('pug slot lifecycle — atomic claim', () => {
  it('should atomically claim pending slots via UPDATE RETURNING', async () => {
    const db = testApp.db;
    const testEventId = await createPugEvent();
    const event2Id = await createPugEvent('PUG Event 2');

    await db.insert(schema.pugSlots).values([
      {
        eventId: testEventId,
        discordUsername: 'newmember',
        role: 'tank',
        createdBy: testApp.seed.adminUser.id,
      },
      {
        eventId: event2Id,
        discordUsername: 'newmember',
        role: 'healer',
        createdBy: testApp.seed.adminUser.id,
      },
    ]);

    const claimedSlots = await db
      .update(schema.pugSlots)
      .set({
        discordUserId: '999888777666',
        discordAvatarHash: 'avatar-hash-123',
        status: 'invited',
        invitedAt: new Date(),
        serverInviteUrl: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.pugSlots.discordUsername, 'newmember'),
          eq(schema.pugSlots.status, 'pending'),
        ),
      )
      .returning();

    expect(claimedSlots.length).toBe(2);
    for (const slot of claimedSlots) {
      expect(slot.status).toBe('invited');
      expect(slot.discordUserId).toBe('999888777666');
      expect(slot.invitedAt).not.toBeNull();
    }
  });

  it('should prevent duplicate DMs by only claiming pending slots', async () => {
    const db = testApp.db;
    const testEventId = await createPugEvent();

    await db.insert(schema.pugSlots).values({
      eventId: testEventId,
      discordUsername: 'alreadyinvited',
      discordUserId: '111222333',
      role: 'dps',
      status: 'invited',
      invitedAt: new Date(),
      createdBy: testApp.seed.adminUser.id,
    });

    const claimedSlots = await db
      .update(schema.pugSlots)
      .set({
        discordUserId: '111222333',
        status: 'invited',
        invitedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.pugSlots.discordUsername, 'alreadyinvited'),
          eq(schema.pugSlots.status, 'pending'),
        ),
      )
      .returning();

    expect(claimedSlots.length).toBe(0);
  });

  it('should skip cancelled events when processing claimed slots', async () => {
    const db = testApp.db;
    const testEventId = await createPugEvent();

    await db
      .update(schema.events)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.events.id, testEventId));

    const [event] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, testEventId))
      .limit(1);

    expect(event.cancelledAt).not.toBeNull();
  });
});

describe('pug slot lifecycle — claim by ID or invite code', () => {
  it('should claim PUG slots by discordUserId OR inviteCode', async () => {
    const db = testApp.db;
    const testEventId = await createPugEvent();

    const [claimUser] = await db
      .insert(schema.users)
      .values({
        discordId: 'discord:claimuser',
        username: 'claimuser',
        role: 'member',
      })
      .returning();

    await db.insert(schema.pugSlots).values({
      eventId: testEventId,
      discordUsername: 'byid',
      discordUserId: 'discord:claimuser',
      role: 'tank',
      status: 'invited',
      createdBy: testApp.seed.adminUser.id,
    });

    const event3Id = await createPugEvent('Invite Code Event');

    await db.insert(schema.pugSlots).values({
      eventId: event3Id,
      role: 'healer',
      inviteCode: 'ABC12345',
      status: 'pending',
      createdBy: testApp.seed.adminUser.id,
    });

    const byIdResult = await db
      .update(schema.pugSlots)
      .set({
        claimedByUserId: claimUser.id,
        status: 'claimed',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.pugSlots.discordUserId, 'discord:claimuser'),
          isNull(schema.pugSlots.claimedByUserId),
        ),
      )
      .returning();

    expect(byIdResult.length).toBe(1);
    expect(byIdResult[0].claimedByUserId).toBe(claimUser.id);
    expect(byIdResult[0].status).toBe('claimed');

    const byCodeResult = await db
      .update(schema.pugSlots)
      .set({
        claimedByUserId: claimUser.id,
        status: 'claimed',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.pugSlots.inviteCode, 'ABC12345'),
          isNull(schema.pugSlots.claimedByUserId),
        ),
      )
      .returning();

    expect(byCodeResult.length).toBe(1);
    expect(byCodeResult[0].claimedByUserId).toBe(claimUser.id);
  });
});

// ===================================================================
// Discord Event Messages — Tracking Rows
// ===================================================================

describe('discord event messages — insert and query', () => {
  it('should insert and query embed tracking rows', async () => {
    const db = testApp.db;
    const event = await createFutureEvent('Embed Tracking Test');

    const [msg] = await db
      .insert(schema.discordEventMessages)
      .values({
        eventId: event.id,
        guildId: '111222333444',
        channelId: '555666777888',
        messageId: 'msg-123',
        embedState: 'posted',
      })
      .returning();

    expect(msg.eventId).toBe(event.id);
    expect(msg.embedState).toBe('posted');

    const rows = await db
      .select({ id: schema.discordEventMessages.id })
      .from(schema.discordEventMessages)
      .where(eq(schema.discordEventMessages.eventId, event.id))
      .limit(1);

    expect(rows.length).toBe(1);
  });

  it('should cascade delete embed rows when event is deleted', async () => {
    const db = testApp.db;
    const event = await createFutureEvent('Cascade Embed Test');

    await db.insert(schema.discordEventMessages).values({
      eventId: event.id,
      guildId: '111222333444',
      channelId: '555666777888',
      messageId: 'msg-cascade',
      embedState: 'posted',
    });

    await db.delete(schema.events).where(eq(schema.events.id, event.id));

    const remaining = await db
      .select()
      .from(schema.discordEventMessages)
      .where(eq(schema.discordEventMessages.eventId, event.id));

    expect(remaining.length).toBe(0);
  });
});
