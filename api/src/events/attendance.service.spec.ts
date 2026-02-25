import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let mockDb: Record<string, jest.Mock>;

  const pastEvent = {
    id: 1,
    title: 'Past Raid',
    creatorId: 10,
    duration: [
      new Date('2026-01-01T18:00:00Z'),
      new Date('2026-01-01T20:00:00Z'),
    ],
  };

  const futureEvent = {
    id: 2,
    title: 'Future Raid',
    creatorId: 10,
    duration: [
      new Date('2027-12-01T18:00:00Z'),
      new Date('2027-12-01T20:00:00Z'),
    ],
  };

  const mockSignup = {
    id: 100,
    eventId: 1,
    userId: 20,
    note: null,
    signedUpAt: new Date('2026-01-01T17:00:00Z'),
    characterId: null,
    confirmationStatus: 'pending',
    status: 'signed_up',
    preferredRoles: null,
    attendanceStatus: null,
    attendanceRecordedAt: null,
    roachedOutAt: null,
    discordUserId: null,
    discordUsername: null,
    discordAvatarHash: null,
  };

  const mockUser = {
    id: 20,
    username: 'testplayer',
    discordId: '999',
    avatar: null,
    displayName: null,
    customAvatarUrl: null,
    role: 'member',
    onboardingCompletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
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
    ];
    for (const m of chainMethods) {
      mockDb[m] = jest.fn().mockReturnThis();
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    service = module.get(AttendanceService);
  });

  describe('recordAttendance', () => {
    it('should record attendance for a valid past event', async () => {
      const updatedSignup = {
        ...mockSignup,
        attendanceStatus: 'attended',
        attendanceRecordedAt: new Date(),
      };

      // 1. Find event
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([pastEvent]),
          }),
        }),
      });
      // 2. Find signup
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockSignup]),
          }),
        }),
      });
      // 3. Update attendance
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedSignup]),
          }),
        }),
      });
      // 4. Fetch user for response
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockUser]),
          }),
        }),
      });

      const result = await service.recordAttendance(
        1,
        { signupId: 100, attendanceStatus: 'attended' },
        10,
        false,
      );

      expect(result).toMatchObject({
        id: expect.any(Number),
        eventId: expect.any(Number),
        attendanceStatus: 'attended',
      });
    });

    it('should throw NotFoundException when event does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.recordAttendance(
          999,
          { signupId: 1, attendanceStatus: 'attended' },
          10,
          false,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when event has not ended', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([futureEvent]),
          }),
        }),
      });

      await expect(
        service.recordAttendance(
          2,
          { signupId: 1, attendanceStatus: 'attended' },
          10,
          false,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when caller is not creator or admin', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([pastEvent]),
          }),
        }),
      });

      await expect(
        service.recordAttendance(
          1,
          { signupId: 1, attendanceStatus: 'attended' },
          99, // not the creator (10)
          false,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow admin to record attendance', async () => {
      const updatedSignup = {
        ...mockSignup,
        attendanceStatus: 'no_show',
        attendanceRecordedAt: new Date(),
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([pastEvent]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        });

      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedSignup]),
          }),
        }),
      });

      const result = await service.recordAttendance(
        1,
        { signupId: 100, attendanceStatus: 'no_show' },
        99, // not creator but admin
        true,
      );

      expect(result).toMatchObject({
        attendanceStatus: 'no_show',
      });
    });

    it('should throw NotFoundException when signup does not exist', async () => {
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([pastEvent]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(
        service.recordAttendance(
          1,
          { signupId: 999, attendanceStatus: 'attended' },
          10,
          false,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAttendanceSummary', () => {
    it('should throw NotFoundException when event does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.getAttendanceSummary(999, 10, true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should compute correct summary stats', async () => {
      const signups = [
        {
          event_signups: {
            ...mockSignup,
            id: 1,
            attendanceStatus: 'attended',
            attendanceRecordedAt: new Date(),
          },
          users: mockUser,
          characters: null,
        },
        {
          event_signups: {
            ...mockSignup,
            id: 2,
            userId: 21,
            attendanceStatus: 'no_show',
            attendanceRecordedAt: new Date(),
          },
          users: { ...mockUser, id: 21, username: 'player2' },
          characters: null,
        },
        {
          event_signups: {
            ...mockSignup,
            id: 3,
            userId: 22,
            attendanceStatus: null,
            attendanceRecordedAt: null,
          },
          users: { ...mockUser, id: 22, username: 'player3' },
          characters: null,
        },
      ];

      // 1. Find event
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([pastEvent]),
          }),
        }),
      });

      // 2. Get signups with joins
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue(signups),
              }),
            }),
          }),
        }),
      });

      const result = await service.getAttendanceSummary(1, 10, true);

      expect(result).toMatchObject({
        eventId: 1,
        totalSignups: 3,
        attended: 1,
        noShow: 1,
        excused: 0,
        unmarked: 1,
        attendanceRate: 0.5,
        noShowRate: 0.5,
      });
      expect(result.signups).toHaveLength(3);
    });
  });
});
