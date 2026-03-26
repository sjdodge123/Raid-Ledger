/**
 * Shared test helpers for signups integration spec files.
 */
import { type TestApp } from '../common/testing/test-app';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/** Helper to create a member user with local credentials and return their token. */
export async function createMemberAndLogin(
  testApp: TestApp,
  username: string,
  email: string,
): Promise<{ userId: number; token: string }> {
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId: `local:${email}`, username, role: 'member' })
    .returning();
  await testApp.db
    .insert(schema.localCredentials)
    .values({ email, passwordHash, userId: user.id });
  const loginRes = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  if (loginRes.status !== 200) {
    throw new Error(
      `createMemberAndLogin login failed for ${email}: ${loginRes.status} — ${JSON.stringify(loginRes.body)}`,
    );
  }
  return { userId: user.id, token: loginRes.body.access_token as string };
}

/** Helper to create a future event and return its ID. */
export async function createFutureEvent(
  testApp: TestApp,
  adminToken: string,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const res = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Integration Test Event',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      ...overrides,
    });
  if (res.status !== 201) {
    throw new Error(
      `createFutureEvent failed: ${res.status} — ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.id as number;
}

/** Helper to create a past event via direct DB insert. */
export async function createPastEvent(
  testApp: TestApp,
  creatorId: number,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
): Promise<number> {
  const start = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Past Integration Test Event',
      creatorId,
      duration: [start, end] as [Date, Date],
      ...overrides,
    })
    .returning();
  return event.id;
}

/** Standard MMO slot config for allocation tests. */
export const MMO_SLOT_CONFIG = {
  type: 'mmo',
  tank: 1,
  healer: 1,
  dps: 3,
};

/** Helper to create an MMO event with a given slot config. */
export async function createMmoEvent(
  testApp: TestApp,
  adminToken: string,
  slotConfig: Record<string, unknown> = MMO_SLOT_CONFIG,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  return createFutureEvent(testApp, adminToken, {
    slotConfig,
    ...overrides,
  });
}

/**
 * Sign up a user via direct DB insert, bypassing HTTP validation.
 * Use for past events where the signup guard would reject HTTP signups (ROK-970).
 */
export async function signupViaDb(
  testApp: TestApp,
  eventId: number,
  userId: number,
): Promise<typeof schema.eventSignups.$inferSelect> {
  const [signup] = await testApp.db
    .insert(schema.eventSignups)
    .values({
      eventId,
      userId,
      status: 'signed_up',
      confirmationStatus: 'pending',
    })
    .returning();
  return signup;
}

/**
 * Helper to sign up a user with preferred roles via HTTP.
 * Throws on non-201 responses to fail fast when used as a precondition.
 */
export async function signupWithPrefs(
  testApp: TestApp,
  token: string,
  eventId: number,
  preferredRoles: string[],
): Promise<{ id: number; status: number; body: Record<string, unknown> }> {
  const res = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({ preferredRoles });
  if (res.status !== 201) {
    throw new Error(
      `signupWithPrefs failed: expected 201 but got ${res.status} — ${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.id as number, status: res.status, body: res.body };
}

/** Get all roster assignments for an event from the DB. */
export async function getAllRosterAssignments(
  testApp: TestApp,
  eventId: number,
): Promise<Array<typeof schema.rosterAssignments.$inferSelect>> {
  return testApp.db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId));
}

/** Get the roster assignment for a specific signup. */
export async function getSignupAssignment(
  testApp: TestApp,
  signupId: number,
): Promise<typeof schema.rosterAssignments.$inferSelect | undefined> {
  const [row] = await testApp.db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId))
    .limit(1);
  return row;
}

/** Create an MMO game with hasRoles=true. */
export async function createMmoGame(
  testApp: TestApp,
  name = 'WoW Test',
  slug = 'wow-test',
): Promise<typeof schema.games.$inferSelect> {
  const [game] = await testApp.db
    .insert(schema.games)
    .values({ name, slug, hasRoles: true, hasSpecs: true })
    .returning();
  return game;
}

/** Create a character for a user and mark it as main. */
export async function createMainCharacter(
  testApp: TestApp,
  userId: number,
  gameId: number,
  charClass: string,
): Promise<typeof schema.characters.$inferSelect> {
  const [char] = await testApp.db
    .insert(schema.characters)
    .values({
      userId,
      gameId,
      name: `Main-${charClass}`,
      class: charClass,
      role: charClass.toLowerCase(),
      isMain: true,
    })
    .returning();
  return char;
}
