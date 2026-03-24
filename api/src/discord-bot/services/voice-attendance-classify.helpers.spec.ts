/**
 * Unit tests for shouldClassifyEvent() — ROK-943.
 *
 * Truth table:
 *   Case 1: no unclassified, no signups           => false
 *   Case 2: no unclassified, signups, 0 sessions  => true  (needs no_show creation)
 *   Case 3: no unclassified, signups, >0 sessions => true  (was BUG in ROK-943, now fixed)
 *   Case 4: has unclassified, no signups           => true
 *   Case 5: has unclassified, has signups          => true
 */
import { shouldClassifyEvent } from './voice-attendance-classify.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

describe('shouldClassifyEvent', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('returns false when no unclassified sessions and no signups', async () => {
    // Query 1: unclassified count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    // Query 2: signup count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    expect(result).toBe(false);
  });

  it('returns true when no unclassified sessions but signups exist with zero total sessions', async () => {
    // Query 1: unclassified count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    // Query 2: signup count => 3
    mockDb.where.mockResolvedValueOnce([{ count: 3 }]);
    // Query 3: total session count => 0 (no voice data at all, needs no_show creation)
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    expect(result).toBe(true);
  });

  it('returns true when all sessions classified but signups exist (THE BUG — ROK-943)', async () => {
    // Query 1: unclassified count => 0 (all sessions already classified)
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    // Query 2: signup count => 5 (signups exist that may need no_show creation)
    mockDb.where.mockResolvedValueOnce([{ count: 5 }]);
    // Query 3: total session count => 2 (sessions exist, all classified)
    mockDb.where.mockResolvedValueOnce([{ count: 2 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    // The pipeline must re-run to create no_show entries for signups
    // without voice sessions. The current code returns false here — BUG.
    expect(result).toBe(true);
  });

  it('returns true when unclassified sessions exist but no signups', async () => {
    // Query 1: unclassified count => 4
    mockDb.where.mockResolvedValueOnce([{ count: 4 }]);
    // Query 2: signup count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    expect(result).toBe(true);
  });

  it('returns true when both unclassified sessions and signups exist', async () => {
    // Query 1: unclassified count => 2
    mockDb.where.mockResolvedValueOnce([{ count: 2 }]);
    // Query 2: signup count => 3
    mockDb.where.mockResolvedValueOnce([{ count: 3 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    expect(result).toBe(true);
  });
});
