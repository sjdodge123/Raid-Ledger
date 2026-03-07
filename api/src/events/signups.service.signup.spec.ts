import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';

describe('SignupsService — signup', () => {
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
  const mockEvent = { id: 1, title: 'Test Event', creatorId: 99 };
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

  function setupSelectChain() {
    mockDb.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([mockEvent]),
        }),
        leftJoin: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ orderBy: jest.fn().mockResolvedValue([]) }),
          }),
          where: jest
            .fn()
            .mockReturnValue({ orderBy: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    });
  }

  function setupMutationChains() {
    mockDb.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockSignup]),
        }),
        returning: jest.fn().mockResolvedValue([mockSignup]),
      }),
    });
    mockDb.delete.mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockSignup]),
      }),
    });
    mockDb.update.mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockSignup]),
        }),
      }),
    });
    mockDb.transaction.mockImplementation(
      async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
    );
  }

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
    setupSelectChain();
    setupMutationChains();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
        {
          provide: RosterNotificationBufferService,
          useValue: mockRosterNotificationBuffer,
        },
        { provide: BenchPromotionService, useValue: mockBenchPromotionService },
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
});
