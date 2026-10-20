/**
 * ROK-1841 — POST /admin/test/intent-token (integration, real DB).
 *
 * The DEMO_MODE-only fixture that mints a join intent token outside Discord.
 * The bar that matters: the token it returns is accepted by the REAL
 * `POST /auth/redeem-intent` path and actually creates the signup — anything
 * weaker would let the claim shape drift from the bot's producer unnoticed.
 */
import { eq } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { z } from 'zod';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { defined } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import {
  INTENT_TOKEN_TTL_SECONDS,
  PLACEHOLDER_DISCORD_ID,
} from './demo-test-intent-token.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ORIGINAL_CLIENT_URL = process.env.CLIENT_URL;
const CLIENT_URL = 'https://smoke.example.test';
const ROUTE = '/admin/test/intent-token';

let testApp: TestApp;
let adminToken: string;

/** The 200 body — parsed, never cast, so a shape drift fails loudly. */
const MintedTokenSchema = z.object({
  token: z.string().min(1),
  url: z.string(),
  eventId: z.number(),
  intent: z.string(),
  discordId: z.string(),
  expiresInSeconds: z.number(),
});

/** The registered claims of a minted token (decoded, not verified). */
const TokenTimesSchema = z.object({ iat: z.number(), exp: z.number() });

async function enableDemoMode(): Promise<void> {
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
}

async function insertEvent(title: string): Promise<number> {
  const start = new Date(Date.now() + 3 * 86_400_000);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  const [row] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      gameId: testApp.seed.game.id,
      duration: [start, end],
      maxAttendees: 10,
      creatorId: testApp.seed.adminUser.id,
    })
    .returning();
  return defined(row, `inserted event ${title}`).id;
}

function mint(body: Record<string, unknown>, token = adminToken) {
  return testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function redeem(token: string, accessToken = adminToken) {
  return testApp.request
    .post('/auth/redeem-intent')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ token });
}

async function signupCountFor(eventId: number): Promise<number> {
  const rows = await testApp.db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  return rows.length;
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.CLIENT_URL = CLIENT_URL;
  await enableDemoMode();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  if (ORIGINAL_CLIENT_URL === undefined) delete process.env.CLIENT_URL;
  else process.env.CLIENT_URL = ORIGINAL_CLIENT_URL;
});

describe('POST /admin/test/intent-token — gates', () => {
  it('403 when the DEMO_MODE env is off', async () => {
    process.env.DEMO_MODE = 'false';
    const eventId = await insertEvent('intent-token-env-off');
    const res = await mint({ eventId, intent: 'signup' });
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('token');
  });

  it('403 when the DB demoMode flag is off', async () => {
    await testApp.app.get(SettingsService).setDemoMode(false);
    const eventId = await insertEvent('intent-token-db-off');
    const res = await mint({ eventId, intent: 'signup' });
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('token');
  });

  it('401 without a JWT', async () => {
    const res = await testApp.request
      .post(ROUTE)
      .send({ eventId: 1, intent: 'signup' });
    expect(res.status).toBe(401);
  });

  it('403 for a non-admin caller', async () => {
    const [member] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'discord-intent-token-member',
        username: 'intent-token-member',
        role: 'member',
      })
      .returning();
    const memberId = defined(member, 'inserted member').id;
    const memberToken = await signTestAccessToken(testApp, {
      sub: memberId,
      username: 'intent-token-member',
      role: 'member',
    });

    const eventId = await insertEvent('intent-token-non-admin');
    const res = await mint({ eventId, intent: 'signup' }, memberToken);
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('token');
  });

  it('400 for an unknown intent, 404 for an unknown event and user', async () => {
    const eventId = await insertEvent('intent-token-rejections');
    expect((await mint({ eventId, intent: 'rsvp' })).status).toBe(400);
    expect((await mint({ eventId })).status).toBe(400);
    expect((await mint({ eventId: 'abc', intent: 'signup' })).status).toBe(400);
    expect((await mint({ eventId: 999_999, intent: 'signup' })).status).toBe(
      404,
    );
    expect(
      (await mint({ eventId, intent: 'signup', userId: 999_999 })).status,
    ).toBe(404);
  });
});

describe('POST /admin/test/intent-token — DEMO_MODE on', () => {
  it('mints a token the real redeemIntent path accepts, creating the signup', async () => {
    const eventId = await insertEvent('intent-token-redeemable');
    const adminId = testApp.seed.adminUser.id;
    const res = await mint({ eventId, intent: 'signup', userId: adminId });
    expect(res.status).toBe(200);
    const minted = MintedTokenSchema.parse(res.body);
    expect(minted.eventId).toBe(eventId);
    expect(minted.intent).toBe('signup');
    expect(minted.expiresInSeconds).toBe(INTENT_TOKEN_TTL_SECONDS);
    const times = TokenTimesSchema.parse(
      testApp.app.get(JwtService).decode(minted.token),
    );
    expect(times.exp - times.iat).toBe(INTENT_TOKEN_TTL_SECONDS);
    expect(INTENT_TOKEN_TTL_SECONDS).toBe(900);
    expect(minted.discordId).toBe(testApp.seed.adminUser.discordId);
    expect(minted.url).toBe(
      `${CLIENT_URL}/join?intent=signup&eventId=${eventId}&token=${encodeURIComponent(minted.token)}`,
    );
    expect(await signupCountFor(eventId)).toBe(0);

    const redeemed = await redeem(minted.token);
    expect(redeemed.status).toBe(201);
    expect(redeemed.body).toMatchObject({ success: true, eventId });

    const rows = await testApp.db
      .select({ userId: schema.eventSignups.userId })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));
    expect(rows.map((r) => r.userId)).toEqual([adminId]);
  });

  it('is single-use: the second redeem of the same token is refused', async () => {
    const eventId = await insertEvent('intent-token-single-use');
    const res = await mint({
      eventId,
      intent: 'signup',
      userId: testApp.seed.adminUser.id,
    });
    expect(res.status).toBe(200);
    const { token } = MintedTokenSchema.parse(res.body);
    expect((await redeem(token)).body).toMatchObject({ success: true });
    const second = await redeem(token);
    expect(second.body).toMatchObject({
      success: false,
      message: 'Intent token is invalid, expired, or already used',
    });
  });

  it('omitting userId stamps the placeholder discord id and still redeems', async () => {
    const eventId = await insertEvent('intent-token-no-user');
    const res = await mint({ eventId, intent: 'signup' });
    expect(res.status).toBe(200);
    const minted = MintedTokenSchema.parse(res.body);
    expect(minted.discordId).toBe(PLACEHOLDER_DISCORD_ID);

    // The seeded admin HAS a discordId, so the mismatch guard must refuse it.
    const mismatched = await redeem(minted.token);
    expect(mismatched.body).toMatchObject({
      success: false,
      message: 'This signup link was generated for a different Discord user',
    });
    expect(await signupCountFor(eventId)).toBe(0);
  });
});
