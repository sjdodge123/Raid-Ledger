import { createHash } from 'crypto';
import { hashToken, mintToken, TOKEN_PATTERN } from './tokens';

describe('instance tokens (ROK-1671 AC 8)', () => {
  it('mints 1,000 unique tokens that all match rlh_ + 43 base64url chars', () => {
    const tokens = Array.from({ length: 1000 }, () => mintToken());
    expect(new Set(tokens).size).toBe(1000);
    for (const token of tokens) {
      expect(token).toMatch(/^rlh_[A-Za-z0-9_-]{43}$/);
      expect(token).toMatch(TOKEN_PATTERN);
    }
  });

  it('hashes the full rlh_ string with SHA-256 hex', () => {
    const token = mintToken();
    const expected = createHash('sha256').update(token).digest('hex');
    expect(hashToken(token)).toBe(expected);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes differ for different tokens and never contain the token', () => {
    const a = mintToken();
    const b = mintToken();
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(hashToken(a)).not.toContain(a.slice(4));
  });
});
