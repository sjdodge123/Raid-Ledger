import {
  buildScheduledEventName,
  MAX_SCHEDULED_EVENT_NAME_LENGTH,
  type ScheduledEventData,
} from './scheduled-event.helpers';

/** Build a ScheduledEventData with sensible defaults the name builder ignores. */
function makeEventData(
  overrides: Partial<ScheduledEventData> = {},
): ScheduledEventData {
  return {
    title: 'Gamernight',
    description: null,
    startTime: '2026-06-10T20:00:00.000Z',
    endTime: '2026-06-10T23:00:00.000Z',
    signupCount: 1,
    maxAttendees: 3,
    game: null,
    ...overrides,
  };
}

describe('buildScheduledEventName (ROK-1350)', () => {
  it('exposes the Discord 100-char hard cap as a constant', () => {
    expect(MAX_SCHEDULED_EVENT_NAME_LENGTH).toBe(100);
  });

  it('returns the bare title when no game is set (game: null)', () => {
    const name = buildScheduledEventName(makeEventData({ game: null }));
    expect(name).toBe('Gamernight');
  });

  it('returns the bare title when game is undefined', () => {
    const name = buildScheduledEventName(makeEventData({ game: undefined }));
    expect(name).toBe('Gamernight');
  });

  it('appends the game with an em-dash separator when a game is set', () => {
    const name = buildScheduledEventName(
      makeEventData({ game: { name: 'HELLCARD' } }),
    );
    expect(name).toBe('Gamernight — HELLCARD');
  });

  it('does NOT append when the title already contains the game name (case-insensitive)', () => {
    const name = buildScheduledEventName(
      makeEventData({ title: 'HELLCARD night', game: { name: 'hellcard' } }),
    );
    expect(name).toBe('HELLCARD night');
  });

  it('does NOT double up when title contains the game name exactly', () => {
    const name = buildScheduledEventName(
      makeEventData({ title: 'HELLCARD', game: { name: 'HELLCARD' } }),
    );
    expect(name).toBe('HELLCARD');
  });

  it('truncates a combined name over 100 chars to 97 + ellipsis', () => {
    const title = 'T'.repeat(90);
    const game = 'G'.repeat(40);
    const name = buildScheduledEventName(
      makeEventData({ title, game: { name: game } }),
    );
    // combined = 90 + 3 (space-emdash-space) + 40 = 133 > 100 → truncate
    expect(name.length).toBe(MAX_SCHEDULED_EVENT_NAME_LENGTH);
    expect(name.endsWith('…')).toBe(true);
    expect(name.slice(0, 97)).toBe(`${title} — ${game}`.slice(0, 97));
  });

  it('does NOT truncate a combined name exactly at 100 chars', () => {
    // title(50) + ' — '(3) + game(47) = 100 exactly
    const title = 'T'.repeat(50);
    const game = 'G'.repeat(47);
    const name = buildScheduledEventName(
      makeEventData({ title, game: { name: game } }),
    );
    expect(name).toBe(`${title} — ${game}`);
    expect(name.length).toBe(100);
    expect(name.endsWith('…')).toBe(false);
  });
});
