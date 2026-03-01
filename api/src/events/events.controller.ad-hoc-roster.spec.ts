/**
 * events.controller.ad-hoc-roster.spec.ts
 *
 * Adversarial tests for ROK-530: EventsController.getAdHocRoster()
 *
 * Focus areas:
 *  1. Ad-hoc events delegate to AdHocEventService.getAdHocRoster()
 *  2. Non-ad-hoc (scheduled) events delegate to VoiceAttendanceService.getActiveRoster()
 *  3. Response shape is consistent regardless of delegation path
 *  4. VoiceAttendanceService.getActiveRoster() result is returned directly for planned events
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { AttendanceService } from './attendance.service';
import { PugsService } from './pugs.service';
import { ShareService } from './share.service';
import { AdHocEventService } from '../discord-bot/services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { AnalyticsService } from './analytics.service';

const adHocRosterResponse = {
  eventId: 1,
  participants: [
    {
      id: 'part-1',
      eventId: 1,
      userId: null,
      discordUserId: 'discord-adhoc',
      discordUsername: 'AdHocPlayer',
      discordAvatarHash: 'hash123',
      joinedAt: '2026-03-01T18:00:00Z',
      leftAt: null,
      totalDurationSeconds: 300,
      sessionCount: 1,
    },
  ],
  activeCount: 1,
};

const voiceRosterResponse = {
  eventId: 2,
  participants: [
    {
      id: 'discord-planned',
      eventId: 2,
      userId: 42,
      discordUserId: 'discord-planned',
      discordUsername: 'PlannedPlayer',
      discordAvatarHash: null,
      joinedAt: '2026-03-01T20:00:00Z',
      leftAt: null,
      totalDurationSeconds: 600,
      sessionCount: 1,
    },
  ],
  activeCount: 1,
};

describe('EventsController.getAdHocRoster (ROK-530)', () => {
  let controller: EventsController;
  let mockEventsService: { findOne: jest.Mock };
  let mockAdHocEventService: { getAdHocRoster: jest.Mock };
  let mockVoiceAttendanceService: { getActiveRoster: jest.Mock };

  function buildAdHocEvent(id = 1) {
    return {
      id,
      title: 'Ad-Hoc Event',
      isAdHoc: true,
      creator: { id: 1, username: 'creator', avatar: null },
    };
  }

  function buildPlannedEvent(id = 2) {
    return {
      id,
      title: 'Planned Event',
      isAdHoc: false,
      creator: { id: 1, username: 'creator', avatar: null },
    };
  }

  beforeEach(async () => {
    mockEventsService = {
      findOne: jest.fn(),
    };

    mockAdHocEventService = {
      getAdHocRoster: jest.fn().mockResolvedValue(adHocRosterResponse),
    };

    mockVoiceAttendanceService = {
      getActiveRoster: jest.fn().mockReturnValue(voiceRosterResponse),
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
          useValue: { recordAttendance: jest.fn(), getAttendanceSummary: jest.fn() },
        },
        { provide: PugsService, useValue: {} },
        {
          provide: ShareService,
          useValue: { shareToDiscordChannels: jest.fn() },
        },
        { provide: AdHocEventService, useValue: mockAdHocEventService },
        { provide: VoiceAttendanceService, useValue: mockVoiceAttendanceService },
        { provide: AnalyticsService, useValue: { getEventMetrics: jest.fn() } },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
  });

  // ── Ad-hoc event delegation ──────────────────────────────────────────────

  it('delegates to AdHocEventService for ad-hoc events', async () => {
    mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));

    await controller.getAdHocRoster(1);

    expect(mockAdHocEventService.getAdHocRoster).toHaveBeenCalledWith(1);
    expect(mockVoiceAttendanceService.getActiveRoster).not.toHaveBeenCalled();
  });

  it('returns AdHocEventService result for ad-hoc events', async () => {
    mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));

    const result = await controller.getAdHocRoster(1);

    expect(result).toEqual(adHocRosterResponse);
  });

  it('does NOT call VoiceAttendanceService for ad-hoc events', async () => {
    mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));

    await controller.getAdHocRoster(1);

    expect(mockVoiceAttendanceService.getActiveRoster).not.toHaveBeenCalled();
  });

  // ── Planned event delegation ─────────────────────────────────────────────

  it('delegates to VoiceAttendanceService for non-ad-hoc (planned) events', async () => {
    mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));

    await controller.getAdHocRoster(2);

    expect(mockVoiceAttendanceService.getActiveRoster).toHaveBeenCalledWith(2);
    expect(mockAdHocEventService.getAdHocRoster).not.toHaveBeenCalled();
  });

  it('returns VoiceAttendanceService result for planned events', async () => {
    mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));

    const result = await controller.getAdHocRoster(2);

    expect(result).toEqual(voiceRosterResponse);
  });

  it('does NOT call AdHocEventService for planned events', async () => {
    mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));

    await controller.getAdHocRoster(2);

    expect(mockAdHocEventService.getAdHocRoster).not.toHaveBeenCalled();
  });

  // ── Response shape ────────────────────────────────────────────────────────

  it('returns AdHocRosterResponseDto shape for ad-hoc events', async () => {
    mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));

    const result = await controller.getAdHocRoster(1);

    expect(result).toMatchObject({
      eventId: expect.any(Number),
      participants: expect.any(Array),
      activeCount: expect.any(Number),
    });
  });

  it('returns AdHocRosterResponseDto shape for planned events', async () => {
    mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));

    const result = await controller.getAdHocRoster(2);

    expect(result).toMatchObject({
      eventId: expect.any(Number),
      participants: expect.any(Array),
      activeCount: expect.any(Number),
    });
  });

  // ── findOne is always called first ────────────────────────────────────────

  it('calls eventsService.findOne with the event id before delegating', async () => {
    mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(42));

    await controller.getAdHocRoster(42);

    expect(mockEventsService.findOne).toHaveBeenCalledWith(42);
  });

  it('propagates error if eventsService.findOne throws (event not found)', async () => {
    const notFound = new Error('Event not found');
    mockEventsService.findOne.mockRejectedValue(notFound);

    await expect(controller.getAdHocRoster(999)).rejects.toThrow('Event not found');

    expect(mockAdHocEventService.getAdHocRoster).not.toHaveBeenCalled();
    expect(mockVoiceAttendanceService.getActiveRoster).not.toHaveBeenCalled();
  });
});
