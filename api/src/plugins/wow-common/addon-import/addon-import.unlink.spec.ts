import { ConflictException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { NotificationService } from '../../../notifications/notification.service';
import { AddonCharacterUnlinkService } from './addon-import.unlink';

/**
 * ROK-2128 (Codex P2) — a GUID-backed row moved by an admin Change owner
 * while the unlink waited on the GUID lock keeps its GUID, so the locked
 * re-read must re-check the OWNER too, or it deletes the new owner's row.
 */
const row = {
  id: 'char-1',
  userId: 1,
  gameId: 7,
  region: 'us',
  name: 'Thrall',
  addonGuid: 'Player-1-0001',
};

/** A chainable select whose awaited value comes from `results`, in order. */
function fakeTx(results: unknown[][]) {
  const remove = jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) }));
  const select = jest.fn(() => {
    const value = results.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'orderBy', 'for'])
      chain[m] = () => chain;
    chain.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve(value).then(ok);
    return chain;
  });
  const tx = { select, delete: remove, execute: jest.fn(), insert: jest.fn() };
  return { tx, remove };
}

function serviceFor(tx: unknown) {
  const db = {
    transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as PostgresJsDatabase<typeof schema>;
  const notifications = {} as NotificationService;
  return new AddonCharacterUnlinkService(db, notifications);
}

describe('AddonCharacterUnlinkService — GUID row owner re-check', () => {
  it('409s when the row changed owner (same GUID) before the lock', async () => {
    const moved = { ...row, userId: 2 };
    // read → no roster origin → locked re-read (moved by Change owner)
    const { tx, remove } = fakeTx([[row], [], [moved]]);
    await expect(serviceFor(tx).unlink(99, row.id)).rejects.toThrow(
      ConflictException,
    );
    expect(remove).not.toHaveBeenCalled();
  });
});
