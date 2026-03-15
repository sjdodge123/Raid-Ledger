import {
  calculateGracePeriodMs,
  isWithinGracePeriod,
} from './recruitment-reminder.helpers';

const HOUR = 60 * 60 * 1000;

describe('calculateGracePeriodMs', () => {
  it('should return 0 for events created >= 72h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-14T10:00:00Z'; // 96h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(0);
  });

  it('should return 0 at exactly 72h boundary', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-13T10:00:00Z'; // exactly 72h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(0);
  });

  it('should return 12h for events created 48-72h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-12T20:00:00Z'; // 58h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(12 * HOUR);
  });

  it('should return 12h at exactly 48h boundary', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-12T10:00:00Z'; // exactly 48h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(12 * HOUR);
  });

  it('should return 6h for events created 24-48h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-11T16:00:00Z'; // 30h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(6 * HOUR);
  });

  it('should return 6h at exactly 24h boundary', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-11T10:00:00Z'; // exactly 24h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(6 * HOUR);
  });

  it('should return 3h for events created 12-24h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-11T04:00:00Z'; // 18h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(3 * HOUR);
  });

  it('should return 3h at exactly 12h boundary', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-10T22:00:00Z'; // exactly 12h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(3 * HOUR);
  });

  it('should return 1h for events created < 12h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-10T20:00:00Z'; // 10h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(1 * HOUR);
  });

  it('should return 1h for events created 1h before start', () => {
    const createdAt = '2026-03-10T10:00:00Z';
    const startTime = '2026-03-10T11:00:00Z'; // 1h

    expect(calculateGracePeriodMs(createdAt, startTime)).toBe(1 * HOUR);
  });
});

/** Helper to build a minimal EligibleEvent for isWithinGracePeriod tests. */
function makeGraceEvent(createdAt: string, startTime: string) {
  return {
    id: 1,
    title: 'Test',
    gameId: 1,
    gameName: 'Test',
    creatorId: 1,
    startTime,
    maxAttendees: null,
    signupCount: 0,
    channelId: 'ch',
    guildId: 'g',
    messageId: 'm',
    createdAt,
  };
}

describe('isWithinGracePeriod', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return false when event was created >= 72h before start (no grace)', () => {
    jest.setSystemTime(new Date('2026-03-10T10:05:00Z'));
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-14T10:00:00Z',
    );

    expect(isWithinGracePeriod(event)).toBe(false);
  });

  it('should return true when within grace period (24-48h tier, < 6h since creation)', () => {
    jest.setSystemTime(new Date('2026-03-10T12:00:00Z')); // 2h after creation
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-11T16:00:00Z',
    );

    expect(isWithinGracePeriod(event)).toBe(true);
  });

  it('should return false when grace period has elapsed', () => {
    jest.setSystemTime(new Date('2026-03-10T17:00:00Z')); // 7h after creation
    const event = makeGraceEvent(
      '2026-03-10T10:00:00Z',
      '2026-03-11T16:00:00Z',
    );

    expect(isWithinGracePeriod(event)).toBe(false);
  });
});
