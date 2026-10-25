/** ROK-1955: shared fixtures for the device-link integration specs. */
import { eq } from 'drizzle-orm';
import {
  CompanionLinkStartResponseSchema,
  type CompanionLinkStartResponse,
} from '@raid-ledger/contract';
import type { TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import { CompanionDeviceRateLimiter } from '../companion-device-link.limits';
import { deviceCodes } from '../companion-device-token.helpers';

export const LINK = '/companion/v1/devices/link';
export const DEVICE = {
  name: 'Test-PC',
  os: 'windows',
  osVersion: '11',
  appVersion: '0.1.0',
} as const;

export const bearer = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

/** Start a link as the app would; throws unless 200. */
export async function startLink(
  testApp: TestApp,
): Promise<CompanionLinkStartResponse> {
  const res = await testApp.request.post(LINK).send({ device: DEVICE });
  if (res.status !== 200) throw new Error(`startLink: HTTP ${res.status}`);
  return CompanionLinkStartResponseSchema.parse(res.body);
}

/** A member user plus a session JWT for them. */
export async function makeUser(
  testApp: TestApp,
  username: string,
  deactivated = false,
): Promise<{ id: number; token: string }> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${username}@test.local`,
        username,
        role: 'member',
        ...(deactivated ? { deactivatedAt: new Date() } : {}),
      })
      .returning({ id: schema.users.id }),
    `user ${username}`,
  );
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username,
    role: 'member',
  });
  return { id: user.id, token };
}

export const poll = (testApp: TestApp, deviceCode: string) =>
  testApp.request.post(`${LINK}/poll`).send({ deviceCode });

export const decide = (
  testApp: TestApp,
  token: string,
  userCode: string,
  decision: 'approve' | 'deny' = 'approve',
) =>
  testApp.request
    .post(`${LINK}/decision`)
    .set(bearer(token))
    .send({ userCode, decision });

export const preview = (testApp: TestApp, token: string, userCode: string) =>
  testApp.request.get(`${LINK}/${userCode}`).set(bearer(token));

/** The link row for a device code (looked up by its hash). */
export async function linkRow(testApp: TestApp, deviceCode: string) {
  const [row] = await testApp.db
    .select()
    .from(schema.companionDeviceLinks)
    .where(
      eq(
        schema.companionDeviceLinks.deviceCodeHash,
        deviceCodes.hash(deviceCode),
      ),
    );
  return nonEmpty(row ? [row] : [], 'link row')[0];
}

/** Move a link's expiry into the past. */
export async function expireLink(
  testApp: TestApp,
  deviceCode: string,
): Promise<void> {
  await testApp.db
    .update(schema.companionDeviceLinks)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(
      eq(
        schema.companionDeviceLinks.deviceCodeHash,
        deviceCodes.hash(deviceCode),
      ),
    );
}

/** Insert `n` live devices for `userId` (cap fixtures). */
export async function seedDevices(
  testApp: TestApp,
  userId: number,
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await testApp.db.insert(schema.companionDevices).values({
      userId,
      name: `seed-${i}`,
      tokenHash: `seed-${userId}-${i}-${Date.now()}`,
      tokenHint: 'abcd',
    });
  }
}

export async function deviceCount(testApp: TestApp): Promise<number> {
  const rows = await testApp.db.select().from(schema.companionDevices);
  return rows.length;
}

let shift = 0;
/** Start every in-process limiter window afresh (time-shift, no reset API). */
export function expireLimiterWindows(testApp: TestApp): void {
  shift += 3_600_000;
  const offset = shift;
  testApp.app.get(CompanionDeviceRateLimiter).now = () => Date.now() + offset;
}

/** Run `fn` with env vars set, restoring them afterwards. */
export async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(
    Object.keys(vars).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
