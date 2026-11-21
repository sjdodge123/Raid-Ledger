/**
 * ROK-2283 — `/login` decision table, reply copy and the per-member rate
 * limit (pure; the limiter runs against an in-memory fake of incr/expire/ttl).
 */
import {
  LINK_REPLY_COPY,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  buildLoginLinkRow,
  checkLoginRateLimit,
  decideLogin,
  loginRateLimitKey,
  rateLimitedCopy,
  refusalCopy,
  type LoginCaller,
  type LoginRateLimitRedis,
} from './login.helpers';

const URL_ = 'https://raid.example';
const SNOWFLAKE = '123456789012345678';

function caller(over: Partial<LoginCaller> = {}): LoginCaller {
  return {
    id: 7,
    discordId: SNOWFLAKE,
    bannedAt: null,
    kickedAt: null,
    deactivatedAt: null,
    ...over,
  };
}

function decide(
  c: LoginCaller | null,
  opts: { url?: string | null; member?: boolean } = {},
) {
  return decideLogin({
    clientUrl: opts.url === undefined ? URL_ : opts.url,
    caller: c,
    isGuildMember: opts.member ?? true,
  });
}

describe('decideLogin — refusal table', () => {
  it('refuses when no client URL is configured, before anything else', () => {
    expect(decide(caller({ bannedAt: new Date() }), { url: null })).toEqual({
      kind: 'no-client-url',
    });
  });

  it('refuses a banned member, even on an unlinked row', () => {
    expect(decide(caller({ bannedAt: new Date() }))).toEqual({
      kind: 'banned',
    });
    expect(
      decide(
        caller({ bannedAt: new Date(), discordId: `unlinked:${SNOWFLAKE}` }),
      ),
    ).toEqual({ kind: 'banned' });
  });

  it('refuses a kick inside the cooldown, and lets an expired kick through', () => {
    const kickedAt = new Date(Date.now() - 60_000);
    expect(decide(caller({ kickedAt }))).toEqual({ kind: 'kicked', kickedAt });
    const old = new Date(Date.now() - 60 * 60_000);
    expect(decide(caller({ kickedAt: old })).kind).toBe('existing');
  });

  it('refuses a deactivated member', () => {
    expect(decide(caller({ deactivatedAt: new Date() }))).toEqual({
      kind: 'deactivated',
    });
  });

  it('refuses a caller who is not in the guild, linked or not', () => {
    expect(decide(caller(), { member: false })).toEqual({ kind: 'not-member' });
    expect(decide(null, { member: false })).toEqual({ kind: 'not-member' });
  });
});

describe('decideLogin — branches', () => {
  it('an existing linked member gets their own user id and the client URL', () => {
    expect(decide(caller({ id: 42 }))).toEqual({
      kind: 'existing',
      userId: 42,
      clientUrl: URL_,
    });
  });

  it('a member with no row is first-time', () => {
    expect(decide(null)).toEqual({ kind: 'first-time', clientUrl: URL_ });
  });

  it('an unlinked:<id> row is first-time (redeem relinks it)', () => {
    expect(decide(caller({ discordId: `unlinked:${SNOWFLAKE}` }))).toEqual({
      kind: 'first-time',
      clientUrl: URL_,
    });
  });
});

describe('reply copy', () => {
  it('names the community on ban and non-member refusals, with a fallback', () => {
    expect(refusalCopy({ kind: 'banned' }, 'Night Raiders')).toBe(
      "You can't sign in to Night Raiders. Contact an admin.",
    );
    expect(refusalCopy({ kind: 'not-member' }, null)).toContain(
      'Only members of the Raid Ledger Discord server',
    );
  });

  it('deactivated tells the member to rejoin the server', () => {
    expect(refusalCopy({ kind: 'deactivated' }, null)).toBe(
      'Your account is inactive — rejoin the Discord server, then try again.',
    );
  });

  it('kicked shows the remaining cooldown minutes', () => {
    const copy = refusalCopy({ kind: 'kicked', kickedAt: new Date() }, null);
    expect(copy).toMatch(/log in again in [1-5] minute\(s\)/);
  });

  it('no client URL names the missing setting', () => {
    expect(refusalCopy({ kind: 'no-client-url' }, null)).toContain('site URL');
  });

  it('the link copy carries the 15-minute expiry and the Open-in-browser tip', () => {
    expect(LINK_REPLY_COPY).toContain('expires in 15 minutes');
    expect(LINK_REPLY_COPY).toContain('**Open in browser**');
  });

  it('rate-limited copy pluralises the minutes', () => {
    expect(rateLimitedCopy(1)).toBe(
      "You've asked for too many sign-in links. Try again in 1 minute.",
    );
    expect(rateLimitedCopy(7)).toContain('Try again in 7 minutes.');
  });

  it('the button row is one Link button pointing at the URL', () => {
    const row = buildLoginLinkRow(`${URL_}/signin-link#token=x`).toJSON();
    expect(row.components).toHaveLength(1);
    expect(row.components[0]).toMatchObject({
      style: 5,
      label: 'Sign in',
      url: `${URL_}/signin-link#token=x`,
    });
  });
});

/** In-memory incr/expire/ttl with a controllable clock. */
function fakeRedis(clock: { now: number }) {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  const sweep = (key: string): void => {
    const at = expiries.get(key);
    if (at !== undefined && at <= clock.now) {
      counts.delete(key);
      expiries.delete(key);
    }
  };
  const redis = {
    incr: jest.fn((key: string) => {
      sweep(key);
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    }),
    expire: jest.fn((key: string, seconds: number) => {
      expiries.set(key, clock.now + seconds * 1000);
      return Promise.resolve(1);
    }),
    ttl: jest.fn((key: string) => {
      sweep(key);
      if (!counts.has(key)) return Promise.resolve(-2);
      const at = expiries.get(key);
      const left = at === undefined ? -1 : Math.ceil((at - clock.now) / 1000);
      return Promise.resolve(left);
    }),
  };
  return { redis: redis as unknown as LoginRateLimitRedis, expiries };
}

describe('checkLoginRateLimit — 3 per member per 10 minutes', () => {
  it('uses the signin-link:rl:<discordId> key', () => {
    expect(loginRateLimitKey(SNOWFLAKE)).toBe(`signin-link:rl:${SNOWFLAKE}`);
  });

  it('allows three, refuses the fourth with the minutes left', async () => {
    const clock = { now: 0 };
    const { redis } = fakeRedis(clock);
    for (let i = 0; i < 3; i += 1) {
      expect(await checkLoginRateLimit(redis, SNOWFLAKE)).toEqual({
        allowed: true,
      });
    }
    clock.now = 2 * 60_000 + 10_000;
    expect(await checkLoginRateLimit(redis, SNOWFLAKE)).toEqual({
      allowed: false,
      retryMinutes: 8,
    });
  });

  it('counts each member separately', async () => {
    const { redis } = fakeRedis({ now: 0 });
    for (let i = 0; i < 3; i += 1) await checkLoginRateLimit(redis, SNOWFLAKE);
    expect(await checkLoginRateLimit(redis, '223456789012345678')).toEqual({
      allowed: true,
    });
  });

  it('opens again once the window has passed', async () => {
    const clock = { now: 0 };
    const { redis } = fakeRedis(clock);
    for (let i = 0; i < 4; i += 1) await checkLoginRateLimit(redis, SNOWFLAKE);
    clock.now = LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000;
    expect(await checkLoginRateLimit(redis, SNOWFLAKE)).toEqual({
      allowed: true,
    });
  });

  it('re-arms a counter that lost its expiry instead of locking forever', async () => {
    const clock = { now: 0 };
    const { redis, expiries } = fakeRedis(clock);
    for (let i = 0; i < 3; i += 1) await checkLoginRateLimit(redis, SNOWFLAKE);
    expiries.clear();
    expect(await checkLoginRateLimit(redis, SNOWFLAKE)).toEqual({
      allowed: false,
      retryMinutes: 10,
    });
    expect(expiries.has(loginRateLimitKey(SNOWFLAKE))).toBe(true);
  });
});
