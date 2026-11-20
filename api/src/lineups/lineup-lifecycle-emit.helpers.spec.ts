/**
 * ROK-2272 S6: the lifecycle emit helpers fire once with the given payload,
 * skip a same-status transition, tolerate a missing bus, and never rethrow
 * a listener failure into the write path.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { LINEUP_LIFECYCLE_EVENTS } from './lineup-events.constants';
import { LINEUP_MATCH_EVENTS } from './lineups-scheduling-hook.helpers';
import {
  emitLineupCreated,
  emitLineupStatusChanged,
  emitPollCancelled,
  emitPollLockedIn,
  emitPollVotedFor,
  emitStandaloneLineupArchived,
  lineupSubjectFields,
} from './lineup-lifecycle-emit.helpers';

function makeBus(): { bus: EventEmitter2; emit: jest.Mock } {
  const emit = jest.fn();
  return { bus: { emit } as unknown as EventEmitter2, emit };
}

describe('lineup lifecycle emit helpers (ROK-2272 S6)', () => {
  it('emits CREATED once with the payload', () => {
    const { bus, emit } = makeBus();
    const payload = {
      lineupId: 4,
      visibility: 'private' as const,
      guildId: 2,
      standalone: false,
    };
    emitLineupCreated(bus, payload);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(LINEUP_LIFECYCLE_EVENTS.CREATED, payload);
  });

  it('emits STATUS_CHANGED with from/to, and nothing for a no-op edge', () => {
    const { bus, emit } = makeBus();
    const payload = {
      lineupId: 1,
      from: 'voting' as const,
      to: 'decided' as const,
      standalone: false,
    };
    emitLineupStatusChanged(bus, payload);
    emitLineupStatusChanged(bus, { ...payload, from: 'decided' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED,
      payload,
    );
  });

  it('emits the three poll events with their payloads', () => {
    const { bus, emit } = makeBus();
    emitPollVotedFor(bus, { id: 9, lineupId: 3 }, 7, 'yes');
    emitPollLockedIn(bus, { matchId: 9, eventId: null });
    emitPollCancelled(bus, { matchId: 9, lineupId: 3, reason: 'rain' });
    expect(emit.mock.calls).toEqual([
      [
        LINEUP_MATCH_EVENTS.POLL_VOTED,
        { matchId: 9, lineupId: 3, userId: 7, stance: 'yes' },
      ],
      [LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { matchId: 9, eventId: null }],
      [
        LINEUP_MATCH_EVENTS.POLL_CANCELLED,
        { matchId: 9, lineupId: 3, reason: 'rain' },
      ],
    ]);
  });

  it('is a no-op without a bus and swallows a throwing listener', () => {
    expect(() =>
      emitLineupCreated(undefined, {
        lineupId: 1,
        visibility: 'public',
        guildId: null,
        standalone: false,
      }),
    ).not.toThrow();
    const { bus, emit } = makeBus();
    emit.mockImplementation(() => {
      throw new Error('listener boom');
    });
    expect(() =>
      emitPollLockedIn(bus, { matchId: 1, eventId: 2 }),
    ).not.toThrow();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('lineupSubjectFields reads visibility, hub and the standalone flag off the row', () => {
    expect(
      lineupSubjectFields({
        visibility: 'public',
        guildId: 5,
        phaseDurationOverride: { standalone: true },
      }),
    ).toEqual({ visibility: 'public', guildId: 5, standalone: true });
    expect(
      lineupSubjectFields({
        visibility: 'private',
        guildId: null,
        phaseDurationOverride: null,
      }),
    ).toEqual({ visibility: 'private', guildId: null, standalone: false });
  });

  it('marks a standalone carrier archive as standalone decided → archived', () => {
    const { bus, emit } = makeBus();
    emitStandaloneLineupArchived(bus, 8);
    expect(emit.mock.calls).toEqual([
      [
        LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED,
        { lineupId: 8, from: 'decided', to: 'archived', standalone: true },
      ],
    ]);
  });
});
