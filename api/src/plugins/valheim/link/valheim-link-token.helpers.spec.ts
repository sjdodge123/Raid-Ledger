import {
  VALHEIM_LINK_TOKEN_PATTERN,
  generateValheimLinkToken,
  hashValheimLinkToken,
  isValheimLinkToken,
  tokenHashesEqual,
  tokenHintOf,
  verifyValheimLinkToken,
} from './valheim-link-token.helpers';

describe('valheim-link token helpers', () => {
  it('generates rlvl_ + 43 base64url chars, unique per call', () => {
    const a = generateValheimLinkToken();
    const b = generateValheimLinkToken();
    expect(a).toMatch(VALHEIM_LINK_TOKEN_PATTERN);
    expect(isValheimLinkToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('hashes to 64 lower-case hex chars, deterministically', () => {
    const token = generateValheimLinkToken();
    const hash = hashValheimLinkToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashValheimLinkToken(token)).toBe(hash);
  });

  it('verify round-trips and rejects a tampered token', () => {
    const token = generateValheimLinkToken();
    const hash = hashValheimLinkToken(token);
    const last = token.endsWith('A') ? 'B' : 'A';
    const tampered = `${token.slice(0, -1)}${last}`;
    expect(verifyValheimLinkToken(token, hash)).toBe(true);
    expect(verifyValheimLinkToken(tampered, hash)).toBe(false);
  });

  it('verify rejects a malformed token without hashing it', () => {
    expect(verifyValheimLinkToken('rlvl_short', 'a'.repeat(64))).toBe(false);
    expect(isValheimLinkToken(`rlvx_${'a'.repeat(43)}`)).toBe(false);
  });

  it('tokenHashesEqual is false on a length mismatch', () => {
    expect(tokenHashesEqual('abc', 'abcd')).toBe(false);
    expect(tokenHashesEqual('abcd', 'abcd')).toBe(true);
  });

  it('the hint is the last 4 chars', () => {
    expect(tokenHintOf(`rlvl_${'a'.repeat(39)}wxyz`)).toBe('wxyz');
  });
});
