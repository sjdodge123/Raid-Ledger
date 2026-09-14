/**
 * ROK-1499 (layer 1) — TDD pins for the ROOM summariser.
 *
 * Prod, 2026-09-13: `general-lobby` was occupied ~3h by three people playing
 * three different games, no quick-play group ever qualified, and the recap
 * therefore said "No session started." The recap's model was events-only.
 * These pins describe the ROOM instead: who was in voice and for how long, and
 * what they were playing WHILE they were in it.
 *
 * Every assertion is an exact second count — a summariser that is "roughly
 * right" is how a 2h stay gets reported as 3h.
 */
import {
  summariseRoom,
  type ActivitySegment,
  type OccupancySegment,
} from './channel-presence-room-recap.helpers';

const OPENED_AT = new Date('2026-09-13T18:00:00Z');
const ENDED_AT = new Date('2026-09-13T21:00:00Z');
const SPAN = { openedAt: OPENED_AT, endedAt: ENDED_AT };
const THREE_HOURS = 3 * 3600;

function at(iso: string): Date {
  return new Date(`2026-09-13T${iso}:00Z`);
}

function stay(
  discordUserId: string,
  displayName: string,
  joined: string,
  left: string | null,
): OccupancySegment {
  return {
    discordUserId,
    displayName,
    joinedAt: at(joined),
    leftAt: left === null ? null : at(left),
  };
}

function played(
  discordUserId: string,
  name: string,
  started: string,
  ended: string | null,
): ActivitySegment {
  return {
    discordUserId,
    name,
    startedAt: at(started),
    endedAt: ended === null ? null : at(ended),
  };
}

describe('summariseRoom — the span', () => {
  it('reports the opened→empty window even when nobody is left to describe', () => {
    expect(summariseRoom([], [], SPAN)).toEqual({
      spanMs: 3 * 3_600_000,
      members: [],
      activities: [],
    });
  });
});

describe('summariseRoom — members', () => {
  it('counts a lone member with no detected game', () => {
    const recap = summariseRoom([stay('1', 'roknua', '18:00', '19:00')], [], SPAN);
    expect(recap.members).toEqual([{ displayName: 'roknua', seconds: 3600 }]);
    expect(recap.activities).toEqual([]);
  });

  it('merges a member who left and re-joined into one entry', () => {
    const recap = summariseRoom(
      [
        stay('1', 'roknua', '18:00', '18:30'),
        stay('1', 'roknua', '19:00', '20:00'),
      ],
      [],
      SPAN,
    );
    expect(recap.members).toEqual([{ displayName: 'roknua', seconds: 5400 }]);
  });

  it('clamps a still-present member to the instant the room emptied', () => {
    const recap = summariseRoom([stay('1', 'roknua', '18:00', null)], [], SPAN);
    expect(recap.members).toEqual([
      { displayName: 'roknua', seconds: THREE_HOURS },
    ]);
  });

  it('clamps a member who was already in voice before the room opened', () => {
    const early = {
      discordUserId: '1',
      displayName: 'roknua',
      joinedAt: new Date('2026-09-13T16:00:00Z'),
      leftAt: at('19:00'),
    };
    expect(summariseRoom([early], [], SPAN).members).toEqual([
      { displayName: 'roknua', seconds: 3600 },
    ]);
  });

  it('orders members by longest stay first', () => {
    const recap = summariseRoom(
      [
        stay('1', 'roknua', '18:00', '18:30'),
        stay('2', 'hiphoptobop', '18:00', '20:00'),
        stay('3', 'vex', '18:00', '19:00'),
      ],
      [],
      SPAN,
    );
    expect(recap.members.map((m) => m.displayName)).toEqual([
      'hiphoptobop',
      'vex',
      'roknua',
    ]);
  });
});

describe('summariseRoom — activities', () => {
  it('clamps an activity that outlived the stay down to the stay', () => {
    const recap = summariseRoom(
      [stay('1', 'roknua', '18:00', '19:00')],
      // Started before they joined, still running when they left.
      [played('1', 'Path of Exile 2', '17:00', null)],
      SPAN,
    );
    expect(recap.activities).toEqual([
      { name: 'Path of Exile 2', seconds: 3600 },
    ]);
  });

  it('counts an activity only across the segments the member was actually in the room for', () => {
    const recap = summariseRoom(
      [
        stay('1', 'roknua', '18:00', '18:30'),
        stay('1', 'roknua', '19:00', '20:00'),
      ],
      // Playing straight through the gap; the 30m they were out does not count.
      [played('1', 'Path of Exile 2', '18:00', '20:00')],
      SPAN,
    );
    expect(recap.activities).toEqual([
      { name: 'Path of Exile 2', seconds: 5400 },
    ]);
  });

  it('sums the same game across members', () => {
    const recap = summariseRoom(
      [
        stay('1', 'roknua', '18:00', '19:00'),
        stay('2', 'vex', '18:00', '18:30'),
      ],
      [
        played('1', 'WoW Classic', '18:00', '19:00'),
        played('2', 'WoW Classic', '18:00', '18:30'),
      ],
      SPAN,
    );
    expect(recap.activities).toEqual([
      { name: 'WoW Classic', seconds: 5400 },
    ]);
  });

  it('keeps an unmapped activity name — a game with no game_id still happened', () => {
    const recap = summariseRoom(
      [stay('1', 'roknua', '18:00', '20:00')],
      [
        played('1', 'WoW Classic', '18:00', '19:00'),
        // No IGDB match: layer 2 passes the raw discord_activity_name through.
        played('1', 'Slay the Spire II', '19:00', '20:00'),
      ],
      SPAN,
    );
    expect(recap.activities).toEqual([
      { name: 'Slay the Spire II', seconds: 3600 },
      { name: 'WoW Classic', seconds: 3600 },
    ]);
  });

  it('ignores an activity from someone who was never in the room', () => {
    const recap = summariseRoom(
      [stay('1', 'roknua', '18:00', '19:00')],
      [played('99', 'Elden Ring', '18:00', '19:00')],
      SPAN,
    );
    expect(recap.activities).toEqual([]);
  });

  it('drops an activity that never overlapped the stay at all', () => {
    const recap = summariseRoom(
      [stay('1', 'roknua', '18:00', '19:00')],
      [played('1', 'Elden Ring', '19:30', '20:00')],
      SPAN,
    );
    expect(recap.activities).toEqual([]);
  });

  it('orders activities by time played, longest first', () => {
    const recap = summariseRoom(
      [
        stay('1', 'roknua', '18:00', '21:00'),
        stay('2', 'vex', '18:00', '21:00'),
      ],
      [
        played('1', 'Path of Exile 2', '18:00', '19:00'),
        played('2', 'WoW Classic', '18:00', '21:00'),
        played('1', 'Slay the Spire II', '19:00', '19:30'),
      ],
      SPAN,
    );
    expect(recap.activities).toEqual([
      { name: 'WoW Classic', seconds: THREE_HOURS },
      { name: 'Path of Exile 2', seconds: 3600 },
      { name: 'Slay the Spire II', seconds: 1800 },
    ]);
  });
});
