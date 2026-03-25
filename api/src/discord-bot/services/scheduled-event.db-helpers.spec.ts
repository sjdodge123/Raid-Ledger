/**
 * Tests for scheduled-event.db-helpers — findReconciliationCandidates batch limit (ROK-969).
 */
import { findReconciliationCandidates } from './scheduled-event.db-helpers';

function createQueryChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

describe('findReconciliationCandidates', () => {
  it('applies a batch limit of 5 to prevent API queue flooding (ROK-969)', async () => {
    const chain = createQueryChain([]);
    const mockDb = { select: jest.fn().mockReturnValue(chain) } as never;

    await findReconciliationCandidates(mockDb);

    expect(chain.limit).toHaveBeenCalledWith(5);
  });

  it('returns candidates from the query', async () => {
    const candidate = {
      id: 1,
      title: 'Test',
      description: null,
      startTime: '2026-04-01T00:00:00Z',
      endTime: '2026-04-01T02:00:00Z',
      gameId: 1,
      isAdHoc: false,
      notificationChannelOverride: null,
      signupCount: 0,
      maxAttendees: 10,
    };
    const chain = createQueryChain([candidate]);
    const mockDb = { select: jest.fn().mockReturnValue(chain) } as never;

    const result = await findReconciliationCandidates(mockDb);

    expect(result).toEqual([candidate]);
  });
});
