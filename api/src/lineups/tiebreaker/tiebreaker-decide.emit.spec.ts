/**
 * ROK-2272 S6: the non-transactional tiebreaker decide emits exactly one
 * `STATUS_CHANGED voting → decided` once its flip commits, and none when the
 * flip throws. (The finalize path's emit is `announceLineupDecided`.)
 */
import { LINEUP_LIFECYCLE_EVENTS } from '../lineup-events.constants';
import {
  announceLineupDecided,
  decideLineupFromTiebreaker,
  type TiebreakerDecideDeps,
} from './tiebreaker-decide.helpers';

jest.mock('../lineups-lifecycle.helpers', () => ({
  runMatchingAlgorithm: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../cohort-memory-write.helpers', () => ({
  writeDecidedCohortMemory: jest.fn().mockResolvedValue(undefined),
}));

const DECIDED = {
  lineupId: 12,
  from: 'voting',
  to: 'decided',
  standalone: false,
};

/**
 * `returning` resolves the `voting → decided` CAS rows; an empty result
 * makes the helper fall back to the unconditional write (awaited `where`).
 */
function buildDeps(returning: jest.Mock): {
  deps: TiebreakerDecideDeps;
  emit: jest.Mock;
  update: jest.Mock;
} {
  const emit = jest.fn();
  const where = jest.fn(() =>
    Object.assign(Promise.resolve(undefined), { returning }),
  );
  const update = jest.fn(() => ({ set: () => ({ where }) }));
  const deps = {
    db: { update },
    logger: { log: jest.fn(), warn: jest.fn() },
    events: { emit },
  } as unknown as TiebreakerDecideDeps;
  return { deps, emit, update };
}

function statusEmits(emit: jest.Mock): unknown[][] {
  return emit.mock.calls.filter(
    (c) => c[0] === LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED,
  );
}

describe('decideLineupFromTiebreaker — STATUS_CHANGED', () => {
  it('emits voting → decided once after the flip', async () => {
    const { deps, emit } = buildDeps(jest.fn().mockResolvedValue([{ id: 12 }]));
    await decideLineupFromTiebreaker(deps, 12, 99);
    expect(statusEmits(emit)).toEqual([
      [LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, DECIDED],
    ]);
  });

  it('emits nothing when the lineup was already decided (dismiss retry), but still writes', async () => {
    const { deps, emit, update } = buildDeps(jest.fn().mockResolvedValue([]));
    await decideLineupFromTiebreaker(deps, 12, 99);
    expect(statusEmits(emit)).toEqual([]);
    // The CAS missed, so the original unconditional write still ran.
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('emits nothing when the flip throws', async () => {
    const { deps, emit } = buildDeps(
      jest.fn().mockRejectedValue(new Error('db down')),
    );
    await expect(decideLineupFromTiebreaker(deps, 12, 99)).rejects.toThrow(
      'db down',
    );
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('announceLineupDecided — STATUS_CHANGED', () => {
  it('emits voting → decided once (after the finalize tx committed)', async () => {
    const { deps, emit } = buildDeps(jest.fn());
    await announceLineupDecided(deps, 12, {
      schedulingMatchIds: [],
      orphanedCards: [],
    });
    expect(statusEmits(emit)).toEqual([
      [LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, DECIDED],
    ]);
  });
});
