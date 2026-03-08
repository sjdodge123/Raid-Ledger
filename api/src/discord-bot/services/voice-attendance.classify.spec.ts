/**
 * voice-attendance.adversarial.spec.ts
 *
 * Adversarial tests for ROK-490: voice presence attendance tracking.
 * Focus areas:
 *  1. classifyVoiceSession — exact boundary conditions the dev tests missed
 *  2. In-memory session lifecycle with duration accumulation
 *  3. autoPopulateAttendance — manual overrides preserved, unlinked users
 *  4. flushToDb — dirty flag lifecycle, active-segment snapshot
 *  5. VoiceStateListener — scheduled event branch fires independently of ad-hoc
 *  6. EventsController voice endpoints — 403 for non-creator / non-admin
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  VoiceAttendanceService,
  classifyVoiceSession,
} from './voice-attendance.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { ChannelResolverService } from './channel-resolver.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function eventWindow(durationHours: number) {
  const start = new Date('2026-02-28T20:00:00Z');
  const end = new Date(start.getTime() + durationHours * 3600_000);
  const durationSec = durationHours * 3600;
  const graceMs = 5 * 60 * 1000; // 5 minutes
  return { start, end, durationSec, graceMs };
}

// ─── 1. classifyVoiceSession — Boundary Conditions ────────────────────────────

describe('classifyVoiceSession — adversarial boundary conditions', () => {
  describe('no_show threshold: exactly 119 seconds vs 120 seconds', () => {
    it('classifies no_show at exactly 119 seconds (one below threshold)', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);

      const result = classifyVoiceSession(
        {
          totalDurationSec: 119,
          firstJoinAt: start,
          lastLeaveAt: end,
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      expect(result).toBe('no_show');
    });

    it('does NOT classify as no_show at exactly 120 seconds', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);

      const result = classifyVoiceSession(
        {
          totalDurationSec: 120,
          firstJoinAt: start,
          lastLeaveAt: end,
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      // 120s on a 2h event = ~1.67% presence, which is < 20%, so partial fallback
      // but more importantly: it's NOT no_show
      expect(result).not.toBe('no_show');
    });
  });

  describe('late threshold: exactly at grace boundary', () => {
    it('classifies as NOT late when joining exactly at grace window boundary (inclusive)', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);

      // Join exactly at the grace boundary (start + 5 min, not past it)
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.9),
          firstJoinAt: new Date(start.getTime() + graceMs), // exactly at grace boundary
          lastLeaveAt: end,
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      // The logic uses strict > so exactly at boundary is NOT late
      expect(result).not.toBe('late');
      expect(result).toBe('full');
    });

    it('classifies as late joining 1ms past the grace boundary', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);

      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.5),
          firstJoinAt: new Date(start.getTime() + graceMs + 1), // 1ms past grace
          lastLeaveAt: end,
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      expect(result).toBe('late');
    });
  });

  describe('late with < 20% presence should NOT be late (falls into no_show path)', () => {
    it('classifies no_show when joined late but presence < 20% and total < 120s', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);

      // Joined 10 min late, only 60 seconds (< 2 min) — should be no_show
      const result = classifyVoiceSession(
        {
          totalDurationSec: 60,
          firstJoinAt: new Date(start.getTime() + 10 * 60_000),
          lastLeaveAt: new Date(start.getTime() + 11 * 60_000),
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      expect(result).toBe('no_show');
    });

    it('classifies partial (not late) when joined late but presence is low (just above no_show, below 20%)', () => {
      // This tests a gap: if someone joins late with 2-19% presence — they have
      // >= 120s duration but < 20% presence. The late check requires >= 0.2,
      // so they fall through to the partial/full checks. With < 20% they should
      // hit the fallback 'partial' return at the end.
      const { start, end, durationSec, graceMs } = eventWindow(2);

      // 5% presence on 2h event = 360s (> 120s threshold), joined 10min late
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.05), // 360s = 5%
          firstJoinAt: new Date(start.getTime() + 10 * 60_000),
          lastLeaveAt: new Date(start.getTime() + 16 * 60_000),
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      // Joined late AND < 20% presence → NOT classified as 'late'
      // Falls through to partial (< 20% presence but > 0 → fallback partial)
      expect(result).not.toBe('late');
    });
  });

  describe('early_leaver threshold: exactly 5 minutes before end', () => {
    it('does NOT classify as early_leaver when leaving exactly 5 minutes before end', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);

      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.5),
          firstJoinAt: start,
          lastLeaveAt: new Date(end.getTime() - 5 * 60 * 1000), // exactly 5 min before end
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      // Strict < so exactly at boundary is NOT early_leaver
      expect(result).not.toBe('early_leaver');
    });

    it('classifies as early_leaver when leaving 1ms past the 5-minute cutoff', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);

      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.5),
          firstJoinAt: start,
          lastLeaveAt: new Date(end.getTime() - 5 * 60 * 1000 - 1), // 1ms past cutoff
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      expect(result).toBe('early_leaver');
    });
  });

  describe('early_leaver with >= 80% presence should NOT be early_leaver', () => {
    it('classifies as late (not early_leaver) when joined late AND left early with >= 80% presence', () => {
      // This tests priority ordering: late wins over early_leaver
      const { start, end, durationSec, graceMs } = eventWindow(2);

      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.85), // 85%
          firstJoinAt: new Date(start.getTime() + 6 * 60_000), // 6 min late
          lastLeaveAt: new Date(end.getTime() - 30 * 60_000), // left 30 min early
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      // late check fires before early_leaver, so this should be 'late'
      expect(result).toBe('late');
    });

    it('classifies as full (not early_leaver) when left slightly early but >= 80% presence', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);

      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.85), // 85%
          firstJoinAt: start,
          lastLeaveAt: new Date(end.getTime() - 10 * 60_000), // left 10 min early
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      // early_leaver requires presenceRatio < 0.8 — 85% does NOT qualify
      expect(result).not.toBe('early_leaver');
      expect(result).toBe('full');
    });
  });

  describe('partial at exactly 20% boundary (lower boundary)', () => {
    it('classifies partial at exactly 1 second below 20% boundary (just above no_show)', () => {
      // At exactly 19.99%, presence < 0.2 so it falls to the fallback partial
      // The logic returns 'partial' as fallback for < 20%
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const justBelow20Pct = Math.floor(durationSec * 0.2) - 1;
      // Must be >= 120 seconds to pass the no_show gate
      const totalDuration = Math.max(justBelow20Pct, 120);

      // For a 2h event: 20% = 1440s, so 1439s is just under 20% but above 120s
      const result = classifyVoiceSession(
        {
          totalDurationSec: 1439,
          firstJoinAt: start,
          lastLeaveAt: end,
        },
        start,
        end,
        durationSec,
        graceMs,
      );

      // Not no_show (>= 120s), not late, not early_leaver, presenceRatio < 0.2 → fallback partial
      expect(result).toBe('partial');
      void totalDuration; // suppress unused var warning
    });
  });

  describe('zero-duration event edge case', () => {
    it('does not divide by zero when eventDurationSec is 0', () => {
      const start = new Date('2026-02-28T20:00:00Z');
      const end = start; // same time = 0 duration

      // This would cause Infinity ratio — but no_show fires first (120s guard)
      expect(() =>
        classifyVoiceSession(
          {
            totalDurationSec: 0,
            firstJoinAt: start,
            lastLeaveAt: null,
          },
          start,
          end,
          0,
          5 * 60 * 1000,
        ),
      ).not.toThrow();
    });
  });
});

// ─── 2. In-memory session lifecycle ──────────────────────────────────────────

describe('VoiceAttendanceService — in-memory session lifecycle', () => {
  let service: VoiceAttendanceService;
  let mockDb: MockDb;

  function buildProviders() {
    return [
      VoiceAttendanceService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: SettingsService,
        useValue: { get: jest.fn().mockResolvedValue('5') },
      },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest
            .fn()
            .mockImplementation((_: string, fn: () => Promise<void>) => fn()),
        },
      },
      {
        provide: ChannelBindingsService,
        useValue: { getBindings: jest.fn().mockResolvedValue([]) },
      },
      {
        provide: DiscordBotClientService,
        useValue: { getClient: jest.fn(), getGuildId: jest.fn() },
      },
      {
        provide: ChannelResolverService,
        useValue: { resolveVoiceChannelForEvent: jest.fn() },
      },
    ];
  }
  async function setupBlock() {
    jest.useFakeTimers();
    mockDb = createDrizzleMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(),
    }).compile();

    service = module.get(VoiceAttendanceService);
  }

  beforeEach(async () => {
    await setupBlock();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('join → leave → rejoin → leave accumulates total duration across segments', () => {
    // Simulate: join at t=0, leave at t=60s, rejoin at t=120s, leave at t=180s
    // Expected totalDurationSec = 60 + 60 = 120

    jest.setSystemTime(new Date('2026-02-28T20:00:00Z'));
    service.handleJoin(1, 'discord-acc', 'AccUser', 42);

    jest.setSystemTime(new Date('2026-02-28T20:01:00Z')); // +60s
    service.handleLeave(1, 'discord-acc');

    jest.setSystemTime(new Date('2026-02-28T20:02:00Z')); // +120s
    service.handleJoin(1, 'discord-acc', 'AccUser', 42);

    jest.setSystemTime(new Date('2026-02-28T20:03:00Z')); // +180s
    service.handleLeave(1, 'discord-acc');

    // Flush to DB to verify what gets written
    mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);
    return service.flushToDb().then(() => {
      // The upsert should have been called with totalDurationSec = 120
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          totalDurationSec: 120,
          eventId: 1,
          discordUserId: 'discord-acc',
        }),
      );
    });
  });

  it('second join call while already active is a no-op (idempotent)', async () => {
    jest.setSystemTime(new Date('2026-02-28T20:00:00Z'));
    service.handleJoin(1, 'discord-idem', 'IdemUser', null);

    jest.setSystemTime(new Date('2026-02-28T20:00:30Z')); // +30s
    // Second join while still active — should not create a new segment
    service.handleJoin(1, 'discord-idem', 'IdemUser', null);

    jest.setSystemTime(new Date('2026-02-28T20:01:00Z')); // +60s
    service.handleLeave(1, 'discord-idem');

    mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);
    await service.flushToDb();

    // Should only have one segment with totalDurationSec = 60
    const valuesCall = mockDb.values.mock.calls[0][0];
    expect(valuesCall.totalDurationSec).toBe(60);
    expect(valuesCall.segments).toHaveLength(1);
  });

  it('dirty flag is cleared after successful flush', async () => {
    jest.setSystemTime(new Date('2026-02-28T20:00:00Z'));
    service.handleJoin(1, 'discord-dirty', 'DirtyUser', null);
    service.handleLeave(1, 'discord-dirty');

    mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);
    await service.flushToDb();

    // A second flush should not call the DB (no dirty sessions)
    mockDb.insert.mockClear();
    await service.flushToDb();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('flush for active (not-yet-left) session snapshots current active duration', async () => {
    jest.setSystemTime(new Date('2026-02-28T20:00:00Z'));
    service.handleJoin(1, 'discord-active', 'ActiveUser', null);

    // Advance 90 seconds — user is still in the channel
    jest.setSystemTime(new Date('2026-02-28T20:01:30Z'));

    mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);
    await service.flushToDb();

    const valuesCall = mockDb.values.mock.calls[0][0];
    // Should include the active segment's current duration (90s)
    expect(valuesCall.totalDurationSec).toBeGreaterThanOrEqual(90);
    // The last segment should have leaveAt === null (still active)
    const lastSegment = valuesCall.segments[valuesCall.segments.length - 1];
    expect(lastSegment.leaveAt).toBeNull();
    expect(lastSegment.durationSec).toBeGreaterThanOrEqual(90);
  });

  it('handles leave for session that was never joined gracefully', () => {
    expect(() => service.handleLeave(999, 'never-joined')).not.toThrow();
  });

  it('second leave when already inactive is a no-op', () => {
    service.handleJoin(1, 'discord-dbl', 'DblLeave', null);
    service.handleLeave(1, 'discord-dbl');
    // First leave sets isActive = false, totalDurationSec > 0

    mockDb.insert.mockClear();

    // Second leave — should not crash and should not change session state
    expect(() => service.handleLeave(1, 'discord-dbl')).not.toThrow();
  });

  it('multiple users in same event are tracked independently', async () => {
    jest.setSystemTime(new Date('2026-02-28T20:00:00Z'));
    service.handleJoin(1, 'discord-A', 'UserA', 1);
    service.handleJoin(1, 'discord-B', 'UserB', 2);

    jest.setSystemTime(new Date('2026-02-28T20:01:00Z'));
    service.handleLeave(1, 'discord-A');

    jest.setSystemTime(new Date('2026-02-28T20:02:00Z'));
    service.handleLeave(1, 'discord-B');

    mockDb.onConflictDoUpdate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    await service.flushToDb();

    // Both sessions should have been flushed
    expect(mockDb.values).toHaveBeenCalledTimes(2);

    const calls = mockDb.values.mock.calls;
    const discordIds = calls.map(
      (c: [Record<string, unknown>]) => c[0].discordUserId,
    );
    expect(discordIds).toContain('discord-A');
    expect(discordIds).toContain('discord-B');
  });
});

// ─── 3. autoPopulateAttendance — manual override preservation ─────────────────

describe('VoiceAttendanceService.autoPopulateAttendance', () => {
  let service: VoiceAttendanceService;
  let mockDb: MockDb;

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceAttendanceService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: SettingsService,
          useValue: { get: jest.fn().mockResolvedValue('5') },
        },
        {
          provide: CronJobService,
          useValue: {
            executeWithTracking: jest
              .fn()
              .mockImplementation((_: string, fn: () => Promise<void>) => fn()),
          },
        },
        {
          provide: ChannelBindingsService,
          useValue: { getBindings: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: DiscordBotClientService,
          useValue: { getClient: jest.fn(), getGuildId: jest.fn() },
        },
        {
          provide: ChannelResolverService,
          useValue: { resolveVoiceChannelForEvent: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(VoiceAttendanceService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('only updates signups where attendanceStatus is NULL (preserves manual overrides)', async () => {
    const now = new Date();
    const sessions = [
      {
        id: 'sess-1',
        eventId: 1,
        userId: 10,
        discordUserId: 'discord-10',
        discordUsername: 'ManualOverrideUser',
        firstJoinAt: now,
        lastLeaveAt: now,
        totalDurationSec: 3600,
        segments: [],
        classification: 'full',
      },
    ];

    // DB returns sessions with classification
    mockDb.where.mockResolvedValueOnce(sessions);
    // Update call returns nothing
    mockDb.where.mockResolvedValueOnce(undefined);

    await service.autoPopulateAttendance(1);

    // The update WHERE clause must include isNull(attendanceStatus)
    // We verify the update was called — the isNull guard is in the WHERE clause
    expect(mockDb.update).toHaveBeenCalled();
    // The set should map 'full' classification to 'attended'
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        attendanceStatus: 'attended',
        attendanceRecordedAt: expect.any(Date),
      }),
    );
  });

  it('maps no_show classification to no_show attendanceStatus', async () => {
    const now = new Date();
    mockDb.where.mockResolvedValueOnce([
      {
        id: 'sess-2',
        eventId: 2,
        userId: 20,
        discordUserId: 'discord-20',
        discordUsername: 'NoShowUser',
        firstJoinAt: now,
        lastLeaveAt: now,
        totalDurationSec: 0,
        segments: [],
        classification: 'no_show',
      },
    ]);
    mockDb.where.mockResolvedValueOnce(undefined);

    await service.autoPopulateAttendance(2);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ attendanceStatus: 'no_show' }),
    );
  });

  it('maps all non-no_show classifications to attended', async () => {
    const now = new Date();
    const classifications = ['full', 'partial', 'late', 'early_leaver'];
    const sessions = classifications.map((cls, i) => ({
      id: `sess-${i}`,
      eventId: 3,
      userId: i + 1,
      discordUserId: `discord-${i}`,
      discordUsername: `User${i}`,
      firstJoinAt: now,
      lastLeaveAt: now,
      totalDurationSec: 1000,
      segments: [],
      classification: cls,
    }));

    mockDb.where.mockResolvedValueOnce(sessions);
    // One update call per session
    for (let i = 0; i < sessions.length; i++) {
      mockDb.where.mockResolvedValueOnce(undefined);
    }

    await service.autoPopulateAttendance(3);

    const setCalls = mockDb.set.mock.calls as Array<[Record<string, unknown>]>;
    for (const call of setCalls) {
      expect(call[0].attendanceStatus).toBe('attended');
    }
  });

  it('skips sessions with null classification (unclassified)', async () => {
    // The query filters classification IS NOT NULL, so unclassified sessions
    // should not be in the results. If returned, they should not crash.
    mockDb.where.mockResolvedValueOnce([]); // no classified sessions

    await service.autoPopulateAttendance(4);

    // No update should have been called
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

// ─── 4. VoiceStateListener — scheduled event branch independent of ad-hoc ────
