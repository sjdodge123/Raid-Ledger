import { createHash } from 'node:crypto';
import {
  PREFIXED_TOKEN_BYTES,
  createPrefixedTokenKit,
  tokenHashesEqual,
} from './prefixed-token.helpers';

const PATTERN = /^rltk_[A-Za-z0-9_-]{43}$/;
const kit = createPrefixedTokenKit('rltk_', PATTERN);
const body = (c: string): string => c.repeat(43);

describe('createPrefixedTokenKit (ROK-1955)', () => {
  it('generates prefix + 43 base64url chars (32 bytes), all distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const token = kit.generate();
      expect(token).toMatch(PATTERN);
      seen.add(token);
    }
    expect(PREFIXED_TOKEN_BYTES).toBe(32);
    expect(seen.size).toBe(1000);
  });

  it('isToken checks the exact shape, including the prefix', () => {
    expect(kit.isToken(`rltk_${body('a')}`)).toBe(true);
    expect(kit.isToken(`rlvl_${body('a')}`)).toBe(false);
    expect(kit.isToken(`rltk_${'a'.repeat(42)}`)).toBe(false);
    expect(kit.isToken(`rltk_${'a'.repeat(44)}`)).toBe(false);
    expect(kit.isToken(` rltk_${body('a')}`)).toBe(false);
  });

  it('hash is sha256 hex of the utf8 token (known vector), never the plaintext', () => {
    expect(kit.hash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const token = kit.generate();
    const hash = kit.hash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hash).not.toContain(token.slice(5));
  });

  it('verify round-trips and rejects wrong prefix, short body and a different hash', () => {
    const token = kit.generate();
    const hash = kit.hash(token);
    expect(kit.verify(token, hash)).toBe(true);
    const wrongPrefix = `rlvl_${token.slice(5)}`;
    expect(kit.verify(wrongPrefix, kit.hash(wrongPrefix))).toBe(false);
    const short = token.slice(0, -1);
    expect(kit.verify(short, kit.hash(short))).toBe(false);
    expect(kit.verify(kit.generate(), hash)).toBe(false);
  });

  it('hintOf is the last 4 chars', () => {
    expect(kit.hintOf(`rltk_${'a'.repeat(39)}wxyz`)).toBe('wxyz');
  });

  it('refuses a pattern its own tokens cannot match', () => {
    expect(() => createPrefixedTokenKit('rlxx_', PATTERN)).toThrow(
      'prefixed-token: pattern does not match generated tokens',
    );
  });

  it('refuses a stateful (g / y) pattern, whose .test() would alternate', () => {
    const sticky = /^rltk_[A-Za-z0-9_-]{43}$/g;
    expect(() => createPrefixedTokenKit('rltk_', sticky)).toThrow(
      'prefixed-token: pattern must not use the g or y flag',
    );
  });
});

describe('tokenHashesEqual (ROK-1955)', () => {
  it('is false on a length mismatch without throwing', () => {
    expect(() => tokenHashesEqual('abc', 'abcd')).not.toThrow();
    expect(tokenHashesEqual('abc', 'abcd')).toBe(false);
    expect(tokenHashesEqual('', 'a')).toBe(false);
  });

  it('is true only for identical strings', () => {
    expect(tokenHashesEqual('abcd', 'abcd')).toBe(true);
    expect(tokenHashesEqual('abcd', 'abce')).toBe(false);
  });

  it('compares with crypto.timingSafeEqual', () => {
    jest.resetModules();
    const timingSafeEqual = jest.fn(() => true);
    jest.doMock('node:crypto', () => ({
      ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
      timingSafeEqual,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./prefixed-token.helpers') as typeof import('./prefixed-token.helpers');
    expect(mod.tokenHashesEqual('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    jest.dontMock('node:crypto');
  });
});
