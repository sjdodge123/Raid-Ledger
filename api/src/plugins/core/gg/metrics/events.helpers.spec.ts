import type * as schema from '../../../../drizzle/schema';
import {
  modeOf,
  summarizeEvents,
  summarizeOnTime,
  summarizeRhythm,
  type GgSignupRow,
} from './events.helpers';

type SignupRow = typeof schema.eventSignups.$inferSelect;

const START = Date.parse('2026-03-14T23:30:00Z');

function row(
  over: Partial<SignupRow> = {},
  extra: Partial<Omit<GgSignupRow, 'signup'>> = {},
): GgSignupRow {
  const signup: SignupRow = {
    id: 1,
    eventId: 1,
    userId: 7,
    discordUserId: null,
    discordUsername: null,
    discordAvatarHash: null,
    note: null,
    characterId: null,
    confirmationStatus: 'pending',
    status: 'signed_up',
    preferredRoles: null,
    attendanceStatus: null,
    attendanceSource: null,
    attendanceRecordedAt: null,
    roachedOutAt: null,
    runningLateAt: null,
    lateMinutes: null,
    signedUpAt: new Date(START),
    seriesSignupId: null,
    ...over,
  };
  return {
    signup,
    startMs: START,
    month: 3,
    weekday: 6,
    hour: 19,
    voiceLate: false,
    ...extra,
  };
}

describe('modeOf', () => {
  it('picks the most frequent value, breaking ties toward the smallest', () => {
    expect(modeOf([5, 2, 5, 2, 9])).toEqual({ value: 2, count: 2 });
    expect(modeOf([])).toBeNull();
  });
});

describe('summarizeEvents', () => {
  it('counts signed-up, attended, no-shows and excused with the app attendance resolver', () => {
    const rows = [
      row(
        { attendanceStatus: 'attended' },
        { startMs: Date.parse('2026-01-01T05:30:00Z') },
      ),
      row(
        { status: 'departed' },
        { startMs: Date.parse('2026-06-01T00:00:00Z') },
      ),
      row({ attendanceStatus: 'no_show' }),
      row({ status: 'declined' }),
      row({ status: 'tentative' }),
    ];
    expect(summarizeEvents(rows, 2)).toEqual({
      signedUp: 4,
      attended: 2,
      noShows: 1,
      excused: 1,
      created: 2,
      firstEventAt: '2026-01-01T05:30:00.000Z',
      lastEventAt: '2026-06-01T00:00:00.000Z',
    });
  });

  it('omits the card when the user neither signed up nor created anything', () => {
    expect(summarizeEvents([row({ status: 'declined' })], 0)).toBeNull();
  });
});

describe('summarizeOnTime', () => {
  it('counts attended rows with no late marker and no late voice session as on time', () => {
    const rows = [
      row({ attendanceStatus: 'attended' }),
      row({ attendanceStatus: 'attended' }, { voiceLate: true }),
      row({ attendanceStatus: 'attended', lateMinutes: 10 }),
      row({ attendanceStatus: 'attended' }),
      row({ attendanceStatus: 'no_show' }),
    ];
    expect(summarizeOnTime(rows)).toEqual({
      attended: 4,
      onTime: 2,
      onTimeRatio: 0.5,
    });
  });

  it('omits the card when nothing was attended', () => {
    expect(summarizeOnTime([row()])).toBeNull();
  });
});

describe('summarizeRhythm', () => {
  it('reports the busiest month and favourite weekday/hour of counted signups', () => {
    const rows = [
      row({}, { month: 1, weekday: 4, hour: 0 }),
      row({}, { month: 2, weekday: 4, hour: 20 }),
      row({}, { month: 2, weekday: 5, hour: 20 }),
      row({ status: 'declined' }, { month: 9, weekday: 1, hour: 9 }),
      row({ status: 'declined' }, { month: 9, weekday: 1, hour: 9 }),
    ];
    expect(summarizeRhythm(rows)).toEqual({
      busiestMonth: 2,
      busiestMonthEvents: 2,
      favouriteWeekday: 4,
      favouriteHour: 20,
    });
  });

  it('omits the card with no counted signups', () => {
    expect(summarizeRhythm([row({ status: 'declined' })])).toBeNull();
  });
});
