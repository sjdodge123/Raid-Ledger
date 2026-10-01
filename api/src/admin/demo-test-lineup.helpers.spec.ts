import type { ModuleRef } from '@nestjs/core';
import { LineupPhaseQueueService } from '../lineups/queue/lineup-phase.queue';
import { cancelLineupPhaseJobsForTest } from './demo-test-lineup.helpers';

/**
 * MUTATION: pass a different id to `cancelAllForLineup`, or return a constant
 * instead of its count, and the case fails on the matching assertion.
 */
describe('cancelLineupPhaseJobsForTest', () => {
  it("cancels the lineup's phase jobs and returns the cancelled count", async () => {
    const cancelAllForLineup = jest.fn().mockResolvedValue(3);
    const get = jest.fn().mockReturnValue({ cancelAllForLineup });
    const moduleRef = { get } as unknown as ModuleRef;

    const count = await cancelLineupPhaseJobsForTest(moduleRef, 7);

    expect(count).toBe(3);
    expect(get).toHaveBeenCalledWith(LineupPhaseQueueService, {
      strict: false,
    });
    expect(cancelAllForLineup).toHaveBeenCalledTimes(1);
    expect(cancelAllForLineup).toHaveBeenCalledWith(7);
  });
});
