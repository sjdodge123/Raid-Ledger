/**
 * ROK-1474 (C3) — the loader that hands the Discord decided card its reason.
 *
 * Every assertion here is about NOT speaking. The derivation itself lives in
 * `lineups-response-star.helpers` (lane A) and is mocked out, because the only
 * thing this seam owns is the question "is this lineup in a state where a
 * reason can honestly be told?" — a card that narrated a star victory for an
 * open ballot, a missing lineup, or a decided lineup with no winner would be
 * inventing an outcome.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { loadDecisionReason } from './lineup-decision-reason.helpers';
import * as starProjection from './lineups-response-star.helpers';

jest.mock('./lineups-response-star.helpers', () => ({
  loadStarCounts: jest.fn(),
  deriveDecisionReason: jest.fn(),
}));

const LINEUP_ID = 42;
const REASON = 'tied on votes 5–5, won on top picks 4–1';

const loadStarCounts = starProjection.loadStarCounts as jest.Mock;
const deriveDecisionReason = starProjection.deriveDecisionReason as jest.Mock;

describe('loadDecisionReason', () => {
  let db: MockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDrizzleMock();
    loadStarCounts.mockResolvedValue({ 1: 4, 2: 1 });
    deriveDecisionReason.mockResolvedValue(REASON);
  });

  function rowIs(row: unknown): void {
    db.limit.mockResolvedValue(row === null ? [] : [row]);
  }

  it('returns the derived reason for a decided lineup with a winner', async () => {
    rowIs({ id: LINEUP_ID, status: 'decided', decidedGameId: 1 });
    await expect(loadDecisionReason(db as never, LINEUP_ID)).resolves.toBe(
      REASON,
    );
  });

  it('passes the lineup row and the loaded star counts to the deriver', async () => {
    rowIs({ id: LINEUP_ID, status: 'decided', decidedGameId: 1 });
    await loadDecisionReason(db as never, LINEUP_ID);
    expect(deriveDecisionReason).toHaveBeenCalledWith(
      db,
      { id: LINEUP_ID, status: 'decided', decidedGameId: 1 },
      { 1: 4, 2: 1 },
    );
  });

  it('says nothing while the ballot is still open', async () => {
    rowIs({ id: LINEUP_ID, status: 'voting', decidedGameId: null });
    await expect(
      loadDecisionReason(db as never, LINEUP_ID),
    ).resolves.toBeNull();
    expect(deriveDecisionReason).not.toHaveBeenCalled();
  });

  it('says nothing when the lineup decided without naming a winner', async () => {
    rowIs({ id: LINEUP_ID, status: 'decided', decidedGameId: null });
    await expect(
      loadDecisionReason(db as never, LINEUP_ID),
    ).resolves.toBeNull();
    expect(deriveDecisionReason).not.toHaveBeenCalled();
  });

  it('says nothing when the lineup no longer exists', async () => {
    rowIs(null);
    await expect(
      loadDecisionReason(db as never, LINEUP_ID),
    ).resolves.toBeNull();
    expect(deriveDecisionReason).not.toHaveBeenCalled();
  });
});
