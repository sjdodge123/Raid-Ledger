/**
 * TDB:1443 — `assembleSchedulePollResponse` runs the viewer's slot-conflict
 * lookup in parallel with the votes -> terminal-state chain. Terminal state
 * needs `votes`, so only `findSlotConflicts` can overlap it.
 */
jest.mock('./scheduling-query.helpers', () => ({
  findScheduleVotes: jest.fn(),
}));
jest.mock('./scheduling-conflict.helpers', () => ({
  findSlotConflicts: jest.fn(),
}));
jest.mock('./scheduling-poll-state.helpers', () => ({
  resolvePollTerminalState: jest.fn(),
}));
jest.mock('./scheduling-response.helpers', () => ({
  buildPollResponse: jest.fn().mockReturnValue({}),
  deriveIsStandalone: jest.fn().mockReturnValue(false),
}));
jest.mock('./scheduling-event.helpers', () => ({}));
jest.mock('../lineups-match-query.helpers', () => ({}));

import { findScheduleVotes } from './scheduling-query.helpers';
import { findSlotConflicts } from './scheduling-conflict.helpers';
import { resolvePollTerminalState } from './scheduling-poll-state.helpers';
import { assembleSchedulePollResponse } from './scheduling-poll-page.helpers';

const slots = [{ id: 11 }, { id: 12 }];
const inputs = {
  pollMatch: { status: 'scheduling', linkedEventId: null },
  lineup: undefined,
  members: [],
  slots,
  voterCount: 3,
} as unknown as Parameters<typeof assembleSchedulePollResponse>[1];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('assembleSchedulePollResponse (TDB:1443)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolvePollTerminalState as jest.Mock).mockResolvedValue({});
  });

  it('starts findSlotConflicts before the votes query settles', async () => {
    const votes = deferred<unknown[]>();
    (findScheduleVotes as jest.Mock).mockReturnValue(votes.promise);
    (findSlotConflicts as jest.Mock).mockResolvedValue([{ slotId: 12 }]);

    const pending = assembleSchedulePollResponse(
      {} as never,
      inputs,
      5,
      'member',
    );
    await Promise.resolve();
    const startedBeforeVotes = (findSlotConflicts as jest.Mock).mock.calls
      .length;
    votes.resolve([]);
    const result = await pending;

    expect(startedBeforeVotes).toBe(1);
    expect(findSlotConflicts).toHaveBeenCalledWith({}, 5, slots);
    expect(result.conflictingSlotIds).toEqual([12]);
  });

  it('skips the conflict lookup for an anonymous viewer', async () => {
    (findScheduleVotes as jest.Mock).mockResolvedValue([]);

    const result = await assembleSchedulePollResponse(
      {} as never,
      inputs,
      null,
      null,
    );

    expect(findSlotConflicts).not.toHaveBeenCalled();
    expect(resolvePollTerminalState).toHaveBeenCalledWith(
      {},
      inputs.pollMatch,
      undefined,
      slots,
      null,
      [],
    );
    expect(result.slotConflicts).toBeUndefined();
  });
});
