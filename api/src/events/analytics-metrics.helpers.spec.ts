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

// ─── Edge case helpers ───────────────────────────────────────────────────────

function testPreferDiscordUserIdWhenBothPresent() {
  // The signup has both a discordUserId and a userId.
  // Two voice sessions exist: one matching discordUserId='123', another
  // matching userId=1 (different session, lower duration).
  // The resolver must prefer the discordUserId match.
  const signup = createSignup({
    discordUserId: '123',
    userId: 1,
    username: 'linked-user',
  });
  const voiceByDiscord = createVoiceSession({
    id: 'uuid-discord',
    discordUserId: '123',
    userId: null,
    classification: 'full',
    totalDurationSec: 7200,
  });
  const voiceByUser = createVoiceSession({
    id: 'uuid-user',
    discordUserId: '999',
    userId: 1,
    classification: 'partial',
    totalDurationSec: 1800,
  });

  const result = buildRosterBreakdown([signup], [voiceByDiscord, voiceByUser]);

  expect(result).toHaveLength(1);
  // Must pick the discordUserId match (full, 7200s), not the userId match
  expect(result[0].voiceClassification).toBe('full');
  expect(result[0].voiceDurationSec).toBe(7200);
}

function testEmptySignupsReturnsEmptyArray() {
  const voice = createVoiceSession({ discordUserId: '123', userId: 5 });

  const result = buildRosterBreakdown([], [voice]);

  expect(result).toHaveLength(0);
}

function testEmptyVoiceSessionsNullsVoiceData() {
  const signups = [
    createSignup({ userId: 1, username: 'alice', discordUserId: '111' }),
    createSignup({ userId: 2, username: 'bob', discordUserId: null }),
  ];

  const result = buildRosterBreakdown(signups, []);

  expect(result).toHaveLength(2);
  for (const row of result) {
    expect(row.voiceClassification).toBeNull();
    expect(row.voiceDurationSec).toBeNull();
  }
}

function testAnonymousDiscordParticipantMatchesByDiscordUserId() {
  // Signup has discordUserId set but no RL userId (pure Discord participant).
  const signup = createSignup({
    discordUserId: '456',
    userId: null,
    discordUsername: 'DiscordOnly#0001',
    username: null,
  });
  const voice = createVoiceSession({
    discordUserId: '456',
    userId: null,
    classification: 'late',
    totalDurationSec: 2700,
  });

  const result = buildRosterBreakdown([signup], [voice]);

  expect(result).toHaveLength(1);
  expect(result[0].voiceClassification).toBe('late');
  expect(result[0].voiceDurationSec).toBe(2700);
  // Falls back to discordUsername when username is null
  expect(result[0].username).toBe('DiscordOnly#0001');
}

function testVoiceSessionWithNullClassification() {
  // Voice session exists and matches, but classification is null
  // (e.g., still in progress or not yet classified).
  const signup = createSignup({ discordUserId: '789', userId: 3 });
  const voice = createVoiceSession({
    discordUserId: '789',
    userId: 3,
    classification: null,
    totalDurationSec: 500,
  });

  const result = buildRosterBreakdown([signup], [voice]);

  expect(result).toHaveLength(1);
  // voiceClassification should be null — not a missing session, just unclassified
  expect(result[0].voiceClassification).toBeNull();
  // Duration is still populated — the session matched
  expect(result[0].voiceDurationSec).toBe(500);
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

  it(
    'prefers discordUserId match over userId match when both are present',
    testPreferDiscordUserIdWhenBothPresent,
  );

  it(
    'returns empty array when signups array is empty',
    testEmptySignupsReturnsEmptyArray,
  );

  it(
    'returns null voice data for all signups when voiceSessions is empty',
    testEmptyVoiceSessionsNullsVoiceData,
  );

  it(
    'matches anonymous Discord participant (userId=null) by discordUserId',
    testAnonymousDiscordParticipantMatchesByDiscordUserId,
  );

  it(
    'returns null voiceClassification when matched session has classification=null',
    testVoiceSessionWithNullClassification,
  );
});

describe('buildAttendanceSummary', () => {
  it(
    'correctly counts attended/noShow/excused/unmarked',
    testAttendanceSummaryCounts,
  );

  it('returns zero attendanceRate when no signups are marked', () => {
    const signups = [{ attendanceStatus: null }, { attendanceStatus: null }];

    const result = buildAttendanceSummary(signups);

    expect(result.attended).toBe(0);
    expect(result.noShow).toBe(0);
    expect(result.excused).toBe(0);
    expect(result.unmarked).toBe(2);
    expect(result.total).toBe(2);
    expect(result.attendanceRate).toBe(0);
  });

  it('returns zero counts and zero attendanceRate for empty signups', () => {
    const result = buildAttendanceSummary([]);

    expect(result.attended).toBe(0);
    expect(result.noShow).toBe(0);
    expect(result.excused).toBe(0);
    expect(result.unmarked).toBe(0);
    expect(result.total).toBe(0);
    expect(result.attendanceRate).toBe(0);
  });

  it('returns attendanceRate=1 when all marked signups attended', () => {
    const signups = [
      { attendanceStatus: 'attended' },
      { attendanceStatus: 'attended' },
      { attendanceStatus: 'attended' },
    ];

    const result = buildAttendanceSummary(signups);

    expect(result.attended).toBe(3);
    expect(result.unmarked).toBe(0);
    expect(result.attendanceRate).toBe(1);
  });
});
