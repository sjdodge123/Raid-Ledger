/**
 * ROK-1823 U2 (D10): `signAccessToken` takes ONE clock read — `iat` and `exp`
 * are plain clock values, no block floor is read — and signs the `tv`/`itv`
 * token-version claims verbatim. Real JwtService, fake timers.
 */
import { JwtService } from '@nestjs/jwt';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  BornExpiredTokenError,
  signAccessToken,
} from './access-token-mint.helpers';

const NOW = new Date('2026-10-16T12:00:00.250Z');
const SECOND = Math.floor(NOW.getTime() / 1000);
const CLAIMS = { username: 'admin', sub: 7, role: 'admin' as const, tv: 3 };

interface Decoded {
  iat: number;
  exp: number;
  sub: number;
  tv?: number;
  itv?: number;
  impersonatedBy?: number;
}

function build() {
  const jwt = new JwtService({ secret: 'test-secret' });
  const sign = jest.spyOn(jwt, 'sign');
  return { deps: { jwt }, jwt, sign };
}

function decode(jwt: JwtService, token: string): Decoded {
  return jwt.decode<Decoded>(token);
}

describe('ROK-1823 U2 signAccessToken — clock-only iat/exp', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('iat is floor(now) and exp is iat + the default ttl', () => {
    const t = build();
    const payload = decode(t.jwt, signAccessToken(t.deps, CLAIMS));
    expect(payload.iat).toBe(SECOND);
    expect(payload.exp).toBe(SECOND + ACCESS_TOKEN_TTL_SECONDS);
  });

  it('an explicit ttl is counted from the same clock read', () => {
    const t = build();
    const token = signAccessToken(t.deps, CLAIMS, { ttlSeconds: 120 });
    expect(decode(t.jwt, token).exp).toBe(SECOND + 120);
  });

  it('notAfter caps exp at its whole second', () => {
    const t = build();
    const notAfter = new Date(NOW.getTime() + 10 * 60 * 1000 + 900);
    const token = signAccessToken(t.deps, CLAIMS, { notAfter });
    expect(decode(t.jwt, token).exp).toBe(
      Math.floor(notAfter.getTime() / 1000),
    );
  });

  it('a notAfter later than iat + ttl leaves exp at iat + ttl', () => {
    const t = build();
    const notAfter = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    const token = signAccessToken(t.deps, CLAIMS, { notAfter });
    expect(decode(t.jwt, token).exp).toBe(SECOND + ACCESS_TOKEN_TTL_SECONDS);
  });

  it('notAfter inside the current second → BornExpiredTokenError, nothing signed', () => {
    const t = build();
    const notAfter = new Date(NOW.getTime() + 500);
    expect(() => signAccessToken(t.deps, CLAIMS, { notAfter })).toThrow(
      BornExpiredTokenError,
    );
    expect(t.sign).not.toHaveBeenCalled();
  });

  it('a notAfter already past also refuses to mint', () => {
    const t = build();
    const notAfter = new Date(NOW.getTime() - 5_000);
    expect(() => signAccessToken(t.deps, CLAIMS, { notAfter })).toThrow(
      BornExpiredTokenError,
    );
    expect(t.sign).not.toHaveBeenCalled();
  });
});

describe('ROK-1823 U2 signAccessToken — version claims', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('signs tv verbatim and adds no itv to a plain session token', () => {
    const t = build();
    const payload = decode(t.jwt, signAccessToken(t.deps, CLAIMS));
    expect(payload.tv).toBe(3);
    expect(payload).not.toHaveProperty('itv');
  });

  it('signs tv (target) and itv (impersonator) verbatim on an impersonation token', () => {
    const t = build();
    const claims = { ...CLAIMS, sub: 8, impersonatedBy: 7, tv: 0, itv: 12 };
    const payload = decode(t.jwt, signAccessToken(t.deps, claims));
    expect(payload).toMatchObject({
      sub: 8,
      impersonatedBy: 7,
      tv: 0,
      itv: 12,
    });
  });

  it('mint deps are the jwt signer only — no blocklist floor is consulted', () => {
    const t = build();
    signAccessToken(t.deps, CLAIMS);
    expect(Object.keys(t.deps)).toEqual(['jwt']);
    expect(t.sign).toHaveBeenCalledWith(
      { ...CLAIMS, iat: SECOND },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
  });
});
