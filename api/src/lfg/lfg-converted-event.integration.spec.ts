/**
 * ROK-1573 Lane B — `GET /lfg/:gameId` reports the group's upcoming converted
 * event as `convertedEvent`, end to end through the real controller + DB.
 *
 * Scenarios S-B1…S-B4 from `planning-artifacts/specs/ROK-1573-1572.md`, plus
 * the "soonest first" ordering the read promises.
 *
 * Split into its own file: `lfg.integration.spec.ts` is already at its cap.
 * Each `it` carries a MUTATION note naming the change that makes it fail.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import {
  createGame,
  createQuickPlayEvent,
  type LfgGroupDetailDto,
} from './lfg.integration.spec-helpers';

const HOUR_MS = 60 * 60 * 1000;

/** The detail as this story extends it (the shared helper predates both). */
interface ConvertedDetail extends LfgGroupDetailDto {
  convertedEvent: {
    eventId: number;
    title: string;
    startTime: string;
    signupCount: number;
  } | null;
  playingNow: { eventId: number } | null;
}

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ─── request wrappers + fixtures ─────────────────────────────────────────────

function postIntent(token: string, gameId: number) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

function convertToEvent(token: string, gameId: number, eventId: number) {
  return testApp.request
    .post(`/lfg/${gameId}/convert`)
    .set('Authorization', `Bearer ${token}`)
    .send({ eventId });
}

async function readGroup(token: string, gameId: number) {
  const res = await testApp.request
    .get(`/lfg/${gameId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body as ConvertedDetail;
}

/** Two members, each holding a live intent on a fresh game. */
async function groupOfTwo(gameName: string) {
  const a = await createMemberAndLogin(testApp, 'alpha', 'alpha@test.local');
  const b = await createMemberAndLogin(testApp, 'bravo', 'bravo@test.local');
  const game = await createGame(testApp, gameName);
  await postIntent(a.token, game.id).expect(201);
  await postIntent(b.token, game.id).expect(201);
  return { a, b, game };
}

/** A scheduled (non-ad-hoc) event starting `startsInHours` from now, 2h long. */
async function scheduledEvent(
  gameId: number,
  title: string,
  startsInHours: number,
): Promise<typeof schema.events.$inferSelect> {
  const start = new Date(Date.now() + startsInHours * HOUR_MS);
  start.setMilliseconds(0);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      creatorId: testApp.seed.adminUser.id,
      gameId,
      isAdHoc: false,
      duration: [start, new Date(start.getTime() + 2 * HOUR_MS)],
    })
    .returning();
  return event;
}

async function signUp(eventId: number, ...userIds: number[]): Promise<void> {
  await testApp.db
    .insert(schema.eventSignups)
    .values(userIds.map((userId) => ({ eventId, userId })));
}

/** Point every intent on the game at `eventId`, as a conversion writes it. */
async function linkIntents(gameId: number, eventId: number): Promise<void> {
  await testApp.db
    .update(schema.lfgIntents)
    .set({ status: 'converted', convertedToEventId: eventId })
    .where(eq(schema.lfgIntents.gameId, gameId));
}

/** S-B1 setup: a group converted (via the real endpoint) into a future event. */
async function convertedGroup(gameName: string) {
  const { a, b, game } = await groupOfTwo(gameName);
  const event = await scheduledEvent(game.id, 'Raid night', 24);
  await convertToEvent(a.token, game.id, event.id).expect(201);
  await signUp(event.id, a.userId, b.userId);
  return { a, b, game, event };
}

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('GET /lfg/:gameId — convertedEvent (ROK-1573)', () => {
  // MUTATION: drop `readConvertedEvent(this.db, gameId)` from
  // `LfgService.getGroupDetail` — fails on toEqual receiving undefined.
  it('S-B1: reports the future event the group converted into', async () => {
    const { a, event } = await convertedGroup('Valheim');
    const group = await readGroup(a.token, event.gameId as number);
    expect(group.convertedEvent).toEqual({
      eventId: event.id,
      title: 'Raid night',
      startTime: event.duration[0].toISOString(),
      signupCount: 2,
    });
  });

  // MUTATION: flip the order to `lower(duration) DESC` — fails on eventId.
  it('reports the soonest of two upcoming converted events', async () => {
    const { a, game } = await groupOfTwo('Helldivers 2');
    const later = await scheduledEvent(game.id, 'Later', 48);
    const sooner = await scheduledEvent(game.id, 'Sooner', 3);
    await linkIntents(game.id, later.id);
    const c = await createMemberAndLogin(testApp, 'charlie', 'c@test.local');
    await postIntent(c.token, game.id).expect(201);
    await convertToEvent(c.token, game.id, sooner.id).expect(201);
    const group = await readGroup(a.token, game.id);
    expect(group.convertedEvent?.eventId).toBe(sooner.id);
    expect(group.convertedEvent?.signupCount).toBe(0);
  });
});

describe('GET /lfg/:gameId — convertedEvent exclusions (ROK-1573)', () => {
  // MUTATION: drop `isNull(events.cancelledAt)` from `convertedEventWhere`.
  it('S-B2: is null once that event is cancelled', async () => {
    const { a, event } = await convertedGroup('Terraria');
    await testApp.db
      .update(schema.events)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.events.id, event.id));
    const group = await readGroup(a.token, event.gameId as number);
    expect(group.convertedEvent).toBeNull();
  });

  // MUTATION: drop the `upper(duration) > now` clause from `convertedEventWhere`.
  it('S-B2: is null once that event has ended', async () => {
    const { a, event } = await convertedGroup('Satisfactory');
    const start = new Date(Date.now() - 5 * HOUR_MS);
    await testApp.db
      .update(schema.events)
      .set({ duration: [start, new Date(start.getTime() + 2 * HOUR_MS)] })
      .where(eq(schema.events.id, event.id));
    const group = await readGroup(a.token, event.gameId as number);
    expect(group.convertedEvent).toBeNull();
  });

  // MUTATION: drop `eq(events.isAdHoc, false)` from `convertedEventWhere` —
  // the live session then leaks in as a converted event too.
  it('S-B3: an ad hoc LFG-now session sets playingNow, never convertedEvent', async () => {
    const { a, game } = await groupOfTwo('Deep Rock Galactic');
    const eventId = await createQuickPlayEvent(
      testApp,
      a.userId,
      game.id,
      new Date(Date.now() - 10 * 60 * 1000),
    );
    await linkIntents(game.id, eventId);
    const group = await readGroup(a.token, game.id);
    expect(group.playingNow?.eventId).toBe(eventId);
    expect(group.convertedEvent).toBeNull();
  });

  // MUTATION: drop the `EXISTS (… lfg_intents …)` clause from
  // `convertedEventWhere` — any scheduled event for the game then leaks in.
  it('S-B4: a future event no intent points at is not reported', async () => {
    const { a, game } = await groupOfTwo('Lethal Company');
    await scheduledEvent(game.id, 'Unrelated raid', 24);
    const group = await readGroup(a.token, game.id);
    expect(group.convertedEvent).toBeNull();
  });
});
