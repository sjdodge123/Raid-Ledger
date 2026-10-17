import { createHash } from 'node:crypto';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';
import { consumeTokenOnce, hashToken } from './single-use-token.helpers';

/**
 * ROK-1366 D3: one atomic single-use primitive for every consumable token
 * (intent tokens, magic links, link nonces): sha256(token) inserted into
 * consumed_intent_tokens with ON CONFLICT DO NOTHING RETURNING.
 */
describe('single-use-token.helpers', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('hashes with sha256 hex (fits the varchar(64) column)', () => {
    const expected = createHash('sha256').update('a.b.c').digest('hex');
    expect(hashToken('a.b.c')).toBe(expected);
    expect(hashToken('a.b.c')).toHaveLength(64);
  });

  it('returns true when the hash row is newly inserted', async () => {
    db.returning.mockResolvedValueOnce([{ id: 1 }]);
    await expect(consumeTokenOnce(db as never, 'a.b.c')).resolves.toBe(true);
    expect(db.insert).toHaveBeenCalledWith(schema.consumedIntentTokens);
    expect(db.values).toHaveBeenCalledWith({ tokenHash: hashToken('a.b.c') });
    expect(db.onConflictDoNothing).toHaveBeenCalled();
  });

  it('returns false when the hash was already consumed (conflict)', async () => {
    db.returning.mockResolvedValueOnce([]);
    await expect(consumeTokenOnce(db as never, 'a.b.c')).resolves.toBe(false);
  });

  it('never stores the raw token', async () => {
    db.returning.mockResolvedValueOnce([{ id: 1 }]);
    await consumeTokenOnce(db as never, 'raw.jwt.value');
    expect(JSON.stringify(db.values.mock.calls)).not.toContain('raw.jwt.value');
  });

  it('propagates DB errors to the caller', async () => {
    db.returning.mockRejectedValueOnce(new Error('connection lost'));
    await expect(consumeTokenOnce(db as never, 'a.b.c')).rejects.toThrow(
      'connection lost',
    );
  });
});
