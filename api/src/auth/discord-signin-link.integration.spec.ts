/**
 * ROK-2283 — the Discord `/login` sign-in links (integration, real DB).
 *
 * POST /auth/redeem-discord-link: a first-time member's link creates the
 * account once and signs it in as a Discord login; replay, expiry, a ban and
 * the kick cooldown are all the same 401; an `unlinked:<id>` row is relinked.
 * POST /auth/redeem-magic-link: a magic link minted with `src:'cmd'` emits
 * AUTH_EVENTS.DISCORD_LOGIN, an ordinary one does not.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { AUTH_EVENTS } from './auth.service';
import {
  DiscordSigninLinkService,
  INVALID_DISCORD_LINK_MESSAGE,
} from './discord-signin-link.service';
import { MagicLinkService } from './magic-link.service';
import { derivePurposeSecret } from './purpose-jwt.helpers';
import { bumpTokenVersion } from './token-version.helpers';

const REDEEM = '/auth/redeem-discord-link';
const CLIENT = 'http://localhost:5173';
const INVALID_BODY = {
  statusCode: 401,
  message: INVALID_DISCORD_LINK_MESSAGE,
  error: 'Unauthorized',
};

let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** A fresh snowflake per test, so no row from the seed can collide. */
function snowflake(): string {
  seq += 1;
  return `9${String(Date.now()).padStart(14, '0')}${String(seq).padStart(3, '0')}`;
}

function tokenOf(link: string): string {
  const url = new URL(link);
  expect(url.pathname).toBe('/signin-link');
  expect(url.search).toBe('');
  return decodeURIComponent(url.hash.replace(/^#token=/, ''));
}

function mintSignin(discordId: string, username = 'newbie'): string {
  const link = testApp.app
    .get(DiscordSigninLinkService)
    .mint({ discordId, username, avatar: null, src: 'cmd' }, CLIENT);
  return tokenOf(link);
}

function redeem(token: string, path = REDEEM) {
  return testApp.request.post(path).send({ token });
}

/** Spy (call-through) on the bus; returns the DISCORD_LOGIN payloads seen. */
function spyDiscordLogins(): () => unknown[] {
  const spy = jest.spyOn(testApp.app.get(EventEmitter2), 'emit');
  return () =>
    spy.mock.calls
      .filter(([event]) => event === AUTH_EVENTS.DISCORD_LOGIN)
      .map(([, payload]) => payload);
}

async function usersWith(discordId: string) {
  return testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId));
}

async function refreshMethods(userId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ authMethod: schema.refreshTokens.authMethod })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.userId, userId));
  return rows.map((r) => r.authMethod);
}

async function insertUser(
  discordId: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId, username: `u-${discordId}`, role: 'member' })
    .returning();
  if (!user) throw new Error(`insertUser: no row for ${discordId}`);
  if (Object.keys(overrides).length > 0) {
    await testApp.db
      .update(schema.users)
      .set(overrides)
      .where(eq(schema.users.id, user.id));
  }
  return user;
}

// ── first-time member ────────────────────────────────────────────────────────

describe('POST /auth/redeem-discord-link — first use', () => {
  it('creates the user once, signs in (discord-link family), emits DISCORD_LOGIN', async () => {
    const discordId = snowflake();
    const logins = spyDiscordLogins();

    const res = await redeem(mintSignin(discordId));

    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe('string');
    const created = await usersWith(discordId);
    expect(created).toHaveLength(1);
    const user = created[0];
    if (!user) throw new Error('user not created');
    expect(user.username).toBe('newbie');
    expect(await refreshMethods(user.id)).toEqual(['discord-link']);
    expect(logins()).toEqual([{ userId: user.id, discordId }]);
    const me = await testApp.request
      .get('/auth/me')
      .set('Authorization', `Bearer ${res.body.access_token as string}`);
    expect(me.status).toBe(200);
  });

  it('a second redeem of the same link is 401 and creates nothing more', async () => {
    const discordId = snowflake();
    const token = mintSignin(discordId);
    expect((await redeem(token)).status).toBe(200);

    const again = await redeem(token);

    expect(again.status).toBe(401);
    expect(again.body).toEqual(INVALID_BODY);
    expect(await usersWith(discordId)).toHaveLength(1);
  });

  it('an expired link is 401 and creates no user', async () => {
    const discordId = snowflake();
    const base = process.env.JWT_SECRET ?? '';
    const now = Math.floor(Date.now() / 1000);
    const expired = new JwtService().sign(
      {
        discordId,
        username: 'late',
        avatar: null,
        signin: true,
        src: 'cmd',
        iat: now - 3600,
        exp: now - 60,
      },
      { secret: derivePurposeSecret(base, 'discord-signin') },
    );

    const res = await redeem(expired);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_BODY);
    expect(await usersWith(discordId)).toHaveLength(0);
  });

  it('a form-encoded POST is 415 and leaves the link redeemable', async () => {
    const token = mintSignin(snowflake());
    const form = await testApp.request
      .post(REDEEM)
      .type('form')
      .send({ token });
    expect(form.status).toBe(415);
    expect((await redeem(token)).status).toBe(200);
  });
});

// ── existing rows the token's Discord id matches ─────────────────────────────

describe('POST /auth/redeem-discord-link — existing accounts', () => {
  it.each<[string, Partial<typeof schema.users.$inferInsert>]>([
    ['banned', { bannedAt: new Date(), banReason: 'test' }],
    ['inside the kick cooldown', { kickedAt: new Date() }],
  ])('a %s member → 401, no session', async (_s, state) => {
    const discordId = snowflake();
    const user = await insertUser(discordId, state);

    const res = await redeem(mintSignin(discordId));

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_BODY);
    expect(await refreshMethods(user.id)).toEqual([]);
  });

  it('relinks an unlinked:<id> row instead of creating a second account', async () => {
    const discordId = snowflake();
    const old = await insertUser(`unlinked:${discordId}`);
    const logins = spyDiscordLogins();

    const res = await redeem(mintSignin(discordId, 'back-again'));

    expect(res.status).toBe(200);
    const rows = await usersWith(discordId);
    expect(rows.map((r) => r.id)).toEqual([old.id]);
    expect(await usersWith(`unlinked:${discordId}`)).toHaveLength(0);
    expect(logins()).toEqual([{ userId: old.id, discordId }]);
  });
});

// ── a link pinned to an unlinked:<id> row (Codex P2) ─────────────────────────

describe('POST /auth/redeem-discord-link — unlinked row pinned to its token version', () => {
  function mintPinned(discordId: string, userId: number, tokenVersion: number) {
    const link = testApp.app.get(DiscordSigninLinkService).mint(
      {
        discordId,
        username: 'back-again',
        avatar: null,
        src: 'cmd',
        rebind: { userId, tokenVersion },
      },
      CLIENT,
    );
    return tokenOf(link);
  }

  it('relinks while the row is still at the minted version', async () => {
    const discordId = snowflake();
    const old = await insertUser(`unlinked:${discordId}`);

    const res = await redeem(mintPinned(discordId, old.id, old.tokenVersion));

    expect(res.status).toBe(200);
    expect((await usersWith(discordId)).map((r) => r.id)).toEqual([old.id]);
  });

  it('401s after a password/role change bumped the version, and relinks nothing', async () => {
    const discordId = snowflake();
    const old = await insertUser(`unlinked:${discordId}`);
    const token = mintPinned(discordId, old.id, old.tokenVersion);
    await bumpTokenVersion(testApp.db, old.id);
    const logins = spyDiscordLogins();

    const res = await redeem(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_BODY);
    expect(await usersWith(`unlinked:${discordId}`)).toHaveLength(1);
    expect(await usersWith(discordId)).toHaveLength(0);
    expect(await refreshMethods(old.id)).toEqual([]);
    expect(logins()).toEqual([]);
  });
});

// ── magic links minted by the command ────────────────────────────────────────

describe("POST /auth/redeem-magic-link — src:'cmd' (ROK-2283)", () => {
  async function mintMagic(userId: number, cmd: boolean): Promise<string> {
    const link = await testApp.app
      .get(MagicLinkService)
      .generateLink(userId, '/signin-link', CLIENT, cmd ? { src: 'cmd' } : {});
    if (!link) throw new Error(`mintMagic: user ${userId} missing`);
    return tokenOf(link);
  }

  it.each<[string, boolean, number]>([
    ["a /login link (src:'cmd')", true, 1],
    ['an ordinary magic link', false, 0],
  ])('%s → DISCORD_LOGIN emitted %s time(s)', async (_l, cmd, times) => {
    const discordId = snowflake();
    const user = await insertUser(discordId);
    const token = await mintMagic(user.id, cmd);
    const logins = spyDiscordLogins();

    const res = await redeem(token, '/auth/redeem-magic-link');

    expect(res.status).toBe(200);
    expect(await refreshMethods(user.id)).toEqual(['magic']);
    expect(logins()).toEqual(times ? [{ userId: user.id, discordId }] : []);
  });

  it('each redeem endpoint refuses the other kind of link (NIT-2)', async () => {
    const discordId = snowflake();
    const user = await insertUser(snowflake());
    const atMagic = await redeem(
      mintSignin(discordId),
      '/auth/redeem-magic-link',
    );
    const atDiscord = await redeem(await mintMagic(user.id, true));

    expect([atMagic.status, atDiscord.status]).toEqual([401, 401]);
    expect(await usersWith(discordId)).toHaveLength(0);
    expect(await refreshMethods(user.id)).toEqual([]);
  });
});
