import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { CharactersService } from './characters.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { EnrichmentsService } from '../enrichments/enrichments.service';

/**
 * Helper: build a mock tx.select that handles two sequential calls:
 *   1st call → duplicate claim check → .from().where().limit(1) → claimRows
 *   2nd call → charCount            → .from().where()           → countRows
 */
function mockTxSelectDualCall(claimRows: unknown[], countRows: unknown[]) {
  const fn = jest.fn();
  // 1st call: duplicate claim check (.where().limit())
  fn.mockReturnValueOnce({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(claimRows),
      }),
    }),
  });
  // 2nd call: charCount (where resolves directly)
  fn.mockReturnValueOnce({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(countRows),
    }),
  });
  return fn;
}

describe('CharactersService — crud', () => {
  let service: CharactersService;
  let mockDb: Record<string, jest.Mock>;
  let mockPluginRegistry: {
    getAdaptersForExtensionPoint: jest.Mock;
  };

  const mockGame = {
    id: 1,
    slug: 'world-of-warcraft',
    name: 'World of Warcraft',
    hasRoles: true,
    hasSpecs: true,
  };

  const mockCharacter = {
    id: 'char-uuid-1',
    userId: 1,
    gameId: 1,
    name: 'Thrall',
    realm: 'Area 52',
    class: 'Shaman',
    spec: 'Enhancement',
    role: 'dps',
    roleOverride: null,
    isMain: true,
    itemLevel: 480,
    externalId: null,
    avatarUrl: null,
    renderUrl: null,
    level: 80,
    race: 'Orc',
    faction: 'horde',
    lastSyncedAt: null,
    profileUrl: null,
    region: null,
    gameVariant: null,
    equipment: null,
    displayOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAltCharacter = {
    ...mockCharacter,
    id: 'char-uuid-2',
    name: 'Jaina',
    class: 'Mage',
    spec: 'Frost',
    isMain: false,
    displayOrder: 1,
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      transaction: jest.fn(),
    };

    mockPluginRegistry = {
      getAdaptersForExtensionPoint: jest.fn().mockReturnValue(new Map()),
    };

    // Default select chain
    const selectChain = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([mockCharacter]),
          orderBy: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockAltCharacter]),
          }),
        }),
        orderBy: jest.fn().mockResolvedValue([mockCharacter, mockAltCharacter]),
      }),
    };
    mockDb.select.mockReturnValue(selectChain);

    // Default insert chain
    const insertChain = {
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockCharacter]),
      }),
    };
    mockDb.insert.mockReturnValue(insertChain);

    // Default update chain
    const updateChain = {
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockCharacter]),
        }),
      }),
    };
    mockDb.update.mockReturnValue(updateChain);

    // Default delete chain
    const deleteChain = {
      where: jest.fn().mockResolvedValue(undefined),
    };
    mockDb.delete.mockReturnValue(deleteChain);

    // Default transaction mock — includes tx.select for duplicate claim check + ROK-206 charCount
    mockDb.transaction.mockImplementation(
      (callback: (tx: Record<string, jest.Mock>) => unknown) => {
        const tx = {
          select: mockTxSelectDualCall([], [{ charCount: 1 }]),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                returning: jest
                  .fn()
                  .mockResolvedValue([{ ...mockCharacter, isMain: true }]),
              }),
            }),
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockCharacter]),
            }),
          }),
        };
        return callback(tx);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharactersService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: PluginRegistryService, useValue: mockPluginRegistry },
        {
          provide: EnrichmentsService,
          useValue: {
            getEnrichmentsForEntity: jest.fn().mockResolvedValue([]),
            enqueueCharacterEnrichments: jest.fn().mockResolvedValue(0),
          },
        },
      ],
    }).compile();

    service = module.get<CharactersService>(CharactersService);
  });

  describe('findAllForUser', () => {
    it('should return all characters for a user', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest
              .fn()
              .mockResolvedValue([mockCharacter, mockAltCharacter]),
          }),
        }),
      });

      const result = await service.findAllForUser(1);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a character when found and owned', async () => {
      const result = await service.findOne(1, 'char-uuid-1');

      expect(result).toMatchObject({
        id: expect.any(String),
        name: 'Thrall',
      });
    });

    it('should throw NotFoundException when character not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.findOne(1, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when not owned by user', async () => {
      await expect(service.findOne(999, 'char-uuid-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('create', () => {
    it('should create a character (existing characters for game)', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGame]),
          }),
        }),
      });

      const dto = {
        gameId: 1,
        name: 'NewChar',
        realm: 'Stormrage',
        class: 'Paladin',
        role: 'tank' as const,
        isMain: false,
      };

      const result = await service.create(1, dto);

      expect(result).toMatchObject({ id: expect.any(String) });
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException if game not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const dto = {
        gameId: 99999,
        name: 'NewChar',
        isMain: false,
      };

      await expect(service.create(1, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException on duplicate character', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGame]),
          }),
        }),
      });

      mockDb.transaction.mockImplementationOnce(
        (callback: (tx: Record<string, jest.Mock>) => unknown) => {
          const tx = {
            select: mockTxSelectDualCall([], [{ charCount: 1 }]),
            insert: jest.fn().mockReturnValue({
              values: jest.fn().mockReturnValue({
                returning: jest
                  .fn()
                  .mockRejectedValue(new Error('unique_user_game_character')),
              }),
            }),
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 1,
        name: 'Thrall',
        realm: 'Area 52',
        isMain: false,
      };

      await expect(service.create(1, dto)).rejects.toThrow(ConflictException);
    });

    // ROK-206: First character for a game is automatically set as main
    it('should auto-promote first character for a game to main', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGame]),
          }),
        }),
      });

      const txInsertMock = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest
            .fn()
            .mockResolvedValue([{ ...mockCharacter, isMain: true }]),
        }),
      });

      mockDb.transaction.mockImplementationOnce(
        (callback: (tx: Record<string, jest.Mock>) => unknown) => {
          const tx = {
            select: mockTxSelectDualCall([], [{ charCount: 0 }]),
            insert: txInsertMock,
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 1,
        name: 'FirstChar',
        realm: 'Stormrage',
        isMain: false,
      };

      const result = await service.create(1, dto);
      expect(result.isMain).toBe(true);

      const insertCall = txInsertMock.mock.results[0].value.values;
      expect(insertCall).toHaveBeenCalledWith(
        expect.objectContaining({ isMain: true }),
      );
    });

    // ROK-206: Second character without isMain should NOT become main
    it('should not auto-main second character when isMain is not set', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGame]),
          }),
        }),
      });

      const txInsertMock = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest
            .fn()
            .mockResolvedValue([{ ...mockAltCharacter, isMain: false }]),
        }),
      });

      mockDb.transaction.mockImplementationOnce(
        (callback: (tx: Record<string, jest.Mock>) => unknown) => {
          const tx = {
            select: mockTxSelectDualCall([], [{ charCount: 1 }]),
            insert: txInsertMock,
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 1,
        name: 'AltChar',
        realm: 'Stormrage',
        isMain: false,
      };

      const result = await service.create(1, dto);
      expect(result.isMain).toBe(false);

      const insertCall = txInsertMock.mock.results[0].value.values;
      expect(insertCall).toHaveBeenCalledWith(
        expect.objectContaining({ isMain: false }),
      );
    });

    it('should demote existing main when creating new main character', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGame]),
          }),
        }),
      });

      const txUpdateMock = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      });

      mockDb.transaction.mockImplementationOnce(
        (callback: (tx: Record<string, jest.Mock>) => unknown) => {
          const tx = {
            select: mockTxSelectDualCall([], [{ charCount: 1 }]),
            update: txUpdateMock,
            insert: jest.fn().mockReturnValue({
              values: jest.fn().mockReturnValue({
                returning: jest
                  .fn()
                  .mockResolvedValue([{ ...mockCharacter, isMain: true }]),
              }),
            }),
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 1,
        name: 'NewMain',
        realm: 'Stormrage',
        isMain: true,
      };

      const result = await service.create(1, dto);
      expect(result.isMain).toBe(true);
      expect(txUpdateMock).toHaveBeenCalled();
    });

    // ROK-206: Creating new main with multiple existing chars swaps atomically
    it('should demote existing main and create new main in a single transaction', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGame]),
          }),
        }),
      });

      const txUpdateMock = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      });

      const newMainChar = {
        ...mockCharacter,
        id: 'char-uuid-3',
        name: 'NewMain',
        isMain: true,
      };
      const txInsertMock = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([newMainChar]),
        }),
      });

      mockDb.transaction.mockImplementationOnce(
        (callback: (tx: Record<string, jest.Mock>) => unknown) => {
          const tx = {
            select: mockTxSelectDualCall([], [{ charCount: 2 }]),
            update: txUpdateMock,
            insert: txInsertMock,
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 1,
        name: 'NewMain',
        realm: 'Stormrage',
        isMain: true,
      };

      const result = await service.create(1, dto);

      // New character is created as main
      expect(result.isMain).toBe(true);
      expect(result.name).toBe('NewMain');

      // Existing main was demoted (update was called)
      expect(txUpdateMock).toHaveBeenCalled();

      // Insert was called with isMain: true
      const insertCall = txInsertMock.mock.results[0].value.values;
      expect(insertCall).toHaveBeenCalledWith(
        expect.objectContaining({ isMain: true }),
      );
    });

    // ROK-312: Cross-user duplicate claim check
    it('should throw ConflictException when another user owns the same name+realm', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGame]),
          }),
        }),
      });

      // Duplicate claim check returns an existing claim by another user
      mockDb.transaction.mockImplementationOnce(
        (callback: (tx: Record<string, jest.Mock>) => unknown) => {
          const tx = {
            select: mockTxSelectDualCall(
              [{ id: 'other-char-id', userId: 999 }], // existingClaim found
              [{ charCount: 0 }],
            ),
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 1,
        name: 'Thrall',
        realm: 'Area 52',
        isMain: false,
      };

      await expect(service.create(1, dto)).rejects.toThrow(ConflictException);
    });

    // ROK-312: No-realm games skip duplicate claim check
    it('should skip duplicate claim check for non-realm characters', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGame]),
          }),
        }),
      });

      const txInsertMock = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest
            .fn()
            .mockResolvedValue([
              { ...mockCharacter, realm: null, isMain: true },
            ]),
        }),
      });

      // Only one tx.select call expected (charCount only, no claim check)
      // charCount uses .from().where() (no .limit())
      const txSelectMock = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ charCount: 0 }]),
        }),
      });

      mockDb.transaction.mockImplementationOnce(
        (callback: (tx: Record<string, jest.Mock>) => unknown) => {
          const tx = {
            select: txSelectMock,
            insert: txInsertMock,
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 1,
        name: 'Shadow',
        // No realm — should skip duplicate claim check
        isMain: false,
      };

      const result = await service.create(1, dto);
      expect(result.isMain).toBe(true); // auto-main (charCount: 0)
      // Only 1 select call (charCount), not 2 (no claim check)
      expect(txSelectMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('should update a character', async () => {
      const dto = { name: 'UpdatedName' };
      const result = await service.update(1, 'char-uuid-1', dto);
      expect(result).toMatchObject({ id: expect.any(String) });
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
