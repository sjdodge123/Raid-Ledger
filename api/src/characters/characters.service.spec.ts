import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { CharactersService } from './characters.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

/**
 * Helper: build a mock tx.select chain that resolves to `rows`.
 */
function mockTxSelect(rows: unknown[]) {
  return jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(rows),
    }),
  });
}

describe('CharactersService', () => {
  let service: CharactersService;
  let mockDb: Record<string, jest.Mock>;
  let mockPluginRegistry: {
    getAdaptersForExtensionPoint: jest.Mock;
  };

  const mockGame = {
    id: 'game-uuid-1',
    slug: 'wow',
    name: 'World of Warcraft',
    hasRoles: true,
    hasSpecs: true,
  };

  const mockCharacter = {
    id: 'char-uuid-1',
    userId: 1,
    gameId: 'game-uuid-1',
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

    // Default transaction mock — includes tx.select for ROK-206 charCount
    mockDb.transaction.mockImplementation(
      (callback: (tx: Record<string, jest.Mock>) => unknown) => {
        const tx = {
          select: mockTxSelect([{ charCount: 1 }]),
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
      ],
    }).compile();

    service = module.get<CharactersService>(CharactersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllForUser', () => {
    it('should return all characters for a user', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([mockCharacter, mockAltCharacter]),
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

      expect(result.id).toBe(mockCharacter.id);
      expect(result.name).toBe('Thrall');
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
        gameId: 'game-uuid-1',
        name: 'NewChar',
        realm: 'Stormrage',
        class: 'Paladin',
        role: 'tank' as const,
      };

      const result = await service.create(1, dto);

      expect(result.id).toBe(mockCharacter.id);
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
        gameId: 'nonexistent-game',
        name: 'NewChar',
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
            select: mockTxSelect([{ charCount: 1 }]),
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
        gameId: 'game-uuid-1',
        name: 'Thrall',
        realm: 'Area 52',
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
            select: mockTxSelect([{ charCount: 0 }]),
            insert: txInsertMock,
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 'game-uuid-1',
        name: 'FirstChar',
        realm: 'Stormrage',
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
            select: mockTxSelect([{ charCount: 1 }]),
            insert: txInsertMock,
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 'game-uuid-1',
        name: 'AltChar',
        realm: 'Stormrage',
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
            select: mockTxSelect([{ charCount: 1 }]),
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
        gameId: 'game-uuid-1',
        name: 'NewMain',
        realm: 'Stormrage',
        isMain: true,
      };

      const result = await service.create(1, dto);
      expect(result.isMain).toBe(true);
      expect(txUpdateMock).toHaveBeenCalled();
    });

    // ROK-206: Catch idx_one_main_per_game constraint as 409
    it('should throw ConflictException on main constraint violation', async () => {
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
            select: mockTxSelect([{ charCount: 1 }]),
            update: jest.fn().mockReturnValue({
              set: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue(undefined),
              }),
            }),
            insert: jest.fn().mockReturnValue({
              values: jest.fn().mockReturnValue({
                returning: jest
                  .fn()
                  .mockRejectedValue(new Error('idx_one_main_per_game')),
              }),
            }),
          };
          return callback(tx);
        },
      );

      const dto = {
        gameId: 'game-uuid-1',
        name: 'DupeMain',
        isMain: true,
      };

      await expect(service.create(1, dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update a character', async () => {
      const dto = { name: 'UpdatedName' };
      const result = await service.update(1, 'char-uuid-1', dto);
      expect(result.id).toBe(mockCharacter.id);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a non-main character', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ ...mockAltCharacter, userId: 1 }]),
          }),
        }),
      });

      await service.delete(1, 'char-uuid-2');
      expect(mockDb.delete).toHaveBeenCalled();
    });

    // ROK-206: Deleting main auto-promotes lowest-order alt
    it('should auto-promote lowest-order alt when main is deleted', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ ...mockCharacter, isMain: true }]),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAltCharacter]),
            }),
          }),
        }),
      });

      await service.delete(1, 'char-uuid-1');
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
    });

    // ROK-206: Deleting main with no alts does not fail
    it('should handle deleting main when no alts remain', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ ...mockCharacter, isMain: true }]),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      await service.delete(1, 'char-uuid-1');
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('setMain', () => {
    it('should set character as main and demote existing main', async () => {
      const result = await service.setMain(1, 'char-uuid-2');
      expect(result.isMain).toBe(true);
      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });

  describe('importExternal', () => {
    it('should throw NotFoundException when no adapter found', async () => {
      mockPluginRegistry.getAdaptersForExtensionPoint.mockReturnValue(
        new Map(),
      );

      await expect(
        service.importExternal(1, {
          name: 'Thrall',
          realm: 'area-52',
          region: 'us',
          gameVariant: 'retail',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
