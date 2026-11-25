/**
 * ROK-2320 — a post-event follow-up poll's lock-in carries each voter's (and
 * the creator's) character + roles from the ended SOURCE event.
 *
 * Before the fix every voter was signed up with no dto, so on an MMO roster
 * they landed with no character, no preferred roles and no slot. The source
 * event is linked through `post_event_followup_sent.match_id`.
 *
 * Roster: tank 1 / healer 1 / dps 3 / flex 0. Source-event signups:
 *   creator  signed_up  dps    → dps
 *   A        signed_up  tank   → tank
 *   B        tentative  healer → healer (any status carries)
 *   C        declined   dps    → dps    (any status carries)
 *   D        none              → blank signup (today's behaviour)
 *   E        signed_up  tank   → bench  (tank already full, normal allocator)
 *
 * A character of another game than the new event's is not carried; its
 * voter keeps the roles only.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { nonEmpty } from '../../common/testing/narrow';
import { LineupNotificationService } from '../lineup-notification.service';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(() => {
  // EVENT CREATED's Discord announce is not under test; keep it in-process.
  jest
    .spyOn(testApp.app.get(LineupNotificationService), 'notifyEventCreated')
    .mockResolvedValue(undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

const HOUR = 60 * 60 * 1000;
const SLOT = new Date('2099-11-12T20:00:00.000Z');
const SLOT_END = new Date('2099-11-12T22:00:00.000Z');
const VOTE_BASE_MS = Date.parse('2026-10-01T12:00:00.000Z');
const MMO = { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 };
const NEW_EVENT_TITLE = 'Follow-up carryover lock';

type Role = 'tank' | 'healer' | 'dps';
type Prior = { status: string; role: Role } | null;

interface Voter {
  userId: number;
  characterId: string | null;
}

async function createMember(tag: string): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@test.local`,
        username: tag,
        role: 'member',
      })
      .returning(),
    tag,
  );
  return user.id;
}

async function createCharacter(userId: number, role: Role): Promise<string> {
  const [character] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId: testApp.seed.game.id,
        name: `Char${userId}`,
        role,
      })
      .returning(),
    'character',
  );
  return character.id;
}

async function createSourceEvent(): Promise<number> {
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Ended raid',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        slotConfig: MMO,
        duration: [
          new Date(Date.now() - 3 * HOUR),
          new Date(Date.now() - HOUR),
        ],
      })
      .returning(),
    'source event',
  );
  return event.id;
}

/** A source signup with a character in `prior.role`; null = no signup. */
async function seedPrior(
  eventId: number,
  userId: number,
  prior: Prior,
): Promise<Voter> {
  if (!prior) return { userId, characterId: null };
  const characterId = await createCharacter(userId, prior.role);
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    characterId,
    status: prior.status,
    confirmationStatus: 'confirmed',
    preferredRoles: [prior.role],
  });
  return { userId, characterId };
}

async function openStandalonePoll(): Promise<number> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id });
  expect(res.status).toBe(201);
  return res.body.id;
}

/** Yes votes at SLOT, in the given vote order. */
async function seedVotes(matchId: number, userIds: number[]): Promise<void> {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({ matchId, proposedTime: SLOT, suggestedBy: 'user' })
      .returning(),
    'slot',
  );
  for (const [i, userId] of userIds.entries()) {
    await testApp.db.insert(schema.communityLineupScheduleVotes).values({
      userId,
      slotId: slot.id,
      stance: 'yes',
      createdAt: new Date(VOTE_BASE_MS + i * 1000),
    });
  }
}

const PRIORS: Record<string, Prior> = {
  creator: { status: 'signed_up', role: 'dps' },
  a: { status: 'signed_up', role: 'tank' },
  b: { status: 'tentative', role: 'healer' },
  c: { status: 'declined', role: 'dps' },
  d: null,
  e: { status: 'signed_up', role: 'tank' },
};

/** Seed source event + poll + votes; `followup` links the poll to the event. */
async function seedPoll(followup: boolean) {
  const sourceEventId = await createSourceEvent();
  const voters: Record<string, Voter> = {};
  for (const [key, prior] of Object.entries(PRIORS)) {
    const userId =
      key === 'creator'
        ? testApp.seed.adminUser.id
        : await createMember(`carry-${key}`);
    voters[key] = await seedPrior(sourceEventId, userId, prior);
  }
  const matchId = await openStandalonePoll();
  if (followup) {
    await testApp.db
      .insert(schema.postEventFollowupSent)
      .values({ eventId: sourceEventId, matchId });
  }
  await seedVotes(
    matchId,
    Object.values(voters).map((v) => v.userId),
  );
  return { matchId, voters };
}

async function lockIn(matchId: number): Promise<number> {
  const res = await testApp.request
    .post(`/scheduling-polls/${matchId}/lock-in`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      event: {
        title: NEW_EVENT_TITLE,
        startTime: SLOT.toISOString(),
        endTime: SLOT_END.toISOString(),
        gameId: testApp.seed.game.id,
        slotConfig: MMO,
      },
      startTime: SLOT.toISOString(),
    });
  // The controller pins `@HttpCode(HttpStatus.OK)` on POST :matchId/lock-in.
  expect(res.status).toBe(200);
  const [event] = nonEmpty(
    await testApp.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.title, NEW_EVENT_TITLE)),
    'locked-in event',
  );
  return event.id;
}

interface NewSignup {
  characterId: string | null;
  preferredRoles: string[] | null;
  role: string | null;
}

/** The new event's signups by user id, with their roster role. */
async function newSignups(eventId: number): Promise<Map<number, NewSignup>> {
  const rows = await testApp.db
    .select({
      userId: schema.eventSignups.userId,
      characterId: schema.eventSignups.characterId,
      preferredRoles: schema.eventSignups.preferredRoles,
      role: schema.rosterAssignments.role,
    })
    .from(schema.eventSignups)
    .leftJoin(
      schema.rosterAssignments,
      eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
    )
    .where(eq(schema.eventSignups.eventId, eventId));
  const byUser = new Map<number, NewSignup>();
  for (const { userId, ...rest } of rows) {
    if (userId !== null) byUser.set(userId, rest);
  }
  return byUser;
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

describe('follow-up poll lock-in carries source-event character + roles (ROK-2320)', () => {
  it('carries every prior signup, whatever its status, onto the roster', async () => {
    const { matchId, voters } = await seedPoll(true);
    const signups = await newSignups(await lockIn(matchId));

    for (const [key, role] of [
      ['creator', 'dps'],
      ['a', 'tank'],
      ['b', 'healer'],
      ['c', 'dps'],
    ] as const) {
      const voter = must(voters[key], key);
      const signup = must(signups.get(voter.userId), `${key} signup`);
      expect({ key, ...signup }).toEqual({
        key,
        characterId: voter.characterId,
        preferredRoles: [role],
        role,
      });
    }
  });

  it('benches a voter whose only role is full; a new voter stays blank', async () => {
    const { matchId, voters } = await seedPoll(true);
    const signups = await newSignups(await lockIn(matchId));

    const e = must(voters.e, 'e');
    expect(signups.get(e.userId)).toEqual({
      characterId: e.characterId,
      preferredRoles: ['tank'],
      role: 'bench',
    });
    const d = must(signups.get(must(voters.d, 'd').userId), 'd signup');
    expect(d.characterId).toBeNull();
    expect(d.preferredRoles).toBeNull();
    // 5th signup with 4 of 5 slotted: not at capacity, so no roster row.
    expect(d.role).toBeNull();
  });

  it('leaves an ordinary (non-follow-up) poll’s signups blank', async () => {
    const { matchId, voters } = await seedPoll(false);
    const signups = await newSignups(await lockIn(matchId));

    for (const key of ['a', 'b'] as const) {
      const voter = must(voters[key], key);
      const signup = must(signups.get(voter.userId), `${key} signup`);
      expect({ key, characterId: signup.characterId }).toEqual({
        key,
        characterId: null,
      });
      expect(signup.preferredRoles).toBeNull();
    }
  });
});

describe('follow-up carryover is limited to the new event’s game (ROK-2320)', () => {
  it('carries roles but not a character of another game', async () => {
    const { matchId, voters } = await seedPoll(true);
    const a = must(voters.a, 'a');
    const [other] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: 'Other game', slug: `other-game-${Date.now()}` })
        .returning(),
      'other game',
    );
    await testApp.db
      .update(schema.characters)
      .set({ gameId: other.id })
      .where(
        eq(schema.characters.id, must(a.characterId ?? undefined, 'a char')),
      );
    const signups = await newSignups(await lockIn(matchId));

    expect(signups.get(a.userId)).toEqual({
      characterId: null,
      preferredRoles: ['tank'],
      role: 'tank',
    });
  });
});
