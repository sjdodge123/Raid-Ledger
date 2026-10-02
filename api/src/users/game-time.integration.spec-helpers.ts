/**
 * Shared helpers for the game-time integration specs
 * (game-time.integration.spec.ts, game-time.absence-expiry.integration.spec.ts).
 */
import type { TestApp } from '../common/testing/test-app';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';

/** Helper to create a member user with local credentials and return their token. */
export async function createMemberAndLogin(
  testApp: TestApp,
  username: string,
  email: string,
): Promise<{ userId: number; token: string }> {
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);

  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username,
        role: 'member',
      })
      .returning(),
    'user',
  );

  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash,
    userId: user.id,
  });

  const loginRes = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });

  return { userId: user.id, token: loginRes.body.access_token as string };
}

/** YYYY-MM-DD for `days` from the current UTC date (negative = past). */
export function utcDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/** YYYY-MM-DD for `days` from "today" as seen at a given tz offset (minutes). */
export function localDateOffset(tzOffset: number, days: number): string {
  const d = new Date(Date.now() - tzOffset * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}
