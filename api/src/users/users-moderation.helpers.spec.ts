/**
 * Unit tests for the moderation DB-write helpers (ROK-313 §3b). Uses the shared
 * drizzle-mock: the real idempotency (the `IS NULL` / `IS NOT NULL` WHERE guards)
 * is proven against Postgres in users-moderation.integration.spec.ts; here we
 * assert the contract the orchestrator depends on — a row is returned on a state
 * change and `undefined` when no row matched — plus the SET payload shape.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  banUserById,
  kickUserById,
  unbanUserById,
  unkickUserById,
} from './users-moderation.helpers';

let db: MockDb;
const asDb = () => db as unknown as PostgresJsDatabase<typeof schema>;
const ROW = { id: 5, username: 'Bob', discordId: '123' };

beforeEach(() => {
  db = createDrizzleMock();
});

describe('kickUserById', () => {
  it('returns the row and sets kicked_at + reason on a state change', async () => {
    db.returning.mockResolvedValue([ROW]);
    const row = await kickUserById(asDb(), 5, 'spam');
    expect(row).toEqual(ROW);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        kickedAt: expect.anything(),
        kickReason: 'spam',
      }),
    );
  });

  it('returns undefined when already kicked/banned (no row)', async () => {
    db.returning.mockResolvedValue([]);
    expect(await kickUserById(asDb(), 5)).toBeUndefined();
  });
});

describe('banUserById', () => {
  it('sets banned_at, COALESCEs deactivated_at, and clears any kick', async () => {
    db.returning.mockResolvedValue([ROW]);
    const row = await banUserById(asDb(), 5, 'abuse');
    expect(row).toEqual(ROW);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        bannedAt: expect.anything(),
        banReason: 'abuse',
        deactivatedAt: expect.anything(),
        kickedAt: null,
        kickReason: null,
      }),
    );
  });

  it('returns undefined when already banned', async () => {
    db.returning.mockResolvedValue([]);
    expect(await banUserById(asDb(), 5)).toBeUndefined();
  });
});

describe('unkickUserById / unbanUserById idempotency', () => {
  it('unkick returns undefined when there was no kick to clear', async () => {
    db.returning.mockResolvedValue([]);
    expect(await unkickUserById(asDb(), 5)).toBeUndefined();
  });

  it('unban returns undefined when there was no ban to clear', async () => {
    db.returning.mockResolvedValue([]);
    expect(await unbanUserById(asDb(), 5)).toBeUndefined();
  });

  it('unkick clears kicked_at + reason when a kick existed', async () => {
    db.returning.mockResolvedValue([ROW]);
    const row = await unkickUserById(asDb(), 5);
    expect(row).toEqual(ROW);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ kickedAt: null, kickReason: null }),
    );
  });
});
