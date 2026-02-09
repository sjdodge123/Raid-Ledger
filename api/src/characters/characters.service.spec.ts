import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { CharactersService } from './characters.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('CharactersService', () => {
  let service: CharactersService;
  let mockDb: Record<string, jest.Mock>;

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
    isMain: true,
    itemLevel: 480,
    externalId: null,
    avatarUrl: null,
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

    // Default select chain
    const selectChain = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([mockCharacter]),
          orderBy: jest
            .fn()
            .mockResolvedValue([mockCharacter, mockAltCharacter]),
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

    // Transaction mock
    mockDb.transaction.mockImplementation(
      (callback: (tx: Record<string, jest.Mock>) => unknown) => {
        const tx = {
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
      ],
    }).compile();

    service = module.get<CharactersService>(CharactersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllForUser', () => {
    it('should return all characters for a user', async () => {
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
    it('should create a character', async () => {
      // Mock game lookup
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

      // Mock transaction to throw unique constraint error
      mockDb.transaction.mockImplementationOnce(
        (callback: (tx: Record<string, jest.Mock>) => unknown) => {
          const tx = {
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

    it('should demote existing main when creating new main character', async () => {
      // Mock game lookup
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGame]),
          }),
        }),
      });

      // Mock transaction
      mockDb.transaction.mockImplementation(
        (callback: (tx: Record<string, jest.Mock>) => unknown) => {
          const tx = {
            update: jest.fn().mockReturnValue({
              set: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue(undefined),
              }),
            }),
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
      expect(mockDb.transaction).toHaveBeenCalled();
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
    it('should delete a character', async () => {
      await service.delete(1, 'char-uuid-1');

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  describe('setMain', () => {
    it('should set character as main and demote existing main', async () => {
      const result = await service.setMain(1, 'char-uuid-2');

      expect(result.isMain).toBe(true);
      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });
});
