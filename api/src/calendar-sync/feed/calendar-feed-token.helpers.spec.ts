import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  FEED_TOKEN_PATTERN,
  findFeedUserByToken,
  generateFeedToken,
  hashFeedToken,
  hashesEqual,
} from './calendar-feed-token.helpers';

type Db = PostgresJsDatabase<typeof schema>;

describe('generateFeedToken', () => {
  it('mints 43 base64url chars matching FEED_TOKEN_PATTERN', () => {
    const token = generateFeedToken();
    expect(token).toHaveLength(43);
    expect(FEED_TOKEN_PATTERN.test(token)).toBe(true);
  });

  it('never repeats across many mints', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateFeedToken));
    expect(tokens.size).toBe(200);
  });
});

describe('hashFeedToken', () => {
  it('is sha256 lower-case hex (known vector)', () => {
    expect(hashFeedToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is stable for a token and differs between tokens', () => {
    const token = generateFeedToken();
    expect(hashFeedToken(token)).toBe(hashFeedToken(token));
    expect(hashFeedToken(token)).not.toBe(hashFeedToken(`${token}x`));
  });
});

describe('hashesEqual', () => {
  const hash = hashFeedToken('one');

  it('is true only for identical hashes', () => {
    expect(hashesEqual(hash, `${hash}`)).toBe(true);
    expect(hashesEqual(hash, hashFeedToken('two'))).toBe(false);
  });

  it('is false (not a throw) on a length mismatch', () => {
    expect(hashesEqual(hash, hash.slice(1))).toBe(false);
    expect(hashesEqual('', hash)).toBe(false);
  });
});

describe('findFeedUserByToken', () => {
  it.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(44)],
    ['a dot (path trick)', `${'a'.repeat(42)}.`],
    ['a .ics suffix left on', `${'a'.repeat(43)}.ics`],
  ])(
    'returns null for a malformed token (%s) without querying',
    async (_, token) => {
      const db = createDrizzleMock();
      expect(await findFeedUserByToken(db as unknown as Db, token)).toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    },
  );

  it('returns the owner when the stored hash matches', async () => {
    const token = generateFeedToken();
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([
      { userId: 7, tokenHash: hashFeedToken(token) },
    ]);
    expect(await findFeedUserByToken(db as unknown as Db, token)).toBe(7);
  });

  it('returns null for an unknown token', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([]);
    expect(
      await findFeedUserByToken(db as unknown as Db, generateFeedToken()),
    ).toBeNull();
  });
});
