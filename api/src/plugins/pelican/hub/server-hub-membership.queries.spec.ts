/**
 * ROK-1831 fix r1b — `upsertSighting` SQL shape: a touch (`rejoin=false`)
 * bumps `last_seen_at` but never writes `left_at` and skips a Left row; a
 * rejoin clears `left_at` unconditionally.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import { upsertSighting } from './server-hub-membership.queries';

interface Captured {
  set: Record<string, unknown>;
  setWhere?: unknown;
}

/** A fake insert chain that records the `onConflictDoUpdate` config. */
function fakeDb(): { db: PostgresJsDatabase<typeof schema>; seen: Captured[] } {
  const seen: Captured[] = [];
  const chain = {
    values: () => chain,
    onConflictDoUpdate: (cfg: Captured) => {
      seen.push(cfg);
      return Promise.resolve();
    },
  };
  const db = { insert: () => chain } as unknown as PostgresJsDatabase<typeof schema>;
  return { db, seen };
}

const S = { guildId: 9, userId: 11, characterName: 'Bjorn', at: new Date('2026-10-18T12:00:00Z') };

describe('upsertSighting', () => {
  it('touch: updates last_seen_at, never sets left_at, skips a Left row', async () => {
    const { db, seen } = fakeDb();
    await upsertSighting(db, S, false);
    const [cfg] = seen;
    expect(cfg?.set).toHaveProperty('lastSeenAt');
    expect(cfg?.set).not.toHaveProperty('leftAt');
    expect(cfg?.setWhere).toBeDefined();
  });

  it('rejoin: clears left_at with no row filter', async () => {
    const { db, seen } = fakeDb();
    await upsertSighting(db, S, true);
    const [cfg] = seen;
    expect(cfg?.set).toHaveProperty('leftAt', null);
    expect(cfg?.setWhere).toBeUndefined();
  });
});
