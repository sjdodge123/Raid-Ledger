/**
 * ROK-2370 — sign-in code helpers (unit): the code alphabet and shape, the
 * normaliser a typed `/login code:` goes through, and the key builders.
 */
import {
  SIGNIN_CODE_ALPHABET,
  codeKey,
  approvalKey,
  deviceKey,
  generateDeviceSecret,
  generateSigninCode,
  hashDeviceSecret,
  normaliseSigninCode,
} from './signin-code.helpers';

const SHAPE = /^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/;

describe('generateSigninCode', () => {
  it('always yields XXXX-XXXX over the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateSigninCode()).toMatch(SHAPE);
    }
  });

  it('leaves out the look-alike characters 0 O 1 I L U', () => {
    for (const ch of ['0', 'O', '1', 'I', 'L', 'U']) {
      expect(SIGNIN_CODE_ALPHABET.includes(ch)).toBe(false);
    }
    expect(SIGNIN_CODE_ALPHABET).toHaveLength(30);
  });
});

describe('normaliseSigninCode', () => {
  it.each([
    ['abcd-efgh', 'ABCD-EFGH'],
    ['ABCDEFGH', 'ABCD-EFGH'],
    ['  abcd efgh ', 'ABCD-EFGH'],
    ['ab-cd-ef-gh', 'ABCD-EFGH'],
  ])('reads %p as %p', (typed, expected) => {
    expect(normaliseSigninCode(typed)).toBe(expected);
  });

  it('refuses a code holding a character outside the alphabet', () => {
    expect(normaliseSigninCode('ABCD-EFG0')).toBeNull();
    expect(normaliseSigninCode('ABCD-EFGI')).toBeNull();
  });

  it.each(['', 'ABC', 'ABCD-EFGHJ', 'ABCD_EFG!'])('refuses %p', (typed) => {
    expect(normaliseSigninCode(typed)).toBeNull();
  });
});

describe('device secret', () => {
  it('is at least 43 url-safe characters and differs per call', () => {
    const a = generateDeviceSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(generateDeviceSecret()).not.toBe(a);
  });

  it('hashes to a stable hex digest that is not the secret', () => {
    const s = generateDeviceSecret();
    expect(hashDeviceSecret(s)).toBe(hashDeviceSecret(s));
    expect(hashDeviceSecret(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeviceSecret(s)).not.toContain(s);
  });
});

describe('key builders', () => {
  it('namespace the code, approval and device index keys', () => {
    expect(codeKey('ABCD-EFGH')).toBe('signin-code:code:ABCD-EFGH');
    expect(approvalKey('ABCD-EFGH')).toBe('signin-code:ok:ABCD-EFGH');
    expect(deviceKey('ff')).toBe('signin-code:dev:ff');
  });
});
