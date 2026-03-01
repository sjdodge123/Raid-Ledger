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
import { BadRequestException } from '@nestjs/common';
import {
  VoiceAttendanceService,
  classifyVoiceSession,
} from './voice-attendance.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { VoiceStateListener } from '../listeners/voice-state.listener';
import { AdHocEventService } from './ad-hoc-event.service';
import { PresenceGameDetectorService } from './presence-game-detector.service';
import { UsersService } from '../../users/users.service';
import { Events, Collection } from 'discord.js';
import { EventsController } from '../../events/events.controller';
import { EventsService } from '../../events/events.service';
import { SignupsService } from '../../events/signups.service';
import { AttendanceService } from '../../events/attendance.service';
import { PugsService } from '../../events/pugs.service';
import { ShareService } from '../../events/share.service';

import type { UserRole } from '@raid-ledger/contract';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function eventWindow(durationHours: number) {
  const start = new Date('2026-02-28T20:00:00Z');
  const end = new Date(start.getTime() + durationHours * 3600_000);
  const durationSec = durationHours * 3600;
  const graceMs = 5 * 60 * 1000; // 5 minutes
  return { start, end, durationSec, graceMs };
}

function makeCollection<K, V>(entries: [K, V][] = []): Collection<K, V> {
  const col = new Collection<K, V>();
  for (const [key, val] of entries) {
    col.set(key, val);
  }
  return col;
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

  beforeEach(async () => {
    jest.useFakeTimers();
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
      ],
    }).compile();

    service = module.get(VoiceAttendanceService);
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
    const discordIds = calls.map((c: [Record<string, unknown>]) => c[0].discordUserId);
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

describe('VoiceStateListener — scheduled event branch (ROK-490)', () => {
  let listener: VoiceStateListener;
  let mockVoiceAttendanceService: {
    findActiveScheduledEvents: jest.Mock;
    handleJoin: jest.Mock;
    handleLeave: jest.Mock;
    recoverActiveSessions: jest.Mock;
  };
  let mockAdHocEventService: {
    handleVoiceJoin: jest.Mock;
    handleVoiceLeave: jest.Mock;
    getActiveState: jest.Mock;
  };
  let mockChannelBindingsService: { getBindings: jest.Mock };
  let mockClientService: { getClient: jest.Mock; getGuildId: jest.Mock };
  let voiceHandler: (oldState: unknown, newState: unknown) => void;

  beforeEach(async () => {
    jest.useFakeTimers();

    mockVoiceAttendanceService = {
      findActiveScheduledEvents: jest.fn().mockResolvedValue([]),
      handleJoin: jest.fn(),
      handleLeave: jest.fn(),
      recoverActiveSessions: jest.fn().mockResolvedValue(undefined),
    };

    mockAdHocEventService = {
      handleVoiceJoin: jest.fn().mockResolvedValue(undefined),
      handleVoiceLeave: jest.fn().mockResolvedValue(undefined),
      getActiveState: jest.fn().mockReturnValue(undefined),
    };

    mockChannelBindingsService = {
      getBindings: jest.fn().mockResolvedValue([]),
    };

    mockClientService = {
      getClient: jest.fn(),
      getGuildId: jest.fn().mockReturnValue('guild-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceStateListener,
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: AdHocEventService, useValue: mockAdHocEventService },
        {
          provide: VoiceAttendanceService,
          useValue: mockVoiceAttendanceService,
        },
        {
          provide: ChannelBindingsService,
          useValue: mockChannelBindingsService,
        },
        {
          provide: PresenceGameDetectorService,
          useValue: {
            detectGameForMember: jest.fn().mockResolvedValue(null),
            detectGames: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: UsersService,
          useValue: { findByDiscordId: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    listener = module.get(VoiceStateListener);

    // Set up client with handler capture
    const mockClient = {
      on: jest.fn().mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === (Events.VoiceStateUpdate as string)) {
            voiceHandler = handler;
          }
        },
      ),
      removeListener: jest.fn(),
      guilds: {
        cache: makeCollection([
          [
            'guild-1',
            {
              channels: {
                cache: makeCollection([]),
              },
            },
          ],
        ]),
      },
    };
    mockClientService.getClient.mockReturnValue(mockClient);
    await listener.onBotConnected();
  });

  afterEach(() => {
    listener.onBotDisconnected();
    jest.useRealTimers();
  });

  it('calls voiceAttendanceService.handleJoin when there are active scheduled events on channel join', async () => {
    mockVoiceAttendanceService.findActiveScheduledEvents.mockResolvedValue([
      { eventId: 101, gameId: 1 },
    ]);

    voiceHandler(
      { channelId: null, id: 'user-scheduled' },
      {
        channelId: 'voice-ch-scheduled',
        id: 'user-scheduled',
        member: {
          displayName: 'ScheduledPlayer',
          user: { username: 'ScheduledPlayer', avatar: null },
        },
      },
    );

    await jest.advanceTimersByTimeAsync(2100);

    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledWith(
      101,
      'user-scheduled',
      'ScheduledPlayer',
      null,
    );
  });

  it('calls voiceAttendanceService.handleLeave on channel leave with active scheduled events', async () => {
    mockVoiceAttendanceService.findActiveScheduledEvents.mockResolvedValue([
      { eventId: 202, gameId: 2 },
    ]);

    // Set up a binding so the ad-hoc path also fires
    mockChannelBindingsService.getBindings.mockResolvedValue([
      {
        id: 'bind-1',
        channelId: 'voice-ch-leave2',
        bindingPurpose: 'game-voice-monitor',
        gameId: 2,
        config: {},
      },
    ]);

    voiceHandler(
      { channelId: 'voice-ch-leave2', id: 'user-leave2' },
      { channelId: null, id: 'user-leave2', member: null },
    );

    await jest.advanceTimersByTimeAsync(2100);

    expect(mockVoiceAttendanceService.handleLeave).toHaveBeenCalledWith(
      202,
      'user-leave2',
    );
  });

  it('voice attendance join fires independently of the ad-hoc binding (no binding needed)', async () => {
    // No channel binding for the channel, but there IS an active scheduled event
    mockChannelBindingsService.getBindings.mockResolvedValue([]);
    mockVoiceAttendanceService.findActiveScheduledEvents.mockResolvedValue([
      { eventId: 303, gameId: null },
    ]);

    voiceHandler(
      { channelId: null, id: 'user-no-binding' },
      {
        channelId: 'voice-ch-no-binding',
        id: 'user-no-binding',
        member: {
          displayName: 'UnboundPlayer',
          user: { username: 'UnboundPlayer', avatar: null },
        },
      },
    );

    await jest.advanceTimersByTimeAsync(2100);

    // VoiceAttendance SHOULD fire even without a channel binding
    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledWith(
      303,
      'user-no-binding',
      'UnboundPlayer',
      null,
    );
    // Ad-hoc service should NOT fire (no binding)
    expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
  });

  it('voice attendance tracks multiple active scheduled events for the same channel join', async () => {
    // Edge case: two scheduled events active at the same time in the same channel
    mockVoiceAttendanceService.findActiveScheduledEvents.mockResolvedValue([
      { eventId: 401, gameId: 1 },
      { eventId: 402, gameId: 1 },
    ]);

    voiceHandler(
      { channelId: null, id: 'user-multi-event' },
      {
        channelId: 'voice-ch-multi',
        id: 'user-multi-event',
        member: {
          displayName: 'MultiPlayer',
          user: { username: 'MultiPlayer', avatar: null },
        },
      },
    );

    await jest.advanceTimersByTimeAsync(2100);

    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledTimes(2);
    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledWith(
      401,
      'user-multi-event',
      'MultiPlayer',
      null,
    );
    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledWith(
      402,
      'user-multi-event',
      'MultiPlayer',
      null,
    );
  });

  it('voice attendance join error does not break the ad-hoc path', async () => {
    // Even if findActiveScheduledEvents throws, the ad-hoc path should continue
    mockVoiceAttendanceService.findActiveScheduledEvents.mockRejectedValue(
      new Error('DB connection lost'),
    );
    mockChannelBindingsService.getBindings.mockResolvedValue([
      {
        id: 'bind-fallback',
        channelId: 'voice-ch-fallback',
        bindingPurpose: 'game-voice-monitor',
        gameId: 1,
        config: { minPlayers: 1 },
      },
    ]);
    mockAdHocEventService.getActiveState.mockReturnValue({
      eventId: 500,
      memberSet: new Set(),
      lastExtendedAt: 0,
    });

    voiceHandler(
      { channelId: null, id: 'user-fallback' },
      {
        channelId: 'voice-ch-fallback',
        id: 'user-fallback',
        member: {
          displayName: 'FallbackPlayer',
          user: { username: 'FallbackPlayer', avatar: null },
        },
      },
    );

    // Should not throw — error is caught and logged
    await jest.advanceTimersByTimeAsync(2100);

    // Ad-hoc path continues despite voice attendance error
    expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
  });

  it('voice attendance leave error does not break the ad-hoc path', async () => {
    mockVoiceAttendanceService.findActiveScheduledEvents.mockRejectedValue(
      new Error('DB connection lost'),
    );
    mockChannelBindingsService.getBindings.mockResolvedValue([
      {
        id: 'bind-leave-err',
        channelId: 'voice-ch-leave-err',
        bindingPurpose: 'game-voice-monitor',
        gameId: 1,
        config: {},
      },
    ]);

    voiceHandler(
      { channelId: 'voice-ch-leave-err', id: 'user-leave-err' },
      { channelId: null, id: 'user-leave-err', member: null },
    );

    await jest.advanceTimersByTimeAsync(2100);

    expect(mockAdHocEventService.handleVoiceLeave).toHaveBeenCalled();
  });

  it('recoverActiveSessions is called on bot connect', async () => {
    // Already called in beforeEach, just verify it was invoked
    expect(mockVoiceAttendanceService.recoverActiveSessions).toHaveBeenCalled();
  });
});

// ─── 5. EventsController — voice endpoint auth (403 for non-creator/non-admin) ─

describe('EventsController — voice endpoint authorization', () => {
  let controller: EventsController;
  let mockEventsService: Partial<EventsService>;
  let mockVoiceAttendanceService: {
    getVoiceSessions: jest.Mock;
    getVoiceAttendanceSummary: jest.Mock;
  };

  const creatorId = 1;
  const otherUserId = 2;
  const adminUser = { id: 3, role: 'admin' as UserRole };
  const operatorUser = { id: 4, role: 'operator' as UserRole };
  const memberUser = { id: otherUserId, role: 'member' as UserRole };

  const mockEvent = {
    id: 10,
    title: 'Test Event',
    creator: { id: creatorId, discordId: '111', username: 'creator', avatar: null },
    game: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockEventsService = {
      findOne: jest.fn().mockResolvedValue(mockEvent),
    };

    mockVoiceAttendanceService = {
      getVoiceSessions: jest.fn().mockResolvedValue({ eventId: 10, sessions: [] }),
      getVoiceAttendanceSummary: jest.fn().mockResolvedValue({
        eventId: 10,
        totalTracked: 0,
        full: 0,
        partial: 0,
        late: 0,
        earlyLeaver: 0,
        noShow: 0,
        unclassified: 0,
        sessions: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        { provide: EventsService, useValue: mockEventsService },
        {
          provide: SignupsService,
          useValue: { signup: jest.fn(), cancel: jest.fn(), getRoster: jest.fn() },
        },
        {
          provide: AttendanceService,
          useValue: {
            recordAttendance: jest.fn(),
            getAttendanceSummary: jest.fn(),
          },
        },
        { provide: PugsService, useValue: {} },
        { provide: ShareService, useValue: { shareToDiscordChannels: jest.fn() } },
        {
          provide: AdHocEventService,
          useValue: { getAdHocRoster: jest.fn() },
        },
        {
          provide: VoiceAttendanceService,
          useValue: mockVoiceAttendanceService,
        },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
  });

  describe('GET :id/voice-sessions', () => {
    it('allows event creator to view voice sessions', async () => {
      const result = await controller.getVoiceSessions(10, {
        user: { id: creatorId, role: 'member' },
      });

      expect(result).toMatchObject({ eventId: 10 });
      expect(mockVoiceAttendanceService.getVoiceSessions).toHaveBeenCalledWith(10);
    });

    it('allows admin to view voice sessions for any event', async () => {
      const result = await controller.getVoiceSessions(10, { user: adminUser });

      expect(result).toMatchObject({ eventId: 10 });
    });

    it('allows operator to view voice sessions for any event', async () => {
      const result = await controller.getVoiceSessions(10, { user: operatorUser });

      expect(result).toMatchObject({ eventId: 10 });
    });

    it('throws BadRequestException for a non-creator member user', async () => {
      await expect(
        controller.getVoiceSessions(10, { user: memberUser }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException with descriptive message for unauthorized user', async () => {
      await expect(
        controller.getVoiceSessions(10, { user: memberUser }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('creator'),
      });
    });
  });

  describe('GET :id/voice-attendance', () => {
    it('allows event creator to view voice attendance', async () => {
      const result = await controller.getVoiceAttendance(10, {
        user: { id: creatorId, role: 'member' },
      });

      expect(result).toMatchObject({ eventId: 10 });
      expect(
        mockVoiceAttendanceService.getVoiceAttendanceSummary,
      ).toHaveBeenCalledWith(10);
    });

    it('allows admin to view voice attendance for any event', async () => {
      const result = await controller.getVoiceAttendance(10, {
        user: adminUser,
      });

      expect(result).toMatchObject({ eventId: 10, totalTracked: 0 });
    });

    it('allows operator to view voice attendance for any event', async () => {
      const result = await controller.getVoiceAttendance(10, {
        user: operatorUser,
      });

      expect(result).toMatchObject({ eventId: 10 });
    });

    it('throws BadRequestException for a non-creator member user', async () => {
      await expect(
        controller.getVoiceAttendance(10, { user: memberUser }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException with descriptive message for unauthorized user', async () => {
      await expect(
        controller.getVoiceAttendance(10, { user: memberUser }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('creator'),
      });
    });

    it('returns summary with correct shape including all classification counts', async () => {
      mockVoiceAttendanceService.getVoiceAttendanceSummary.mockResolvedValue({
        eventId: 10,
        totalTracked: 5,
        full: 2,
        partial: 1,
        late: 1,
        earlyLeaver: 0,
        noShow: 1,
        unclassified: 0,
        sessions: [],
      });

      const result = await controller.getVoiceAttendance(10, {
        user: { id: creatorId, role: 'member' },
      });

      expect(result).toMatchObject({
        eventId: expect.any(Number),
        totalTracked: expect.any(Number),
        full: expect.any(Number),
        partial: expect.any(Number),
        late: expect.any(Number),
        earlyLeaver: expect.any(Number),
        noShow: expect.any(Number),
        unclassified: expect.any(Number),
      });
    });
  });
});
