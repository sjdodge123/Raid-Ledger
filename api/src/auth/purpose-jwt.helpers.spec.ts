import { JwtService } from '@nestjs/jwt';
import {
  derivePurposeSecret,
  signPurposeJwt,
  verifyPurposeJwt,
} from './purpose-jwt.helpers';

/**
 * ROK-1366 D1: purpose-bound JWTs are signed with
 * HMAC-SHA256(JWT_SECRET, "rl-jwt-purpose:<purpose>") so no generic
 * `jwtService.verify()` (which uses JWT_SECRET) can ever accept them.
 */
describe('purpose-jwt.helpers', () => {
  const jwt = new JwtService({ secret: 'base-secret' });

  beforeEach(() => {
    process.env.JWT_SECRET = 'base-secret';
  });

  it('derives a deterministic secret distinct per purpose and from the base', () => {
    const magic = derivePurposeSecret('base-secret', 'magic-link');
    expect(magic).toBe(derivePurposeSecret('base-secret', 'magic-link'));
    expect(magic).not.toBe('base-secret');
    expect(magic).not.toBe(
      derivePurposeSecret('base-secret', 'link-nonce:discord'),
    );
    expect(derivePurposeSecret('base-secret', 'link-nonce:discord')).not.toBe(
      derivePurposeSecret('base-secret', 'link-nonce:steam'),
    );
    expect(derivePurposeSecret('other-secret', 'magic-link')).not.toBe(magic);
  });

  it('round-trips a payload signed and verified for the same purpose', () => {
    const token = signPurposeJwt(jwt, 'magic-link', { sub: 7 }, '15m');
    expect(
      verifyPurposeJwt<{ sub: number }>(jwt, 'magic-link', token).sub,
    ).toBe(7);
  });

  it('gives every token a random 9-byte jti, so same-second mints differ', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now());
    let a: string, b: string;
    try {
      a = signPurposeJwt(jwt, 'magic-link', { sub: 7 }, '15m');
      b = signPurposeJwt(jwt, 'magic-link', { sub: 7 }, '15m');
    } finally {
      now.mockRestore();
    }
    expect(a).not.toBe(b);
    const jti = (t: string) => jwt.decode<Record<string, unknown>>(t).jti;
    expect(jti(a)).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]{12}$/));
  });

  it('is rejected by a plain JWT_SECRET verify (the 5 direct-verify sites)', () => {
    const token = signPurposeJwt(jwt, 'magic-link', { sub: 7 }, '15m');
    expect(() => jwt.verify(token)).toThrow('invalid signature');
  });

  it('is rejected when verified under another purpose', () => {
    const token = signPurposeJwt(jwt, 'link-nonce:discord', { sub: 7 }, 120);
    expect(() => verifyPurposeJwt(jwt, 'link-nonce:steam', token)).toThrow(
      'invalid signature',
    );
  });

  it('rejects a token signed with the base JWT_SECRET', () => {
    const plain = jwt.sign({ sub: 7, magicLink: true });
    expect(() => verifyPurposeJwt(jwt, 'magic-link', plain)).toThrow(
      'invalid signature',
    );
  });

  it('refuses to derive when JWT_SECRET is unset', () => {
    delete process.env.JWT_SECRET;
    expect(() => signPurposeJwt(jwt, 'magic-link', { sub: 7 }, '15m')).toThrow(
      'JWT_SECRET is not set',
    );
  });
});
