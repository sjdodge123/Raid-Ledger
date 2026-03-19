/**
 * Unit tests for push-content utility functions.
 * These build plaintext push notification previews for Discord mobile.
 */
import {
  buildEventPushContent,
  buildCancelledPushContent,
  buildCompletedPushContent,
  buildAdHocSpawnPushContent,
  buildAdHocCompletedPushContent,
} from './push-content';
import type { EmbedEventData } from '../services/discord-embed.factory';

const baseEvent: EmbedEventData = {
  id: 42,
  title: 'Raid Night',
  startTime: '2026-03-16T22:00:00.000Z',
  endTime: '2026-03-17T01:00:00.000Z',
  signupCount: 3,
  maxAttendees: 8,
  game: { name: 'Helldivers 2', coverUrl: null },
};

describe('buildEventPushContent', () => {
  it('should include title, game, date, and signup count with capacity', () => {
    const result = buildEventPushContent(baseEvent);
    expect(result).toContain('Raid Night');
    expect(result).toContain('Helldivers 2');
    expect(result).toContain('3/8 signed up');
    expect(result).toContain('Mar 16');
  });

  it('should not contain raw Discord tokens', () => {
    const result = buildEventPushContent(baseEvent);
    expect(result).not.toMatch(/<#\d+>/);
    expect(result).not.toMatch(/<@\d+>/);
    expect(result).not.toMatch(/<t:\d+:\w>/);
  });

  it('should not contain raw markdown', () => {
    const result = buildEventPushContent(baseEvent);
    expect(result).not.toMatch(/\*\*/);
    expect(result).not.toMatch(/~~/);
  });

  it('should omit game segment when no game is present', () => {
    const noGame = { ...baseEvent, game: null };
    const result = buildEventPushContent(noGame);
    expect(result).not.toContain('Helldivers 2');
    expect(result).toContain('Raid Night');
    expect(result).toContain('3/8 signed up');
  });

  it('should show count only without capacity when maxAttendees is null', () => {
    const unlimited = { ...baseEvent, maxAttendees: null };
    const result = buildEventPushContent(unlimited);
    expect(result).toContain('3 signed up');
    expect(result).not.toContain('/');
  });

  it('should show zero signups', () => {
    const empty = { ...baseEvent, signupCount: 0 };
    const result = buildEventPushContent(empty);
    expect(result).toContain('0/8 signed up');
  });

  it('should truncate long titles to keep within ~80 chars total', () => {
    const longTitle = {
      ...baseEvent,
      title: 'A'.repeat(100),
    };
    const result = buildEventPushContent(longTitle);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).toContain('...');
  });

  it('should be a single line (no newlines)', () => {
    const result = buildEventPushContent(baseEvent);
    expect(result).not.toContain('\n');
  });

  it('should use the provided timezone for date formatting (ROK-918)', () => {
    // Event at 2026-03-16T22:00:00Z = Mar 16, 6:00 PM in America/New_York (EDT)
    const result = buildEventPushContent(baseEvent, 'America/New_York');
    expect(result).toContain('Mar 16');
    expect(result).toContain('6:00');
    expect(result).toContain('PM');
  });

  it('should format with explicit UTC timezone (ROK-918)', () => {
    const result = buildEventPushContent(baseEvent, 'UTC');
    // 2026-03-16T22:00:00Z in UTC = 10:00 PM
    expect(result).toContain('10:00');
    expect(result).toContain('PM');
  });
});

describe('buildCancelledPushContent', () => {
  it('should include the title with cancelled prefix', () => {
    const result = buildCancelledPushContent('Raid Night');
    expect(result).toContain('Cancelled');
    expect(result).toContain('Raid Night');
  });

  it('should not contain raw markdown', () => {
    const result = buildCancelledPushContent('Raid Night');
    expect(result).not.toMatch(/\*\*/);
    expect(result).not.toMatch(/~~/);
  });
});

describe('buildCompletedPushContent', () => {
  it('should include the title with completed prefix', () => {
    const result = buildCompletedPushContent(baseEvent);
    expect(result).toContain('Completed');
    expect(result).toContain('Raid Night');
  });

  it('should include game name when present', () => {
    const result = buildCompletedPushContent(baseEvent);
    expect(result).toContain('Helldivers 2');
  });

  it('should omit game segment when no game is present', () => {
    const noGame = { ...baseEvent, game: null };
    const result = buildCompletedPushContent(noGame);
    expect(result).not.toContain('Helldivers 2');
    expect(result).toContain('Raid Night');
  });

  it('should not contain raw markdown', () => {
    const result = buildCompletedPushContent(baseEvent);
    expect(result).not.toMatch(/\*\*/);
    expect(result).not.toMatch(/~~/);
  });

  it('should not contain raw Discord tokens', () => {
    const result = buildCompletedPushContent(baseEvent);
    expect(result).not.toMatch(/<#\d+>/);
    expect(result).not.toMatch(/<@\d+>/);
    expect(result).not.toMatch(/<t:\d+:\w>/);
  });

  it('should truncate long titles to keep within ~80 chars total', () => {
    const longTitle = { ...baseEvent, title: 'A'.repeat(100) };
    const result = buildCompletedPushContent(longTitle);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).toContain('...');
  });
});

describe('buildAdHocSpawnPushContent', () => {
  const adHocEvent = {
    id: 1,
    title: 'Quick Session',
    gameName: 'Helldivers 2',
  };

  it('should include title, game, and player count', () => {
    const result = buildAdHocSpawnPushContent(adHocEvent, 3);
    expect(result).toContain('Quick Session');
    expect(result).toContain('Helldivers 2');
    expect(result).toContain('3 players');
  });

  it('should omit game when not present', () => {
    const noGame = { id: 1, title: 'Quick Session' };
    const result = buildAdHocSpawnPushContent(noGame, 3);
    expect(result).not.toContain('Helldivers 2');
    expect(result).toContain('Quick Session');
    expect(result).toContain('3 players');
  });

  it('should not contain raw Discord tokens', () => {
    const result = buildAdHocSpawnPushContent(adHocEvent, 3);
    expect(result).not.toMatch(/<#\d+>/);
    expect(result).not.toMatch(/<@\d+>/);
  });
});

describe('buildAdHocCompletedPushContent', () => {
  const adHocEvent = {
    id: 1,
    title: 'Quick Session',
    gameName: 'Helldivers 2',
  };

  it('should include title and duration', () => {
    const result = buildAdHocCompletedPushContent(adHocEvent, '1h 23m');
    expect(result).toContain('Quick Session');
    expect(result).toContain('Completed');
    expect(result).toContain('1h 23m');
  });

  it('should not contain raw markdown', () => {
    const result = buildAdHocCompletedPushContent(adHocEvent, '1h 23m');
    expect(result).not.toMatch(/\*\*/);
    expect(result).not.toMatch(/~~/);
  });
});
