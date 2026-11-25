/**
 * ROK-2370 — Discord sign-in codes (integration, real DB + the test Redis).
 *
 * POST /auth/discord/signin-code hands out a code + device secret; the poll
 * reads pending until the bot approves through SigninCodeStore, then returns
 * a session + rl_rt cookie exactly once. Expired codes, unknown secrets and a
 * second approve all fail closed.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { SigninCodePollResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { AUTH_EVENTS } from './auth.service';
import { DiscordSigninLinkService } from './discord-signin-link.service';
import { MagicLinkService } from './magic-link.service';
import { REFRESH_COOKIE_NAME } from './refresh/refresh-cookie.helpers';
import { SigninCodeStore } from './signin-code.store';

const START = '/auth/discord/signin-code';
const POLL = '/auth/discord/signin-code/poll';
const SHAPE = /^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ──────────────────────────────────────────────────────────────────

interface Started {
  code: string;
  deviceSecret: string;
  expiresAt: string;
  pollIntervalMs: number;
}

async function start(): Promise<Started> {
  const res = await testApp.request.post(START).send({});
  expect(res.status).toBe(200);
  return res.body as Started;
}

function poll(deviceSecret: string) {
  return testApp.request.post(POLL).send({ deviceSecret });
}

function refreshCookieOf(res: { headers: Record<string, unknown> }): boolean {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [];
  return lines.some((l) => l.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

async function refreshRows(userId: number) {
  return testApp.db
    .select({ authMethod: schema.refreshTokens.authMethod })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.userId, userId));
}

async function approveAsAdmin(code: string): Promise<boolean> {
  const token = await testApp.app
    .get(MagicLinkService)
    .generateToken(testApp.seed.adminUser.id);
  if (token === null) throw new Error('admin user missing');
  return testApp.app
    .get(SigninCodeStore)
    .approve(code, { kind: 'existing', token, displayName: 'admin' });
}

/** Move the clock past the code's 10-minute life (store + Redis mock). */
function jumpPastExpiry(): void {
  const later = Date.now() + 11 * 60 * 1000;
  jest.spyOn(Date, 'now').mockReturnValue(later);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('POST /auth/discord/signin-code', () => {
  it('returns a code, a device secret, a 10-minute expiry and a poll interval', async () => {
    const body = await start();
    expect(body.code).toMatch(SHAPE);
    expect(body.deviceSecret.length).toBeGreaterThanOrEqual(43);
    const ttlMs = Date.parse(body.expiresAt) - Date.now();
    expect(ttlMs).toBeGreaterThan(9 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(body.pollIntervalMs).toBeGreaterThan(0);
  });

  it('stores only a hash of the device secret', async () => {
    const { deviceSecret } = await start();
    const stored = [...testApp.redisMock.store.entries()].flat().join('\n');
    expect(stored).not.toContain(deviceSecret);
  });
});

describe('POST /auth/discord/signin-code/poll', () => {
  it('reads pending until approved, then a session + rl_rt once, then expired', async () => {
    const { code, deviceSecret } = await start();
    const pending = await poll(deviceSecret);
    expect(pending.status).toBe(200);
    expect(pending.body).toMatchObject({ status: 'pending' });
    expect(
      await testApp.app.get(SigninCodeStore).findPending(code),
    ).not.toBeNull();

    expect(await approveAsAdmin(code)).toBe(true);
    const approved = await poll(deviceSecret);
    expect(approved.status).toBe(200);
    const parsed = SigninCodePollResponseSchema.parse(approved.body);
    expect(parsed.status).toBe('approved');
    expect(refreshCookieOf(approved)).toBe(true);
    const rows = await refreshRows(testApp.seed.adminUser.id);
    expect(rows).toEqual([{ authMethod: 'magic' }]);

    const again = await poll(deviceSecret);
    expect(again.body).toEqual({ status: 'expired' });
    expect(refreshCookieOf(again)).toBe(false);
  });

  it("an existing member approved with src:'cmd' emits one DISCORD_LOGIN", async () => {
    const discordId = '812345678901234567';
    const [user] = await testApp.db
      .insert(schema.users)
      .values({ discordId, username: 'coder', role: 'member' })
      .returning();
    if (!user) throw new Error('insert user failed');
    const token = await testApp.app
      .get(MagicLinkService)
      .generateToken(user.id, { src: 'cmd' });
    if (token === null) throw new Error('token not minted');
    const { code, deviceSecret } = await start();
    const store = testApp.app.get(SigninCodeStore);
    const display = 'coder';
    expect(
      await store.approve(code, {
        kind: 'existing',
        token,
        displayName: display,
      }),
    ).toBe(true);
    const emit = jest.spyOn(testApp.app.get(EventEmitter2), 'emit');

    const res = await poll(deviceSecret);

    expect(res.body).toMatchObject({ status: 'approved' });
    const logins = emit.mock.calls
      .filter(([event]) => event === AUTH_EVENTS.DISCORD_LOGIN)
      .map(([, payload]) => payload);
    expect(logins).toEqual([{ userId: user.id, discordId }]);
  });

  it('lets only the first approve land', async () => {
    const { code } = await start();
    expect(await approveAsAdmin(code)).toBe(true);
    expect(await approveAsAdmin(code)).toBe(false);
    expect(await testApp.app.get(SigninCodeStore).findPending(code)).toBeNull();
  });

  it('signs a first-time member in with a discord-link family', async () => {
    const { code, deviceSecret } = await start();
    const token = testApp.app.get(DiscordSigninLinkService).mintToken({
      discordId: '912345678901234567',
      username: 'newbie',
      avatar: null,
      src: 'cmd',
    });
    const store = testApp.app.get(SigninCodeStore);
    const display = 'newbie';
    expect(
      await store.approve(code, {
        kind: 'first-time',
        token,
        displayName: display,
      }),
    ).toBe(true);
    const res = await poll(deviceSecret);
    expect(res.body).toMatchObject({ status: 'approved' });
    const [user] = await testApp.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.discordId, '912345678901234567'));
    if (!user) throw new Error('first-time member was not created');
    expect(await refreshRows(user.id)).toEqual([
      { authMethod: 'discord-link' },
    ]);
  });

  it('reads an expired code as expired and refuses to approve it', async () => {
    const { code, deviceSecret } = await start();
    jumpPastExpiry();
    expect(await approveAsAdmin(code)).toBe(false);
    const res = await poll(deviceSecret);
    expect(res.body).toEqual({ status: 'expired' });
  });

  it('reads an unknown device secret as expired (no oracle)', async () => {
    await start();
    const res = await poll('x'.repeat(43));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'expired' });
  });

  it('rejects a malformed body with 400 and a non-JSON body with 415', async () => {
    const short = await poll('too-short');
    expect(short.status).toBe(400);
    const form = await testApp.request
      .post(POLL)
      .type('form')
      .send({ deviceSecret: 'x'.repeat(43) });
    expect(form.status).toBe(415);
  });
});
