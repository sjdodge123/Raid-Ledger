/**
 * ROK-2376 (integration, real DB): an impersonation session cannot add or
 * remove a sign-in method on the account it impersonates. Without this an
 * operator could link their own Discord / Steam / Google to a member and keep
 * signing in as that member after the impersonation ends.
 *
 * The impersonation token is minted for real (`POST /auth/impersonate/:id` by
 * an operator), so the spec exercises the same `req.user.impersonatedBy` the
 * guard reads. Each route is also hit with the target's own session to prove
 * normal sessions are unchanged. The link hop/callback carry no session and
 * only proceed on a nonce minted at start, so the start is where it is
 * refused (covered by `link-start.integration.spec.ts` for the nonce rules).
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import {
  configureGoogleSignin,
  identitiesOf,
  insertUser,
  linkGoogleIdentity,
  must,
  setCookies,
} from './google-signin/google-signin.integration.spec-helpers';
import { IMPERSONATION_SIGNIN_METHODS_MESSAGE } from './impersonation-guard.helpers';

let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await configureGoogleSignin(testApp, true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── fixtures ─────────────────────────────────────────────────────────────────

interface Target {
  id: number;
  /** The target's own (normal) session. */
  ownToken: string;
  /** An operator's impersonation session on the target. */
  impersonationToken: string;
}

/** A member with Discord, Steam and Google linked (so no unlink is the last). */
async function targetWithEveryMethod(): Promise<Target> {
  seq += 1;
  const username = `imp-link-${seq}`;
  const user = await insertUser(testApp, {
    username,
    discordId: `2376000000000${seq}`,
    steamId: `7656119800000${seq}`,
  });
  await linkGoogleIdentity(
    testApp,
    user.id,
    `2376-sub-${seq}`,
    `${username}@example.test`,
  );
  const ownToken = await signTestAccessToken(testApp, {
    sub: user.id,
    username,
    role: 'member',
  });
  return {
    id: user.id,
    ownToken,
    impersonationToken: await impersonate(user.id),
  };
}

/** An operator starts a real (cookie-less) impersonation of `targetId`. */
async function impersonate(targetId: number): Promise<string> {
  const operator = await insertUser(testApp, {
    username: `imp-operator-${seq}`,
    role: 'operator',
  });
  const operatorToken = await signTestAccessToken(testApp, {
    sub: operator.id,
    username: operator.username,
    role: 'operator',
  });
  const res = await testApp.request
    .post(`/auth/impersonate/${targetId}`)
    .set('Authorization', `Bearer ${operatorToken}`);
  expect(res.status).toBe(200);
  return must(
    res.body.access_token as string | undefined,
    'impersonation token',
  );
}

async function userRow(id: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id));
  return must(row, `user ${id}`);
}

function refusal(res: { status: number; body: { message?: unknown } }) {
  return { status: res.status, message: res.body.message };
}

const REFUSED = { status: 403, message: IMPERSONATION_SIGNIN_METHODS_MESSAGE };

// ── link start ───────────────────────────────────────────────────────────────

const LINK_STARTS = [
  { provider: 'discord', path: '/auth/discord/link/start' },
  { provider: 'steam', path: '/auth/steam/link/start' },
  { provider: 'google', path: '/auth/google/link/start' },
] as const;

describe.each(LINK_STARTS)('POST $path', ({ provider, path }) => {
  const cookieName = `rl_link_${provider}`;

  function start(token: string) {
    return testApp.request
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  it('refuses an impersonation session with 403 and mints no nonce', async () => {
    const target = await targetWithEveryMethod();
    const res = await start(target.impersonationToken);
    expect(refusal(res)).toEqual(REFUSED);
    expect(res.body).not.toHaveProperty('nonce');
    expect(setCookies(res).has(cookieName)).toBe(false);
  });

  it('still starts a link for the member’s own session', async () => {
    const target = await targetWithEveryMethod();
    const res = await start(target.ownToken);
    expect(res.status).toBe(200);
    expect(typeof res.body.nonce).toBe('string');
    expect(setCookies(res).has(cookieName)).toBe(true);
  });
});

// ── unlink ───────────────────────────────────────────────────────────────────

/** Each unlink route plus a read of the method it removes (null = gone). */
const UNLINKS = [
  {
    name: 'Discord',
    path: '/users/me/discord',
    linked: async (id: number) => {
      const discordId = (await userRow(id)).discordId;
      return discordId && !discordId.startsWith('unlinked:') ? discordId : null;
    },
  },
  {
    name: 'Google',
    path: '/users/me/identities/google',
    linked: async (id: number) =>
      (await identitiesOf(testApp, id))[0]?.subject ?? null,
  },
  {
    name: 'Steam',
    path: '/auth/steam/link',
    linked: async (id: number) => (await userRow(id)).steamId,
  },
] as const;

describe.each(UNLINKS)('DELETE $path ($name)', ({ path, linked }) => {
  function unlink(token: string) {
    return testApp.request.delete(path).set('Authorization', `Bearer ${token}`);
  }

  it('refuses an impersonation session with 403 and keeps the method', async () => {
    const target = await targetWithEveryMethod();
    const before = await linked(target.id);
    expect(before).not.toBeNull();
    const res = await unlink(target.impersonationToken);
    expect(refusal(res)).toEqual(REFUSED);
    expect(await linked(target.id)).toBe(before);
  });

  it('still unlinks for the member’s own session', async () => {
    const target = await targetWithEveryMethod();
    const res = await unlink(target.ownToken);
    expect(res.status).toBe(204);
    expect(await linked(target.id)).toBeNull();
  });
});
