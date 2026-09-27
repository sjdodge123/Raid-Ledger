/**
 * ROK-1366 — single-use magic-link redemption (integration, real DB).
 *
 * Covers ACs 2, 3, 4, 6, 7 and the HTTP half of AC5 (a magic token is never
 * a bearer). The gateway half of AC5 lives in the two gateway unit specs.
 *
 * Tokens are minted through the app's own `MagicLinkService.generateLink`
 * (the fragment carrier the web reads), except the deliberately bad ones —
 * expired, legacy JWT_SECRET-signed, wrong purpose — which are hand-signed
 * with the same secrets the app uses (`process.env.JWT_SECRET` is set for
 * this file's realm by `getTestApp`).
 */
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import {
  INVALID_MAGIC_LINK_MESSAGE,
  MagicLinkService,
} from './magic-link.service';
import { signPurposeJwt } from './purpose-jwt.helpers';
import { REFRESH_COOKIE_NAME } from './refresh/refresh-cookie.helpers';
import { hashToken } from './single-use-token.helpers';
import { TokenBlocklistService } from './token-blocklist.service';

const REDEEM = '/auth/redeem-magic-link';

/** AC4: every redeem failure answers with exactly this body — no oracle. */
const INVALID_BODY = {
  statusCode: 401,
  message: INVALID_MAGIC_LINK_MESSAGE,
  error: 'Unauthorized',
};

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** A signer holding no default secret: every call names its own. */
const signer = new JwtService();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Mint a real link through the app and pull the token out of its fragment. */
async function mintToken(userId: number): Promise<string> {
  const link = await testApp.app
    .get(MagicLinkService)
    .generateLink(userId, '/events/42', 'http://localhost:5173');
  if (!link) throw new Error(`mintToken: user ${userId} does not exist`);
  const url = new URL(link);
  expect(url.search).toBe('');
  return decodeURIComponent(url.hash.replace(/^#token=/, ''));
}

function redeem(token: unknown) {
  return testApp.request.post(REDEEM).send({ token });
}

function setCookieLines(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') return [raw];
  return [];
}

/** The raw `rl_rt` value a response set, or null when it set none. */
function extractRefreshCookie(res: {
  headers: Record<string, unknown>;
}): string | null {
  for (const line of setCookieLines(res)) {
    const match = line.match(new RegExp(`^${REFRESH_COOKIE_NAME}=([^;]*)`));
    if (match) return match[1];
  }
  return null;
}

async function refreshRows(userId: number) {
  return testApp.db
    .select({ authMethod: schema.refreshTokens.authMethod })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.userId, userId));
}

async function isConsumed(token: string): Promise<boolean> {
  const rows = await testApp.db
    .select({ id: schema.consumedIntentTokens.id })
    .from(schema.consumedIntentTokens)
    .where(eq(schema.consumedIntentTokens.tokenHash, hashToken(token)));
  return rows.length === 1;
}

async function createMember(
  username: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId: `discord-${username}`, username, role: 'member' })
    .returning();
  if (Object.keys(overrides).length === 0) return user;
  await testApp.db
    .update(schema.users)
    .set(overrides)
    .where(eq(schema.users.id, user.id));
  return user;
}

// ── AC2 — a fresh token signs in once ────────────────────────────────────────

describe('POST /auth/redeem-magic-link — success (AC2)', () => {
  it('returns {access_token} + an rl_rt cookie for a new magic refresh family', async () => {
    const userId = testApp.seed.adminUser.id;
    const token = await mintToken(userId);

    const res = await redeem(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ access_token: expect.any(String) });
    expect(res.body.access_token).not.toBe(token);
    expect(extractRefreshCookie(res)).toBeTruthy();
    expect(await refreshRows(userId)).toEqual([{ authMethod: 'magic' }]);
    expect(await isConsumed(token)).toBe(true);
  });

  it('mints an access token that passes /auth/me and a cookie that refreshes', async () => {
    const userId = testApp.seed.adminUser.id;
    const res = await redeem(await mintToken(userId));
    expect(res.status).toBe(200);

    const me = await testApp.request
      .get('/auth/me')
      .set('Authorization', `Bearer ${res.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: userId });

    const refresh = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${extractRefreshCookie(res)}`);
    expect(refresh.status).toBe(200);
    expect(refresh.body).toMatchObject({ access_token: expect.any(String) });
  });
});

// ── AC3 — single use, including under a race ─────────────────────────────────

describe('POST /auth/redeem-magic-link — replay (AC3)', () => {
  it('a second redeem is 401 with no cookie and no second family', async () => {
    const userId = testApp.seed.adminUser.id;
    const token = await mintToken(userId);
    expect((await redeem(token)).status).toBe(200);

    const replay = await redeem(token);

    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(INVALID_BODY);
    expect(extractRefreshCookie(replay)).toBeNull();
    expect(await refreshRows(userId)).toHaveLength(1);
  });

  it('two concurrent redeems produce exactly one 200', async () => {
    const userId = testApp.seed.adminUser.id;
    const token = await mintToken(userId);

    const results = await Promise.all([redeem(token), redeem(token)]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
    expect(await refreshRows(userId)).toHaveLength(1);
  });
});

// ── AC4 — every bad token gets the same 401 ──────────────────────────────────

type TokenBuilder = (userId: number) => Promise<unknown>;

const BAD_TOKENS: [string, TokenBuilder][] = [
  [
    'an expired magic token',
    (sub) =>
      Promise.resolve(
        signPurposeJwt(
          signer,
          'magic-link',
          { sub, magicLink: true, iat: nowSec() - 3600 },
          '15m',
        ),
      ),
  ],
  ['garbage', () => Promise.resolve('not-a-jwt')],
  [
    'a legacy JWT_SECRET-signed magic token',
    (sub) =>
      Promise.resolve(
        signer.sign(
          { sub, username: 'admin', role: 'admin', magicLink: true },
          { secret: process.env.JWT_SECRET, expiresIn: '15m' },
        ),
      ),
  ],
  ['a normal access token', () => loginAsAdmin(testApp.request, testApp.seed)],
  [
    'a link nonce (wrong purpose)',
    (sub) =>
      Promise.resolve(
        signPurposeJwt(signer, 'link-nonce:discord', { sub }, 120),
      ),
  ],
  ['a non-string token', () => Promise.resolve(12345)],
  ['an empty token', () => Promise.resolve('')],
];

describe('POST /auth/redeem-magic-link — rejections (AC4)', () => {
  it.each(BAD_TOKENS)(
    '%s → 401 with the shared body, no cookie, no new family',
    async (_label, build) => {
      const userId = testApp.seed.adminUser.id;
      const token = await build(userId);
      const before = (await refreshRows(userId)).length;

      const res = await redeem(token);

      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID_BODY);
      expect(extractRefreshCookie(res)).toBeNull();
      expect(await refreshRows(userId)).toHaveLength(before);
    },
  );

  it('a body with no token field → the same 401', async () => {
    const res = await testApp.request.post(REDEEM).send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_BODY);
  });
});

// ── AC6 — user-state gates run AFTER the token is consumed ───────────────────

describe('POST /auth/redeem-magic-link — user-state gates (AC6)', () => {
  it.each<[string, Partial<typeof schema.users.$inferInsert>]>([
    ['banned', { bannedAt: new Date(), banReason: 'test' }],
    ['inside the kick cooldown', { kickedAt: new Date() }],
  ])('a %s user → 401, and the token is still consumed', async (_s, state) => {
    const user = await createMember(`gated-${Date.now()}`, state);
    const token = await mintToken(user.id);

    const res = await redeem(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_BODY);
    expect(await isConsumed(token)).toBe(true);
    expect(await refreshRows(user.id)).toHaveLength(0);
  });

  it('a user deleted after mint → 401, and the token is still consumed', async () => {
    const user = await createMember('gone-user');
    const token = await mintToken(user.id);
    await testApp.db.delete(schema.users).where(eq(schema.users.id, user.id));

    const res = await redeem(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_BODY);
    expect(await isConsumed(token)).toBe(true);
  });

  it('a user blocklisted at the token iat → 401, and the token is consumed', async () => {
    const user = await createMember('blocked-user');
    const token = await mintToken(user.id);
    await testApp.app.get(TokenBlocklistService).blockUser(user.id);

    const res = await redeem(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_BODY);
    expect(await isConsumed(token)).toBe(true);
    expect(await refreshRows(user.id)).toHaveLength(0);
  });
});

// ── AC5 (HTTP half) — a magic token is never a bearer ────────────────────────

describe('magic tokens as Authorization: Bearer (AC5)', () => {
  it('the raw magic token is 401 on /auth/me and on a write route', async () => {
    const token = await mintToken(testApp.seed.adminUser.id);
    const access = await loginAsAdmin(testApp.request, testApp.seed);

    const writeOk = await testApp.request
      .post('/users/me/complete-onboarding')
      .set('Authorization', `Bearer ${access}`);
    expect(writeOk.status).not.toBe(401);

    const me = await testApp.request
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    const write = await testApp.request
      .post('/users/me/complete-onboarding')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
    expect(write.status).toBe(401);
  });

  it('a JWT_SECRET-signed {magicLink:true} token is 401 through JwtStrategy', async () => {
    const sub = testApp.seed.adminUser.id;
    const payload = { sub, username: 'admin', role: 'admin' };
    const opts = { secret: process.env.JWT_SECRET, expiresIn: '15m' as const };
    const plain = signer.sign(payload, opts);
    const legacy = signer.sign({ ...payload, magicLink: true }, opts);

    const control = await testApp.request
      .get('/auth/me')
      .set('Authorization', `Bearer ${plain}`);
    expect(control.status).toBe(200);

    const res = await testApp.request
      .get('/auth/me')
      .set('Authorization', `Bearer ${legacy}`);
    expect(res.status).toBe(401);
  });
});

// ── AC7 — JSON only (login-CSRF guard), no JWT guard ─────────────────────────

describe('POST /auth/redeem-magic-link — request shape (AC7)', () => {
  it('a form-encoded POST is 415 and leaves the token redeemable', async () => {
    const token = await mintToken(testApp.seed.adminUser.id);

    const form = await testApp.request
      .post(REDEEM)
      .type('form')
      .send({ token });

    expect(form.status).toBe(415);
    expect(extractRefreshCookie(form)).toBeNull();
    expect(await isConsumed(token)).toBe(false);
    expect((await redeem(token)).status).toBe(200);
  });

  it('a text/plain POST is 415', async () => {
    const token = await mintToken(testApp.seed.adminUser.id);

    const res = await testApp.request
      .post(REDEEM)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ token }));

    expect(res.status).toBe(415);
    expect(await isConsumed(token)).toBe(false);
  });

  it('needs no Authorization header (the link token is the credential)', async () => {
    const token = await mintToken(testApp.seed.adminUser.id);
    const res = await redeem(token);
    expect(res.status).toBe(200);
  });
});
