/**
 * ROK-1473 — the single "a match entered scheduling" hook.
 *
 * CONFIRMED FAILING on the branch base: the module does not exist. A match
 * flipped to `scheduling` (matching algorithm or bandwagon promotion) never
 * announced itself, so `SchedulingPollEmbedService` had nothing to react to
 * and the poll card was never posted.
 *
 * The hook is deliberately the ONLY announcement point: a third flip site
 * calls this function and inherits the Discord card for free.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  LINEUP_MATCH_EVENTS,
  fireMatchEnteredScheduling,
} from './lineups-scheduling-hook.helpers';

/** An emitter stub narrowed to the one method the hook uses. */
function createEmitter(emit: jest.Mock): EventEmitter2 {
  return { emit } as unknown as EventEmitter2;
}

describe('fireMatchEnteredScheduling (ROK-1473)', () => {
  let emit: jest.Mock;

  beforeEach(() => {
    emit = jest.fn().mockReturnValue(true);
  });

  it('emits one entered-scheduling event per match id', () => {
    fireMatchEnteredScheduling(createEmitter(emit), [7, 9]);

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(
      1,
      LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING,
      { matchId: 7 },
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING,
      { matchId: 9 },
    );
  });

  it('stays silent when no match entered scheduling', () => {
    fireMatchEnteredScheduling(createEmitter(emit), []);

    expect(emit).not.toHaveBeenCalled();
  });

  it('accepts a bare match id as well as a list', () => {
    fireMatchEnteredScheduling(createEmitter(emit), 42);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING, {
      matchId: 42,
    });
  });

  // D4: a failed announcement must never block the phase change that
  // produced it — the hook is called straight after the status write.
  it('swallows an emitter failure instead of failing the flip', () => {
    const boom = jest.fn(() => {
      throw new Error('listener exploded');
    });

    expect(() =>
      fireMatchEnteredScheduling(createEmitter(boom), [1, 2]),
    ).not.toThrow();
    // The second id is still announced after the first one throws.
    expect(boom).toHaveBeenCalledTimes(2);
  });
});
