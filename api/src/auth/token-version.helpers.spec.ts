import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  bumpTokenVersion,
  NEXT_TOKEN_VERSION,
  readTokenVersion,
} from './token-version.helpers';
import { revokeAllAndBumpTx } from './refresh/refresh-rotation.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const asDb = (m: MockDb) => m as unknown as Db;
const render = (q: Parameters<PgDialect['sqlToQuery']>[0]) =>
  new PgDialect().sqlToQuery(q).sql;

describe('ROK-1823 token-version helpers', () => {
  let db: MockDb;
  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('NEXT_TOKEN_VERSION increments the stored column by one', () => {
    expect(render(NEXT_TOKEN_VERSION)).toBe('"users"."token_version" + 1');
  });

  it('bumpTokenVersion increments in ONE UPDATE of users and returns the new value', async () => {
    db.returning.mockResolvedValueOnce([{ tokenVersion: 4 }]);
    await expect(bumpTokenVersion(asDb(db), 9)).resolves.toBe(4);
    expect(db.update).toHaveBeenCalledWith(schema.users);
    expect(db.set).toHaveBeenCalledWith({ tokenVersion: NEXT_TOKEN_VERSION });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('bumpTokenVersion throws, naming the user, when no row was updated', async () => {
    db.returning.mockResolvedValueOnce([]);
    await expect(bumpTokenVersion(asDb(db), 9)).rejects.toThrow(
      'cannot bump token version: user 9 not found',
    );
  });

  it('readTokenVersion returns the stored value', async () => {
    db.limit.mockResolvedValueOnce([{ tokenVersion: 3 }]);
    await expect(readTokenVersion(asDb(db), 9)).resolves.toBe(3);
  });

  it('readTokenVersion throws, naming the user, when the user is missing', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(readTokenVersion(asDb(db), 9)).rejects.toThrow(
      'cannot read token version: user 9 not found',
    );
  });
});

describe('ROK-1823 revokeAllAndBumpTx', () => {
  it('bumps first, then locks and revokes the refresh rows — all on the SAME tx', async () => {
    const tx = createDrizzleMock();
    tx.where
      .mockReturnValueOnce(tx) // bumpTokenVersion: chain continues to .returning
      .mockReturnValueOnce(Promise.resolve([])) // lockUserFamilies: no live family
      .mockReturnValueOnce(Promise.resolve(undefined)); // revokeActiveRows
    tx.returning.mockResolvedValueOnce([{ tokenVersion: 2 }]);
    await expect(revokeAllAndBumpTx(asDb(tx), 9)).resolves.toBe(2);
    expect(tx.selectDistinct).toHaveBeenCalledTimes(1);
    expect(tx.update.mock.calls.map(([table]) => table)).toEqual([
      schema.users,
      schema.refreshTokens,
    ]);
    expect(tx.set).toHaveBeenNthCalledWith(1, {
      tokenVersion: NEXT_TOKEN_VERSION,
    });
  });

  it('propagates a failed bump so the caller transaction rolls back', async () => {
    const tx = createDrizzleMock();
    tx.where.mockReturnValueOnce(tx); // bumpTokenVersion runs first and fails
    tx.returning.mockResolvedValueOnce([]);
    await expect(revokeAllAndBumpTx(asDb(tx), 9)).rejects.toThrow(
      'user 9 not found',
    );
  });
});
