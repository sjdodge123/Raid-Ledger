import { Test, TestingModule } from '@nestjs/testing';
import { BossEncounterSeeder } from './boss-encounter-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

describe('BossEncounterSeeder', () => {
  let seeder: BossEncounterSeeder;
  let mockDb: {
    insert: jest.Mock;
    delete: jest.Mock;
    select: jest.Mock;
  };

  beforeEach(async () => {
    const mockReturning = jest.fn().mockResolvedValue([{ id: 1 }]);
    const mockOnConflictDoNothing = jest
      .fn()
      .mockReturnValue({ returning: mockReturning });
    const mockValues = jest
      .fn()
      .mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });

    // Mock for select().from() — returns boss rows for loot FK resolution
    const mockFrom = jest.fn().mockResolvedValue([
      { id: 1, name: 'Ragnaros', expansion: 'classic' },
      { id: 2, name: 'Nefarian', expansion: 'classic' },
      { id: 3, name: "Kel'Thuzad", expansion: 'classic' },
      { id: 10, name: 'Prince Malchezaar', expansion: 'tbc' },
      { id: 20, name: 'Yogg-Saron', expansion: 'wotlk' },
      { id: 30, name: 'Ragnaros', expansion: 'cata' },
      { id: 40, name: "Aku'mai (SoD)", expansion: 'sod' },
    ]);

    mockDb = {
      insert: jest.fn().mockReturnValue({ values: mockValues }),
      delete: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockReturnValue({ from: mockFrom }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BossEncounterSeeder,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    seeder = module.get<BossEncounterSeeder>(BossEncounterSeeder);
  });

  describe('seed()', () => {
    it('should insert boss encounters from bundled data', async () => {
      const result = await seeder.seed();

      expect(result).toHaveProperty('bossesInserted');
      expect(result).toHaveProperty('lootInserted');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should resolve boss FKs for loot insertion', async () => {
      await seeder.seed();

      // select() is called to build the boss lookup map
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('drop()', () => {
    it('should delete loot and boss data', async () => {
      await seeder.drop();

      // delete() called twice: loot first, then bosses
      expect(mockDb.delete).toHaveBeenCalledTimes(2);
    });
  });
});
