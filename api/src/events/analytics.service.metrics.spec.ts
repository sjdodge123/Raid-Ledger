import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

let service: AnalyticsService;
let mockDb: Record<string, jest.Mock>;

const mockEventRow = {
  id: 10,
  title: 'Epic Raid',
  duration: [
    new Date('2026-01-15T18:00:00Z'),
    new Date('2026-01-15T21:00:00Z'),
  ],
  gameId: 3,
  gameName: 'World of Warcraft',
  gameCoverUrl: 'https://example.com/wow.jpg',
};

function buildSelectChain(resolvedValue: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      leftJoin: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(resolvedValue),
        }),
      }),
    }),
  };
}

function signupsChain(value: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      leftJoin: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(value),
      }),
    }),
  };
}

function voiceChain(value: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(value),
    }),
  };
}

function setupThreeSelects(
  event: unknown[],
  signups: unknown[],
  voice: unknown[],
) {
  mockDb.select
    .mockReturnValueOnce(buildSelectChain(event))
    .mockReturnValueOnce(signupsChain(signups))
    .mockReturnValueOnce(voiceChain(voice));
}

async function setupEach() {
  mockDb = {};
  const chainMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'leftJoin',
    'innerJoin',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'groupBy',
    'execute',
  ];
  for (const m of chainMethods) {
    mockDb[m] = jest.fn().mockReturnThis();
  }
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AnalyticsService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();
  service = module.get<AnalyticsService>(AnalyticsService);
}

function makeSignup(overrides: Record<string, unknown>) {
  return {
    userId: null,
    username: null,
    avatar: null,
    attendanceStatus: null,
    signupStatus: 'signed_up',
    discordUserId: null,
    discordUsername: null,
    ...overrides,
  };
}

function makeVoiceSession(overrides: Record<string, unknown>) {
  return {
    id: 1,
    eventId: 10,
    userId: 1,
    discordUserId: 'd1',
    discordUsername: 'A',
    firstJoinAt: new Date(),
    lastLeaveAt: new Date(),
    totalDurationSec: 100,
    segments: [],
    classification: 'full',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function testNotFound() {
  mockDb.select.mockReturnValueOnce(buildSelectChain([]));
  await expect(service.getEventMetrics(999)).rejects.toThrow(NotFoundException);
}

async function testBasicReturn() {
  setupThreeSelects([mockEventRow], [], []);
  const result = await service.getEventMetrics(10);
  expect(result.eventId).toBe(10);
  expect(result.title).toBe('Epic Raid');
}

async function testGameInfo() {
  setupThreeSelects([mockEventRow], [], []);
  const result = await service.getEventMetrics(10);
  expect(result.game).toMatchObject({
    id: 3,
    name: 'World of Warcraft',
    coverUrl: 'https://example.com/wow.jpg',
  });
}

async function testGameNull() {
  const noGame = {
    ...mockEventRow,
    gameId: null,
    gameName: null,
    gameCoverUrl: null,
  };
  setupThreeSelects([noGame], [], []);
  const result = await service.getEventMetrics(10);
  expect(result.game).toBeNull();
}

async function testAttendanceCounts() {
  const signups = [
    makeSignup({ userId: 1, username: 'Alice', attendanceStatus: 'attended' }),
    makeSignup({ userId: 2, username: 'Bob', attendanceStatus: 'attended' }),
    makeSignup({ userId: 3, username: 'Carol', attendanceStatus: 'no_show' }),
    makeSignup({ userId: 4, username: 'Dave', attendanceStatus: 'excused' }),
    makeSignup({ userId: 5, username: 'Eve', attendanceStatus: null }),
  ];
  setupThreeSelects([mockEventRow], signups, []);
  const result = await service.getEventMetrics(10);
  expect(result.attendanceSummary).toMatchObject({
    attended: 2,
    noShow: 1,
    excused: 1,
    unmarked: 1,
    total: 5,
  });
}

async function testAttendanceRate() {
  const signups = [
    makeSignup({ userId: 1, username: 'A', attendanceStatus: 'attended' }),
    makeSignup({ userId: 2, username: 'B', attendanceStatus: 'attended' }),
    makeSignup({ userId: 3, username: 'C', attendanceStatus: 'attended' }),
    makeSignup({ userId: 4, username: 'D', attendanceStatus: 'no_show' }),
    makeSignup({ userId: 5, username: 'E', attendanceStatus: 'excused' }),
  ];
  setupThreeSelects([mockEventRow], signups, []);
  const result = await service.getEventMetrics(10);
  expect(result.attendanceSummary.attendanceRate).toBe(0.6);
}

async function testAttendanceRateZero() {
  const signups = [makeSignup({ userId: 1, username: 'A' })];
  setupThreeSelects([mockEventRow], signups, []);
  const result = await service.getEventMetrics(10);
  expect(result.attendanceSummary.attendanceRate).toBe(0);
}

async function testVoiceSummaryNull() {
  setupThreeSelects([mockEventRow], [], []);
  const result = await service.getEventMetrics(10);
  expect(result.voiceSummary).toBeNull();
}

async function testVoiceSummaryPopulated() {
  const voice = [
    makeVoiceSession({
      id: 1,
      userId: 1,
      discordUserId: 'discord-1',
      discordUsername: 'Alice#1234',
      firstJoinAt: new Date('2026-01-15T18:05:00Z'),
      lastLeaveAt: new Date('2026-01-15T21:00:00Z'),
      totalDurationSec: 10500,
      classification: 'full',
    }),
    makeVoiceSession({
      id: 2,
      userId: 2,
      discordUserId: 'discord-2',
      discordUsername: 'Bob#5678',
      firstJoinAt: new Date('2026-01-15T18:30:00Z'),
      lastLeaveAt: new Date('2026-01-15T21:00:00Z'),
      totalDurationSec: 9000,
      classification: 'partial',
    }),
  ];
  setupThreeSelects([mockEventRow], [], voice);
  const result = await service.getEventMetrics(10);
  expect(result.voiceSummary).not.toBeNull();
  expect(result.voiceSummary!.totalTracked).toBe(2);
  expect(result.voiceSummary!.full).toBe(1);
  expect(result.voiceSummary!.partial).toBe(1);
  expect(result.voiceSummary!.sessions).toHaveLength(2);
}

async function testVoiceNullLastLeave() {
  const voice = [
    makeVoiceSession({
      discordUsername: 'Ongoing#1234',
      firstJoinAt: new Date('2026-01-15T18:05:00Z'),
      lastLeaveAt: null,
      totalDurationSec: 0,
      classification: 'partial',
    }),
  ];
  setupThreeSelects([mockEventRow], [], voice);
  const result = await service.getEventMetrics(10);
  expect(result.voiceSummary!.sessions[0].lastLeaveAt).toBeNull();
}

async function testRosterBreakdownWithVoice() {
  const signups = [
    makeSignup({
      userId: 1,
      username: 'Alice',
      attendanceStatus: 'attended',
      discordUserId: 'discord-1',
      discordUsername: 'Alice#1234',
    }),
  ];
  const voice = [
    makeVoiceSession({
      userId: 1,
      discordUserId: 'discord-1',
      discordUsername: 'Alice#1234',
      firstJoinAt: new Date('2026-01-15T18:05:00Z'),
      lastLeaveAt: new Date('2026-01-15T21:00:00Z'),
      totalDurationSec: 10500,
      classification: 'full',
    }),
  ];
  setupThreeSelects([mockEventRow], signups, voice);
  const result = await service.getEventMetrics(10);
  expect(result.rosterBreakdown).toHaveLength(1);
  expect(result.rosterBreakdown[0]).toMatchObject({
    userId: 1,
    username: 'Alice',
    attendanceStatus: 'attended',
    voiceClassification: 'full',
    voiceDurationSec: 10500,
  });
}

async function testRosterBreakdownNoVoice() {
  const signups = [makeSignup({ userId: 2, username: 'Bob' })];
  setupThreeSelects([mockEventRow], signups, []);
  const result = await service.getEventMetrics(10);
  expect(result.rosterBreakdown[0].voiceClassification).toBeNull();
  expect(result.rosterBreakdown[0].voiceDurationSec).toBeNull();
}

async function testDiscordUsernameFallback() {
  const signups = [
    makeSignup({
      discordUserId: 'discord-999',
      discordUsername: 'Anonymous#9999',
    }),
  ];
  setupThreeSelects([mockEventRow], signups, []);
  const result = await service.getEventMetrics(10);
  expect(result.rosterBreakdown[0].username).toBe('Anonymous#9999');
}

async function testUnknownFallback() {
  const signups = [makeSignup({})];
  setupThreeSelects([mockEventRow], signups, []);
  const result = await service.getEventMetrics(10);
  expect(result.rosterBreakdown[0].username).toBe('Unknown');
}

async function testSerializesTimestamps() {
  setupThreeSelects([mockEventRow], [], []);
  const result = await service.getEventMetrics(10);
  expect(result.startTime).toBe('2026-01-15T18:00:00.000Z');
  expect(result.endTime).toBe('2026-01-15T21:00:00.000Z');
}

async function testVoiceClassificationCounts() {
  const voice = [
    makeVoiceSession({ id: 1, discordUserId: 'd1', classification: 'full' }),
    makeVoiceSession({
      id: 2,
      discordUserId: 'd2',
      userId: 2,
      classification: 'full',
    }),
    makeVoiceSession({
      id: 3,
      discordUserId: 'd3',
      userId: 3,
      classification: 'late',
    }),
    makeVoiceSession({
      id: 4,
      discordUserId: 'd4',
      userId: 4,
      classification: 'early_leaver',
    }),
    makeVoiceSession({
      id: 5,
      discordUserId: 'd5',
      userId: 5,
      totalDurationSec: 0,
      classification: 'no_show',
    }),
  ];
  setupThreeSelects([mockEventRow], [], voice);
  const result = await service.getEventMetrics(10);
  expect(result.voiceSummary!.full).toBe(2);
  expect(result.voiceSummary!.late).toBe(1);
  expect(result.voiceSummary!.earlyLeaver).toBe(1);
  expect(result.voiceSummary!.noShow).toBe(1);
  expect(result.voiceSummary!.partial).toBe(0);
}

beforeEach(() => setupEach());

describe('getEventMetrics — event lookup', () => {
  it('throws NotFoundException when event missing', () => testNotFound());
  it('returns correct eventId and title', () => testBasicReturn());
  it('includes game info when present', () => testGameInfo());
  it('sets game to null when no gameId', () => testGameNull());
  it('serializes timestamps as ISO strings', () => testSerializesTimestamps());
});

describe('getEventMetrics — attendance summary', () => {
  it('computes attendance counts correctly', () => testAttendanceCounts());
  it('computes attendanceRate correctly', () => testAttendanceRate());
  it('sets attendanceRate to 0 when no marked signups', () =>
    testAttendanceRateZero());
});

describe('getEventMetrics — voice summary', () => {
  it('returns null when no voice sessions', () => testVoiceSummaryNull());
  it('returns populated voiceSummary', () => testVoiceSummaryPopulated());
  it('handles null lastLeaveAt', () => testVoiceNullLastLeave());
  it('counts classifications correctly', () => testVoiceClassificationCounts());
});

describe('getEventMetrics — roster breakdown', () => {
  it('matches voice data by discordUserId', () =>
    testRosterBreakdownWithVoice());
  it('sets voiceClassification null without match', () =>
    testRosterBreakdownNoVoice());
  it('uses discordUsername as fallback', () => testDiscordUsernameFallback());
  it('uses "Unknown" as final fallback', () => testUnknownFallback());
});
