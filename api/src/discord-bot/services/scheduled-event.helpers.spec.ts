import {
  buildScheduledEventName,
  buildScheduledEventNameWithTime,
  buildEphemeralChannelName,
  stripTrailingEventWord,
  EPHEMERAL_CHANNEL_MARKER,
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

describe('stripTrailingEventWord (ephemeral display de-dupe)', () => {
  it('drops a trailing standalone " Event" word', () => {
    expect(stripTrailingEventWord('HELLCARD Event')).toBe('HELLCARD');
    expect(stripTrailingEventWord('Launch Event')).toBe('Launch');
  });

  it('is case-insensitive on the trailing word', () => {
    expect(stripTrailingEventWord('HELLCARD EVENT')).toBe('HELLCARD');
    expect(stripTrailingEventWord('hellcard event')).toBe('hellcard');
  });

  it('does NOT strip a non-standalone "Event" substring', () => {
    expect(stripTrailingEventWord('Eventful')).toBe('Eventful');
    expect(stripTrailingEventWord('Event Horizon')).toBe('Event Horizon');
    expect(stripTrailingEventWord('HELLCARDEvent')).toBe('HELLCARDEvent');
  });

  it('only removes a SINGLE trailing "Event"', () => {
    expect(stripTrailingEventWord('My Event Event')).toBe('My Event');
  });

  it('keeps the original when stripping would leave it empty/blank', () => {
    expect(stripTrailingEventWord('Event')).toBe('Event');
    expect(stripTrailingEventWord('  Event')).toBe('  Event');
  });

  it('returns names without a trailing "Event" unchanged', () => {
    expect(stripTrailingEventWord('Friday Raid — WoW')).toBe(
      'Friday Raid — WoW',
    );
    expect(stripTrailingEventWord('Gamernight')).toBe('Gamernight');
  });
});

describe('buildEphemeralChannelName (ROK-1352)', () => {
  it('prefixes the clock marker onto the SE name', () => {
    const name = buildEphemeralChannelName(
      makeEventData({ title: 'Friday Raid', game: { name: 'WoW' } }),
    );
    expect(name).toBe(`${EPHEMERAL_CHANNEL_MARKER} Friday Raid — WoW`);
  });

  it('prefixes the marker onto a bare title (no game)', () => {
    const name = buildEphemeralChannelName(makeEventData({ game: null }));
    expect(name).toBe(`${EPHEMERAL_CHANNEL_MARKER} Gamernight`);
  });

  it('keeps the whole name within the Discord 100-char cap (marker included)', () => {
    const title = 'T'.repeat(90);
    const game = 'G'.repeat(40);
    const name = buildEphemeralChannelName(
      makeEventData({ title, game: { name: game } }),
    );
    expect(name.length).toBe(MAX_SCHEDULED_EVENT_NAME_LENGTH);
    expect(name.startsWith(EPHEMERAL_CHANNEL_MARKER)).toBe(true);
    expect(name.endsWith('…')).toBe(true);
  });

  it('does NOT include the start-time suffix — the channel stays the clean join target', () => {
    const name = buildEphemeralChannelName(
      makeEventData({
        title: 'HELLCARD Event',
        startTime: '2026-06-14T21:35:00.000Z',
        game: null,
      }),
    );
    // Trailing redundant "Event" is dropped for the ephemeral channel display.
    expect(name).toBe(`${EPHEMERAL_CHANNEL_MARKER} HELLCARD`);
    expect(name).not.toContain('·');
    expect(name).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('drops a redundant trailing "Event" from the title', () => {
    const name = buildEphemeralChannelName(
      makeEventData({ title: 'Launch Event', game: null }),
    );
    expect(name).toBe(`${EPHEMERAL_CHANNEL_MARKER} Launch`);
  });
});

describe('buildScheduledEventNameWithTime (sidebar de-dupe)', () => {
  it('drops a redundant trailing "Event" then appends the start time after a middot', () => {
    const name = buildScheduledEventNameWithTime(
      makeEventData({
        title: 'HELLCARD Event',
        startTime: '2026-06-14T21:35:00.000Z',
        game: null,
      }),
      'UTC',
    );
    expect(name).toBe('HELLCARD · Sun 9:35 PM');
  });

  it('appends the time onto a variety-night base name (with game)', () => {
    const name = buildScheduledEventNameWithTime(
      makeEventData({
        title: 'Gamernight',
        startTime: '2026-06-14T21:35:00.000Z',
        game: { name: 'HELLCARD' },
      }),
      'UTC',
    );
    expect(name).toBe('Gamernight — HELLCARD · Sun 9:35 PM');
  });

  it('uses the bare title (no game) as the base before the time', () => {
    const name = buildScheduledEventNameWithTime(
      makeEventData({
        title: 'Variety Night',
        startTime: '2026-06-14T21:35:00.000Z',
        game: null,
      }),
      'UTC',
    );
    expect(name).toBe('Variety Night · Sun 9:35 PM');
  });

  it('honors a non-UTC configured timezone for the displayed time', () => {
    const name = buildScheduledEventNameWithTime(
      makeEventData({
        title: 'Raid',
        startTime: '2026-06-15T01:35:00.000Z',
        game: null,
      }),
      'America/New_York',
    );
    expect(name).toBe('Raid · Sun 9:35 PM');
  });

  it('truncates a base+time name over 100 chars to 99 + ellipsis', () => {
    const title = 'T'.repeat(100);
    const name = buildScheduledEventNameWithTime(
      makeEventData({
        title,
        startTime: '2026-06-14T21:35:00.000Z',
        game: null,
      }),
      'UTC',
    );
    expect(name.length).toBe(MAX_SCHEDULED_EVENT_NAME_LENGTH);
    expect(name.endsWith('…')).toBe(true);
  });
});
