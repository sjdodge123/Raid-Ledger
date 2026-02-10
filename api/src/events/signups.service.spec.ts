import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';

describe('SignupsService', () => {
  let service: SignupsService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: { create: jest.Mock };

  const mockUser = {
    id: 1,
    username: 'testuser',
    avatar: 'avatar.png',
    discordId: '123',
    isAdmin: false,
  };
  const mockEvent = { id: 1, title: 'Test Event', creatorId: 1 };
  const mockSignup = {
    id: 1,
    eventId: 1,
    userId: 1,
    note: null,
    signedUpAt: new Date(),
    characterId: null,
    confirmationStatus: 'pending',
  };
  const mockCharacter = {
    id: 'char-uuid-1',
    userId: 1,
    gameId: 'game-uuid-1',
    name: 'Frostweaver',
    realm: 'Area52',
    class: 'Mage',
    spec: 'Arcane',
    role: 'dps',
    isMain: true,
    itemLevel: 485,
    avatarUrl: null,
    externalId: null,
    displayOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockNotificationService = { create: jest.fn().mockResolvedValue(null) };

    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    };

    // Default select chain - event exists
    const selectEventChain = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([mockEvent]),
        }),
        leftJoin: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([]),
            }),
          }),
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    mockDb.select.mockReturnValue(selectEventChain);

    // Default insert chain
    const insertChain = {
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockSignup]),
      }),
    };
    mockDb.insert.mockReturnValue(insertChain);

    // Default delete chain
    const deleteChain = {
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockSignup]),
      }),
    };
    mockDb.delete.mockReturnValue(deleteChain);

    // Default update chain
    const updateChain = {
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockSignup]),
        }),
      }),
    };
    mockDb.update.mockReturnValue(updateChain);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<SignupsService>(SignupsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('signup', () => {
    it('should create a signup when event exists', async () => {
      // Mock: event exists, no existing signup
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockEvent]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
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

      const result = await service.signup(1, 1);

      expect(result.eventId).toBe(1);
      expect(result.confirmationStatus).toBe('pending');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should throw NotFoundException when event does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.signup(999, 1)).rejects.toThrow(NotFoundException);
    });

    it('should return existing signup if unique constraint violated (idempotent)', async () => {
      // Mock: event exists, insert throws unique constraint error
      const uniqueError = new Error('unique_event_user constraint violation');

      mockDb.select
        // 1. Check event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockEvent]),
            }),
          }),
        })
        // 2. Pre-fetch user (before insert)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        })
        // 3. After constraint error, fetch existing signup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        });

      // Insert throws unique constraint error
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockRejectedValue(uniqueError),
        }),
      });

      const result = await service.signup(1, 1);

      expect(result.id).toBe(mockSignup.id);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should cancel unassigned signup without notification', async () => {
      // 1. Find signup
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 2. Check roster assignment — none
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await service.cancel(1, 1);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when signup does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.cancel(999, 1)).rejects.toThrow(NotFoundException);
    });

    it('should dispatch slot_vacated notification when assigned signup is canceled', async () => {
      const mockAssignment = {
        id: 10,
        signupId: 1,
        role: 'healer',
        position: 2,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        // 1. Find signup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 2. Check roster assignment — found
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAssignment]),
            }),
          }),
        })
        // 3. Fetch event (for creatorId + title)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ creatorId: 5, title: 'Raid Night' }]),
            }),
          }),
        })
        // 4. Fetch user (for display name)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ username: 'Frostmage' }]),
            }),
          }),
        });

      await service.cancel(1, 1);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockNotificationService.create).toHaveBeenCalledWith({
        userId: 5,
        type: 'slot_vacated',
        title: 'Slot Vacated',
        message: 'Frostmage left the healer slot for Raid Night',
        payload: { eventId: 1 },
      });
    });

    it('should include eventId in notification payload', async () => {
      const mockAssignment = {
        id: 10,
        signupId: 1,
        role: 'tank',
        position: 1,
        eventId: 42,
        isOverride: 0,
      };
      const signup42 = { ...mockSignup, eventId: 42 };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([signup42]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAssignment]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ creatorId: 3, title: 'Weekly Clear' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ username: 'ShadowBlade' }]),
            }),
          }),
        });

      await service.cancel(42, 1);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { eventId: 42 } }),
      );
    });
  });

  describe('selfUnassign', () => {
    const mockAssignment = {
      id: 10,
      signupId: 1,
      role: 'healer',
      position: 2,
      eventId: 1,
      isOverride: 0,
    };

    it('should throw NotFoundException when signup does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.selfUnassign(1, 99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when no roster assignment exists', async () => {
      mockDb.select
        // 1. Find signup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 2. Find roster assignment — none
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(service.selfUnassign(1, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete assignment, notify organizer, and return updated roster', async () => {
      // Spy on getRosterWithAssignments to avoid deep mock chains
      const mockRoster = {
        eventId: 1,
        pool: [
          {
            id: 0,
            signupId: 1,
            userId: 1,
            discordId: '123',
            username: 'testuser',
            avatar: 'avatar.png',
            slot: null,
            position: 0,
            isOverride: false,
            character: null,
          },
        ],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      mockDb.select
        // 1. Find signup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 2. Find roster assignment
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAssignment]),
            }),
          }),
        })
        // 3. Fetch event (creatorId + title) via Promise.all
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ creatorId: 5, title: 'Raid Night' }]),
            }),
          }),
        })
        // 4. Fetch user (username) via Promise.all
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ username: 'Frostmage' }]),
            }),
          }),
        });

      const result = await service.selfUnassign(1, 1);

      // Assignment was deleted
      expect(mockDb.delete).toHaveBeenCalled();
      // Notification dispatched to organizer
      expect(mockNotificationService.create).toHaveBeenCalledWith({
        userId: 5,
        type: 'slot_vacated',
        title: 'Slot Vacated',
        message: 'Frostmage left the healer slot for Raid Night',
        payload: { eventId: 1 },
      });
      // Returns updated roster
      expect(result.pool).toHaveLength(1);
      expect(result.assignments).toHaveLength(0);
    });

    it('should not delete the signup itself', async () => {
      jest.spyOn(service, 'getRosterWithAssignments').mockResolvedValueOnce({
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      });

      mockDb.select
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
              limit: jest.fn().mockResolvedValue([mockAssignment]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ creatorId: 5, title: 'Raid Night' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ username: 'TestUser' }]),
            }),
          }),
        });

      await service.selfUnassign(1, 1);

      // delete was called exactly once (for assignment, not signup)
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getRoster', () => {
    it('should return roster for event with character data', async () => {
      const signupWithChar = {
        ...mockSignup,
        characterId: mockCharacter.id,
        confirmationStatus: 'confirmed',
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockEvent]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue([
                    {
                      event_signups: signupWithChar,
                      users: mockUser,
                      characters: mockCharacter,
                    },
                  ]),
                }),
              }),
            }),
          }),
        });

      const result = await service.getRoster(1);

      expect(result.eventId).toBe(1);
      expect(result.count).toBe(1);
      expect(result.signups[0].user.username).toBe('testuser');
      expect(result.signups[0].character?.name).toBe('Frostweaver');
      expect(result.signups[0].confirmationStatus).toBe('confirmed');
    });

    it('should return roster with null character for pending signups', async () => {
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockEvent]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue([
                    {
                      event_signups: mockSignup,
                      users: mockUser,
                      characters: null,
                    },
                  ]),
                }),
              }),
            }),
          }),
        });

      const result = await service.getRoster(1);

      expect(result.signups[0].character).toBeNull();
      expect(result.signups[0].confirmationStatus).toBe('pending');
    });

    it('should throw NotFoundException when event does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.getRoster(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmSignup', () => {
    it('should confirm signup with character', async () => {
      const confirmedSignup = {
        ...mockSignup,
        characterId: mockCharacter.id,
        confirmationStatus: 'confirmed',
      };

      mockDb.select
        // 1. Fetch signup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 2. Verify character belongs to user
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockCharacter]),
            }),
          }),
        })
        // 3. Fetch user for response
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
            returning: jest.fn().mockResolvedValue([confirmedSignup]),
          }),
        }),
      });

      const result = await service.confirmSignup(1, 1, 1, {
        characterId: mockCharacter.id,
      });

      expect(result.characterId).toBe(mockCharacter.id);
      expect(result.confirmationStatus).toBe('confirmed');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when signup does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.confirmSignup(1, 999, 1, { characterId: 'char-uuid' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user does not own signup', async () => {
      const otherUserSignup = { ...mockSignup, userId: 2 };

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([otherUserSignup]),
          }),
        }),
      });

      await expect(
        service.confirmSignup(1, 1, 1, { characterId: 'char-uuid' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when character does not belong to user', async () => {
      mockDb.select
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
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(
        service.confirmSignup(1, 1, 1, { characterId: 'invalid-char' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should set status to changed when re-confirming', async () => {
      const alreadyConfirmedSignup = {
        ...mockSignup,
        characterId: 'old-char-id',
        confirmationStatus: 'confirmed',
      };
      const changedSignup = {
        ...alreadyConfirmedSignup,
        characterId: mockCharacter.id,
        confirmationStatus: 'changed',
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([alreadyConfirmedSignup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockCharacter]),
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
            returning: jest.fn().mockResolvedValue([changedSignup]),
          }),
        }),
      });

      const result = await service.confirmSignup(1, 1, 1, {
        characterId: mockCharacter.id,
      });

      expect(result.confirmationStatus).toBe('changed');
    });
  });
});
