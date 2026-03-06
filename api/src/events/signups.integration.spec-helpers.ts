/**
 * Shared test helpers for signups integration spec files.
 */
import { type TestApp } from '../common/testing/test-app';
import * as bcrypt from 'bcrypt';
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
  await testApp.db.insert(schema.localCredentials).values({ email, passwordHash, userId: user.id });
  const loginRes = await testApp.request.post('/auth/local').send({ email, password: 'TestPassword123!' });
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
    .send({ title: 'Integration Test Event', startTime: start.toISOString(), endTime: end.toISOString(), ...overrides });
  if (res.status !== 201) {
    throw new Error(`createFutureEvent failed: ${res.status} — ${JSON.stringify(res.body)}`);
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
    .values({ title: 'Past Integration Test Event', creatorId, duration: [start, end] as [Date, Date], ...overrides })
    .returning();
  return event.id;
}
