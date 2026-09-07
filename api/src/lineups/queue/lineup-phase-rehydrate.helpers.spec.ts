/**
 * ROK-1512 — boot rehydration is per-item best-effort.
 *
 * `scheduleTransition` now RETHROWS a failed enqueue (it used to swallow it
 * into `logger.error`). Boot rehydration walks every active lineup, so an
 * unwrapped call means the FIRST bad lineup aborts the loop and every lineup
 * after it silently never gets its deadline job back. `rehydrateOneLineup`
 * therefore goes through `scheduleTransitionBestEffort`.
 *
 * Revert-proof: swap the helper back for a direct
 * `deps.queueService.scheduleTransition(...)` and the first case reports
 * `Expected: "resolved" / Received: "rejected: enqueue exploded for lineup 1"`
 * plus `Expected: [1, 2] / Received: [1]` for the scheduled ids.
 */
import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { rehydratePendingJobs } from './lineup-phase-rehydrate.helpers';
import type { LineupPhaseQueueService } from './lineup-phase.queue';

type Lineup = typeof schema.communityLineups.$inferSelect;

/** Minimal active lineup row with a phase deadline one hour out. */
function lineupRow(id: number): Lineup {
  return {
    id,
    status: 'building',
    phaseDeadline: new Date(Date.now() + 3_600_000),
    pendingAdvanceAt: null,
  } as unknown as Lineup;
}

/** `db.select().from().where()` resolving to the supplied rows. */
function fakeDb(rows: Lineup[]): PostgresJsDatabase<typeof schema> {
  return {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(rows) }),
    }),
  } as unknown as PostgresJsDatabase<typeof schema>;
}

const silentLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

describe('rehydratePendingJobs — per-lineup failure isolation (ROK-1512)', () => {
  it('rehydrates lineup B even though lineup A rejected its enqueue', async () => {
    const scheduledIds: number[] = [];
    const scheduleTransition = jest.fn((lineupId: number) => {
      scheduledIds.push(lineupId);
      return lineupId === 1
        ? Promise.reject(new Error('enqueue exploded for lineup 1'))
        : Promise.resolve();
    });
    const queueService = {
      scheduleTransition,
      scheduleGraceAdvance: jest.fn().mockResolvedValue(undefined),
    } as unknown as LineupPhaseQueueService;

    const outcome = await rehydratePendingJobs({
      db: fakeDb([lineupRow(1), lineupRow(2)]),
      queueService,
      logger: silentLogger,
    }).then(
      () => 'resolved' as const,
      (error: Error) => `rejected: ${error.message}`,
    );

    expect(outcome).toBe('resolved');
    expect(scheduledIds).toEqual([1, 2]);
    expect(scheduleTransition).toHaveBeenNthCalledWith(
      2,
      2,
      'voting',
      expect.any(Number),
    );
  });
});
