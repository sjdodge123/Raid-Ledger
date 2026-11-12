import { rankCoPlayers, type GgCoVoiceRow } from './people.helpers';

const seg = (from: string, to: string) => [
  {
    joinAt: `2026-03-01T${from}:00Z`,
    leaveAt: `2026-03-01T${to}:00Z`,
    durationSec: 0,
  },
];
const v = (
  eventId: number,
  userId: number,
  from: string,
  to: string,
): GgCoVoiceRow => ({
  eventId,
  userId,
  segments: seg(from, to),
});

describe('rankCoPlayers', () => {
  it('merges voice overlap and shared signups per co-player, never the owner', () => {
    const voice = [
      v(1, 7, '20:00', '22:00'),
      v(1, 8, '21:00', '23:00'),
      v(1, 9, '22:30', '23:00'),
      v(2, 9, '20:00', '21:00'),
    ];
    const signups = [
      { eventId: 1, userId: 7 },
      { eventId: 1, userId: 9 },
      { eventId: 3, userId: 7 },
      { eventId: 3, userId: 10 },
      { eventId: 4, userId: 11 },
    ];
    expect(rankCoPlayers(7, voice, signups)).toEqual([
      { userId: 8, sharedEvents: 1, sharedVoiceSeconds: 3600 },
      { userId: 9, sharedEvents: 1, sharedVoiceSeconds: 0 },
      { userId: 10, sharedEvents: 1, sharedVoiceSeconds: 0 },
    ]);
  });

  it('ranks by shared events, then voice time, then id', () => {
    const signups = [1, 2].flatMap((e) => [
      { eventId: e, userId: 1 },
      { eventId: e, userId: 5 },
    ]);
    signups.push({ eventId: 1, userId: 4 });
    const voice = [v(1, 1, '20:00', '21:00'), v(1, 4, '20:00', '21:00')];
    expect(rankCoPlayers(1, voice, signups).map((p) => p.userId)).toEqual([
      5, 4,
    ]);
  });

  it('is empty when the owner shared nothing', () => {
    expect(
      rankCoPlayers(
        1,
        [v(1, 2, '20:00', '21:00')],
        [{ eventId: 1, userId: 3 }],
      ),
    ).toEqual([]);
  });
});
