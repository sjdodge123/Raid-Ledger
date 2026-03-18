/**
 * Unit tests for analytics-metrics helper functions (ROK-852).
 *
 * Covers buildRosterBreakdown (discordUserId match, userId fallback,
 * no-match case) and buildAttendanceSummary status counting.
 */
import {
  buildRosterBreakdown,
  buildAttendanceSummary,
} from './analytics-metrics.helpers';

// ─── Factories ──────────────────────────────────────────────────────────────

function createVoiceSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    eventId: 1,
    userId: null as number | null,
    discordUserId: '123',
    discordUsername: 'TestUser#1234',
    firstJoinAt: new Date('2026-03-01T19:00:00Z'),
    lastLeaveAt: new Date('2026-03-01T21:00:00Z'),
    totalDurationSec: 7200,
    segments: [],
    classification: 'full' as string | null,
    ...overrides,
  };
}

function createSignup(overrides: Record<string, unknown> = {}) {
  return {
    userId: null as number | null,
    username: null as string | null,
    avatar: null as string | null,
    attendanceStatus: null as string | null,
    signupStatus: 'accepted' as string | null,
    discordUserId: null as string | null,
    discordUsername: null as string | null,
    ...overrides,
  };
}

// ─── buildRosterBreakdown ───────────────────────────────────────────────────

function testMatchByDiscordUserId() {
  const signup = createSignup({
    discordUserId: '123',
    discordUsername: 'TestUser#1234',
    userId: 1,
    username: 'testuser',
  });
  const voice = createVoiceSession({
    discordUserId: '123',
    userId: 1,
    classification: 'full',
    totalDurationSec: 7200,
  });

  const result = buildRosterBreakdown([signup], [voice]);

  expect(result).toHaveLength(1);
  expect(result[0].voiceClassification).toBe('full');
  expect(result[0].voiceDurationSec).toBe(7200);
}

function testMatchByUserIdWhenDiscordUserIdNull() {
  const signup = createSignup({
    userId: 1,
    username: 'webuser',
    discordUserId: null,
  });
  const voice = createVoiceSession({
    discordUserId: '123',
    userId: 1,
    classification: 'partial',
    totalDurationSec: 3600,
  });

  const result = buildRosterBreakdown([signup], [voice]);

  expect(result).toHaveLength(1);
  expect(result[0].voiceClassification).toBe('partial');
  expect(result[0].voiceDurationSec).toBe(3600);
}

function testNoMatchReturnsNullVoiceData() {
  const signup = createSignup({
    userId: 2,
    username: 'lonely',
    discordUserId: null,
  });
  const voice = createVoiceSession({
    discordUserId: '999',
    userId: 99,
  });

  const result = buildRosterBreakdown([signup], [voice]);

  expect(result).toHaveLength(1);
  expect(result[0].voiceClassification).toBeNull();
  expect(result[0].voiceDurationSec).toBeNull();
}

// ─── buildAttendanceSummary ─────────────────────────────────────────────────

function testAttendanceSummaryCounts() {
  const signups = [
    { attendanceStatus: 'attended' },
    { attendanceStatus: 'attended' },
    { attendanceStatus: 'no_show' },
    { attendanceStatus: 'excused' },
    { attendanceStatus: null },
  ];

  const result = buildAttendanceSummary(signups);

  expect(result.attended).toBe(2);
  expect(result.noShow).toBe(1);
  expect(result.excused).toBe(1);
  expect(result.unmarked).toBe(1);
  expect(result.total).toBe(5);
  expect(result.attendanceRate).toBe(0.5);
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('buildRosterBreakdown', () => {
  it(
    'matches signup to voice session by discordUserId',
    testMatchByDiscordUserId,
  );

  it(
    'matches signup by userId when discordUserId is null',
    testMatchByUserIdWhenDiscordUserIdNull,
  );

  it(
    'returns null voice data when no match found',
    testNoMatchReturnsNullVoiceData,
  );
});

describe('buildAttendanceSummary', () => {
  it(
    'correctly counts attended/noShow/excused/unmarked',
    testAttendanceSummaryCounts,
  );
});
