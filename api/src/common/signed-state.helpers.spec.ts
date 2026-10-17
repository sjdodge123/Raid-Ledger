import { createHmac } from 'node:crypto';
import {
  SIGNED_STATE_TTL_SECONDS,
  signState,
  verifyState,
  type SignedStatePurpose,
} from './signed-state.helpers';

const SECRET = 'signed-state-spec-secret-0123456789';
const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);
const PURPOSE: SignedStatePurpose = 'calendar-oauth';

function mint(payload: Record<string, unknown> = { uid: 7, n: 'nonce-1' }) {
  return signState(payload as { uid: number }, PURPOSE, { nowMs: T0 });
}

const originalSecret = process.env.JWT_SECRET;
beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
});
afterAll(() => {
  process.env.JWT_SECRET = originalSecret;
});

describe('signed-state helpers — round trip, tamper, expiry', () => {
  it('round-trips the payload with exp = now + 10 minutes', () => {
    const claims = verifyState(mint(), PURPOSE, { nowMs: T0 + 1000 });
    expect(claims).toEqual({
      uid: 7,
      n: 'nonce-1',
      exp: T0 / 1000 + SIGNED_STATE_TTL_SECONDS,
    });
    expect(SIGNED_STATE_TTL_SECONDS).toBe(600);
  });

  it('rejects a body changed under the original signature', () => {
    const [, signature] = mint().split('.');
    const forged = Buffer.from(
      JSON.stringify({ uid: 8, n: 'nonce-1', exp: T0 / 1000 + 600 }),
    ).toString('base64url');
    expect(
      verifyState(`${forged}.${signature}`, PURPOSE, { nowMs: T0 }),
    ).toBeNull();
  });

  it('rejects a changed or non-canonical signature', () => {
    const token = mint();
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(
      verifyState(token.slice(0, -1) + last, PURPOSE, { nowMs: T0 }),
    ).toBeNull();
    expect(verifyState(`${token}*`, PURPOSE, { nowMs: T0 })).toBeNull();
  });

  it('rejects an expired state and accepts one just inside the window', () => {
    const token = mint();
    const ttlMs = SIGNED_STATE_TTL_SECONDS * 1000;
    expect(
      verifyState(token, PURPOSE, { nowMs: T0 + ttlMs - 1000 }),
    ).not.toBeNull();
    expect(verifyState(token, PURPOSE, { nowMs: T0 + ttlMs })).toBeNull();
  });
});

describe('signed-state helpers — purpose, key, user, shape', () => {
  it('rejects a state verified under another purpose', () => {
    const other = 'steam-link' as SignedStatePurpose;
    expect(verifyState(mint(), other, { nowMs: T0 })).toBeNull();
  });

  it('rejects a body signed with the raw JWT_SECRET (Steam/Discord style key)', () => {
    const body = mint().split('.')[0] ?? '';
    const raw = createHmac('sha256', SECRET).update(body).digest('base64url');
    expect(verifyState(`${body}.${raw}`, PURPOSE, { nowMs: T0 })).toBeNull();
  });

  it('rejects a state after JWT_SECRET rotates', () => {
    const token = mint();
    process.env.JWT_SECRET = `${SECRET}-rotated`;
    expect(verifyState(token, PURPOSE, { nowMs: T0 })).toBeNull();
  });

  it.each([0, -1, 1.5, '7', null])('rejects a state whose uid is %p', (uid) => {
    expect(verifyState(mint({ uid }), PURPOSE, { nowMs: T0 })).toBeNull();
  });

  it.each(['', 'abc', 'a.b.c', '.', 'x'.repeat(3000)])(
    'rejects malformed input %#',
    (token) => {
      expect(verifyState(token, PURPOSE, { nowMs: T0 })).toBeNull();
    },
  );

  it('refuses to sign without JWT_SECRET', () => {
    delete process.env.JWT_SECRET;
    expect(() => mint()).toThrow('JWT_SECRET is not set');
  });
});
