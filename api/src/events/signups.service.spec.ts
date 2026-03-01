import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';

describe('SignupsService', () => {
  let service: SignupsService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  let mockRosterNotificationBuffer: {
    bufferLeave: jest.Mock;
    bufferJoin: jest.Mock;
  };
  let mockBenchPromotionService: {
    schedulePromotion: jest.Mock;
    cancelPromotion: jest.Mock;
    isEligible: jest.Mock;
  };

  const mockUser = {
    id: 1,
    username: 'testuser',
    avatar: 'avatar.png',
    discordId: '123',
    role: 'member',
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
    mockNotificationService = {
      create: jest.fn().mockResolvedValue(null),
      getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    };
    mockRosterNotificationBuffer = {
      bufferLeave: jest.fn(),
      bufferJoin: jest.fn(),
    };
    mockBenchPromotionService = {
      schedulePromotion: jest.fn().mockResolvedValue(undefined),
      cancelPromotion: jest.fn().mockResolvedValue(undefined),
      isEligible: jest.fn().mockResolvedValue(false),
    };

    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      transaction: jest.fn(),
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

    // Default insert chain (with onConflictDoNothing for ROK-364)
    const insertChain = {
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockSignup]),
        }),
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

    // Transaction mock — executes callback with mockDb as the tx context
    mockDb.transaction.mockImplementation(
      async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
        {
          provide: RosterNotificationBufferService,
          useValue: mockRosterNotificationBuffer,
        },
        {
          provide: BenchPromotionService,
          useValue: mockBenchPromotionService,
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<SignupsService>(SignupsService);
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

    it('should return existing signup on duplicate (onConflictDoNothing returns empty)', async () => {
      mockDb.select
        // 1. Check event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockEvent]),
            }),
          }),
        })
        // 2. Pre-fetch user (before transaction)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        })
        // 3. Inside transaction: fetch existing signup after empty returning
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 4. Check existing roster assignment (ROK-452)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ id: 1 }]),
            }),
          }),
        });

      // Insert with onConflictDoNothing returns empty array (duplicate)
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.signup(1, 1);

      expect(result).toMatchObject({ id: expect.any(Number), eventId: 1 });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should handle concurrent duplicate signup attempts without crashing', async () => {
      // Simulates two concurrent requests for the same user+event.
      // Both pass application-level checks; the second hits onConflictDoNothing.
      mockDb.select
        // 1. Check event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockEvent]),
            }),
          }),
        })
        // 2. Pre-fetch user
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        })
        // 3. Inside transaction: fetch existing signup after conflict
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 4. Check existing roster assignment (ROK-452)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ id: 1 }]),
            }),
          }),
        });

      // onConflictDoNothing returns empty (conflict detected, no error thrown)
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // Should not throw — returns existing signup gracefully
      const result = await service.signup(1, 1);

      expect(result).toMatchObject({
        id: expect.any(Number),
        confirmationStatus: 'pending',
      });
    });

    it('should return full correct signup data on duplicate (user + status + note)', async () => {
      // Verifies that the idempotent path returns a well-formed SignupResponseDto
      // with accurate user info, confirmationStatus, and note from the existing row.
      const existingSignupWithNote = {
        ...mockSignup,
        note: 'Bringing healer',
        confirmationStatus: 'confirmed',
        characterId: null,
      };

      mockDb.select
        // 1. Check event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockEvent]),
            }),
          }),
        })
        // 2. Pre-fetch user
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        })
        // 3. Fetch existing signup inside transaction
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([existingSignupWithNote]),
            }),
          }),
        })
        // 4. Check existing roster assignment (ROK-452)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ id: 1 }]),
            }),
          }),
        });

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.signup(1, 1);

      expect(result).toMatchObject({
        id: expect.any(Number),
        eventId: 1,
        note: 'Bringing healer',
        confirmationStatus: 'confirmed',
        user: { username: 'testuser', id: 1 },
      });
      expect(result.character).toBeNull();
    });

    it('should fetch and return character data when existing duplicate signup has a characterId', async () => {
      // When the duplicate path finds an existing signup that has a confirmed character,
      // the response must include the character DTO (not null).
      const existingSignupWithChar = {
        ...mockSignup,
        characterId: mockCharacter.id,
        confirmationStatus: 'confirmed',
      };

      mockDb.select
        // 1. Check event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockEvent]),
            }),
          }),
        })
        // 2. Pre-fetch user
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        })
        // 3. Fetch existing signup inside transaction (has characterId)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([existingSignupWithChar]),
            }),
          }),
        })
        // 4. Check existing roster assignment (ROK-452)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ id: 1 }]),
            }),
          }),
        })
        // 5. getCharacterById called via private method
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockCharacter]),
            }),
          }),
        });

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.signup(1, 1);

      expect(result).toMatchObject({
        characterId: expect.any(String),
        character: { name: 'Frostweaver', role: 'dps' },
      });
    });

    it('should throw when onConflictDoNothing returns empty AND follow-up select returns nothing', async () => {
      // Edge case: insert is a no-op (duplicate) but the subsequent SELECT also
      // finds no row — this represents a data integrity anomaly (e.g. row deleted
      // mid-transaction). The service will throw a TypeError attempting to access
      // .characterId on undefined. This test documents that behavior.
      mockDb.select
        // 1. Check event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockEvent]),
            }),
          }),
        })
        // 2. Pre-fetch user
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        })
        // 3. Inside transaction: follow-up select returns nothing (row disappeared)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // Should throw because `existing` is undefined — accessing .characterId on undefined
      await expect(service.signup(1, 1)).rejects.toThrow();
    });

    it('should use onConflictDoNothing with target constraint columns on insert', async () => {
      // Verifies the insert chain calls onConflictDoNothing (not a plain insert)
      // to ensure the constraint-safe path is always used.
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
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        });

      const onConflictDoNothingMock = jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockSignup]),
      });
      const valuesMock = jest.fn().mockReturnValue({
        onConflictDoNothing: onConflictDoNothingMock,
        returning: jest.fn().mockResolvedValue([mockSignup]),
      });
      mockDb.insert.mockReturnValueOnce({ values: valuesMock });

      await service.signup(1, 1);

      expect(onConflictDoNothingMock).toHaveBeenCalled();
    });

    it('should create signup with a slotRole and not trigger duplicate path', async () => {
      // Ensures the normal (non-duplicate) path still works when a slotRole is provided.
      // Also verifies that a roster assignment is created for the inserted signup.
      const signupWithSlot = { ...mockSignup, id: 5 };

      const onConflictDoNothingMock = jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([signupWithSlot]),
      });

      mockDb.select
        // 1. Event exists (maxAttendees: null → no capacity check branch)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, maxAttendees: null }]),
            }),
          }),
        })
        // 2. Pre-fetch user (before transaction)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        })
        // 3. Inside transaction: position lookup for slotRole (returns empty array → position = 1)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      mockDb.insert
        // First call: signup insert
        .mockReturnValueOnce({
          values: jest.fn().mockReturnValue({
            onConflictDoNothing: onConflictDoNothingMock,
            returning: jest.fn().mockResolvedValue([signupWithSlot]),
          }),
        })
        // Second call: roster assignment insert
        .mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });

      const result = await service.signup(1, 1, { slotRole: 'dps' });

      expect(result.id).toBe(signupWithSlot.id);
      // ROK-598: Auto-slotted signups are implicitly confirmed
      expect(result.confirmationStatus).toBe('confirmed');
      // insert called twice: once for signup, once for roster assignment
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
      // The signup insert used onConflictDoNothing (not a raw insert)
      expect(onConflictDoNothingMock).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    // ROK-562: cancel() now fetches event duration to determine cancel status
    const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h from now → 'declined'
    const mockEventDuration = {
      duration: [
        futureStart,
        new Date(futureStart.getTime() + 2 * 60 * 60 * 1000),
      ],
    };

    const mockSelectEventDuration = () => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([mockEventDuration]),
        }),
      }),
    });

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
        // 2. Fetch event duration (ROK-562)
        .mockReturnValueOnce(mockSelectEventDuration())
        // 3. Check roster assignment — none
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await service.cancel(1, 1);

      // ROK-562: cancel now soft-deletes with time-based status
      expect(mockDb.update).toHaveBeenCalled();
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
        // 2. Fetch event duration (ROK-562)
        .mockReturnValueOnce(mockSelectEventDuration())
        // 3. Check roster assignment — found
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAssignment]),
            }),
          }),
        })
        // 4. Fetch event (for creatorId + title)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ creatorId: 5, title: 'Raid Night' }]),
            }),
          }),
        })
        // 5. Fetch user (for display name)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ username: 'Frostmage' }]),
            }),
          }),
        });

      await service.cancel(1, 1);

      // ROK-421: cancel now deletes roster assignment + soft-deletes signup
      expect(mockDb.delete).toHaveBeenCalled(); // roster assignment delete
      expect(mockDb.update).toHaveBeenCalled(); // soft-delete signup
      // ROK-534: organizer notification is now debounced via buffer
      expect(mockRosterNotificationBuffer.bufferLeave).toHaveBeenCalledWith({
        organizerId: 5,
        eventId: 1,
        eventTitle: 'Raid Night',
        userId: 1,
        displayName: 'Frostmage',
        vacatedRole: 'healer',
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
        // Fetch event duration (ROK-562)
        .mockReturnValueOnce(mockSelectEventDuration())
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

      // ROK-534: organizer notification is now debounced via buffer
      expect(mockRosterNotificationBuffer.bufferLeave).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 42 }),
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
      // ROK-534: organizer notification is now debounced via buffer
      expect(mockRosterNotificationBuffer.bufferLeave).toHaveBeenCalledWith({
        organizerId: 5,
        eventId: 1,
        eventTitle: 'Raid Night',
        userId: 1,
        displayName: 'Frostmage',
        vacatedRole: 'healer',
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

  describe('updateRoster — ROK-390 role change notifications', () => {
    it('should include "operator" in the permission error message', async () => {
      // Event exists, but user is not creator and not admin
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ ...mockEvent, creatorId: 999 }]),
          }),
        }),
      });

      await expect(
        service.updateRoster(1, 1, false, { assignments: [] }),
      ).rejects.toThrow(
        'Only event creator, admin, or operator can update roster',
      );
    });

    it('should notify player when role changes (healer → dps)', async () => {
      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      // Old assignment: user 1 was healer
      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'healer',
        position: 1,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        // 1. Event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid Night' }]),
            }),
          }),
        })
        // 2. Get signups
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        // 3. Get old assignments (for diff)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      // Delete old assignments
      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });

      // Insert new assignments
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'dps',
            position: 3,
            isOverride: false,
          },
        ],
      });

      // Wait for async notification
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          type: 'roster_reassigned',
          title: 'Role Changed',

          payload: expect.objectContaining({
            oldRole: 'healer',
            newRole: 'dps',
          }),
        }),
      );
    });

    it('should use bench_promoted type when moving from bench to a role', async () => {
      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'bench',
        position: 1,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid Night' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'tank',
            position: 1,
            isOverride: false,
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'bench_promoted',
          title: 'Promoted from Bench',
        }),
      );
    });

    it('should NOT notify when same-role position changes (DPS 1 → DPS 5)', async () => {
      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'dps',
        position: 1,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'dps',
            position: 5,
            isOverride: false,
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should send roster_reassigned when moved to bench', async () => {
      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'healer',
        position: 2,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid Night' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'bench',
            position: 1,
            isOverride: false,
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          title: 'Moved to Bench',
        }),
      );
    });
  });

  describe('notifyNewAssignments — ROK-487 generic roster language', () => {
    const emptyRoster = {
      eventId: 1,
      pool: [],
      assignments: [],
      slots: { player: 10, bench: 5 },
    };

    /**
     * Helper: set up mocks for updateRoster with NO prior assignment for the user
     * so that notifyNewAssignments fires (oldRole === null).
     */
    function setupNewAssignmentMocks(eventTitle: string, newSlot: string) {
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(emptyRoster);

      mockDb.select
        // 1. Event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: eventTitle }]),
            }),
          }),
        })
        // 2. Get signups
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        // 3. Get old assignments — empty, so this is a brand-new assignment
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      return service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: newSlot as never,
            position: 1,
            isOverride: false,
          },
        ],
      });
    }

    it('uses generic "assigned to the roster" message when newRole is player', async () => {
      await setupNewAssignmentMocks('Phasmophobia Night', 'player');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          message: "You've been assigned to the roster for Phasmophobia Night",
        }),
      );
    });

    it('does NOT include "Player role" wording when newRole is player', async () => {
      await setupNewAssignmentMocks('Phasmophobia Night', 'player');
      await new Promise((r) => setTimeout(r, 50));

      const call = (
        mockNotificationService.create.mock.calls[0] as [{ message: string }]
      )[0];
      expect(call.message).not.toContain('Player role');
      expect(call.message).not.toContain('the Player');
    });

    it('uses role-specific language for tank assignment', async () => {
      await setupNewAssignmentMocks('Mythic Raid', 'tank');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          message: "You've been assigned to the Tank role for Mythic Raid",
        }),
      );
    });

    it('uses role-specific language for healer assignment', async () => {
      await setupNewAssignmentMocks('Mythic Raid', 'healer');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          message: "You've been assigned to the Healer role for Mythic Raid",
        }),
      );
    });

    it('uses role-specific language for dps assignment', async () => {
      await setupNewAssignmentMocks('Mythic Raid', 'dps');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          message: "You've been assigned to the Dps role for Mythic Raid",
        }),
      );
    });

    it('passes newRole in payload for both generic and MMO assignments', async () => {
      await setupNewAssignmentMocks('Game Night', 'player');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ newRole: 'player' }),
        }),
      );
    });

    it('does not notify when user already had an assignment (oldRole is set)', async () => {
      // User already had a 'healer' assignment, so this is a role change (not new)
      // notifyNewAssignments should skip this (oldRole !== null)
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(emptyRoster);

      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'healer',
        position: 1,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'player' as never,
            position: 1,
            isOverride: false,
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      // notifyRoleChanges sends a notification for the role change,
      // but notifyNewAssignments should NOT fire because oldRole is non-null.
      // Neither call should contain 'roster for' (the generic new-assignment phrase).
      const calls = mockNotificationService.create.mock.calls as Array<
        [{ message?: string }]
      >;
      const genericAssignmentCall = calls.find(
        (c) =>
          typeof c[0].message === 'string' &&
          c[0].message.includes('assigned to the roster for'),
      );
      expect(genericAssignmentCall).toBeUndefined();
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

      expect(result).toMatchObject({
        characterId: expect.any(String),
        confirmationStatus: 'confirmed',
      });
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
