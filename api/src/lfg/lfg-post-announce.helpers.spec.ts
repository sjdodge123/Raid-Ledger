/**
 * ROK-2352 — the GROUP_CHANGED emits of `POST /lfg` name the keyed group they
 * belong to, so the board re-renders (and the spawn attaches) THAT group's
 * post rather than the Any one. The `''` group omits the key, exactly as
 * before groups existed.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import { announceLfgPost } from './lfg-post-announce.helpers';
import type { GroupPostOutcome } from './lfg-post-outcome.helpers';
import type { LfgIntentRow } from './lfg-write.helpers';
import { LFG_EVENTS } from './lfg.constants';

function hand(groupKey: string): LfgIntentRow {
  return {
    id: 1,
    userId: 7,
    gameId: 42,
    urgency: 'week',
    ttlMinutes: null,
    groupKey,
  } as LfgIntentRow;
}

function outcome(
  groupKey: string,
  over: Partial<GroupPostOutcome>,
  activeCount: number,
): GroupPostOutcome {
  return {
    inserted: null,
    row: hand(groupKey),
    group: { activeCount, playingNow: null } as LfgGroupSummaryDto,
    refreshed: false,
    bumped: false,
    ...over,
  };
}

function emitter(): { bus: EventEmitter2; emit: jest.Mock } {
  const emit = jest.fn();
  return { bus: { emit } as unknown as EventEmitter2, emit };
}

function groupChanged(emit: jest.Mock): unknown[] {
  return emit.mock.calls
    .filter(([name]) => name === LFG_EVENTS.GROUP_CHANGED)
    .map(([, payload]) => payload as unknown);
}

describe('announceLfgPost — GROUP_CHANGED carries the group (ROK-2352)', () => {
  it('a keyed bump names its group', () => {
    const { bus, emit } = emitter();

    announceLfgPost(bus, 42, outcome('raid:409', { bumped: true }, 2));

    expect(groupChanged(emit)).toEqual([
      { gameId: 42, reason: 'bumped', groupKey: 'raid:409' },
    ]);
  });

  it('an Any bump omits the key', () => {
    const { bus, emit } = emitter();

    announceLfgPost(bus, 42, outcome('', { bumped: true }, 2));

    expect(groupChanged(emit)).toEqual([{ gameId: 42, reason: 'bumped' }]);
  });

  it('a lone bump (no post yet) emits nothing', () => {
    const { bus, emit } = emitter();

    announceLfgPost(bus, 42, outcome('raid:409', { bumped: true }, 1));

    expect(groupChanged(emit)).toEqual([]);
  });

  it('a keyed join names its group', () => {
    const { bus, emit } = emitter();
    const inserted = hand('dungeon:36');

    announceLfgPost(bus, 42, outcome('dungeon:36', { inserted }, 3));

    expect(groupChanged(emit)).toEqual([
      { gameId: 42, reason: 'joined', userIds: [7], groupKey: 'dungeon:36' },
    ]);
  });

  it('an Any join omits the key', () => {
    const { bus, emit } = emitter();

    announceLfgPost(bus, 42, outcome('', { inserted: hand('') }, 3));

    expect(groupChanged(emit)).toEqual([
      { gameId: 42, reason: 'joined', userIds: [7] },
    ]);
  });
});
