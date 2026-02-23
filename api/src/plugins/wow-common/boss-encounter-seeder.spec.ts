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
    const mockOnConflictDoUpdate = jest
      .fn()
      .mockReturnValue({ returning: mockReturning });
    const mockValues = jest
      .fn()
      .mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });

    // Mock for select().from() — returns boss rows for loot FK resolution
    // Must include all boss names referenced by loot entries in boss-loot-data.json
    const mockFrom = jest.fn().mockResolvedValue([
      { id: 1, name: 'Ragnaros', expansion: 'classic' },
      { id: 2, name: 'Nefarian', expansion: 'classic' },
      { id: 3, name: "Kel'Thuzad", expansion: 'classic' },
      { id: 4, name: 'Lucifron', expansion: 'classic' },
      { id: 5, name: 'Garr', expansion: 'classic' },
      { id: 6, name: 'Baron Geddon', expansion: 'classic' },
      { id: 7, name: 'Golemagg the Incinerator', expansion: 'classic' },
      { id: 8, name: 'Chromaggus', expansion: 'classic' },
      { id: 9, name: 'Onyxia', expansion: 'classic' },
      { id: 11, name: "C'Thun", expansion: 'classic' },
      { id: 12, name: 'Sapphiron', expansion: 'classic' },
      { id: 13, name: 'Edwin VanCleef', expansion: 'classic' },
      { id: 14, name: 'Interrogator Vishas', expansion: 'classic' },
      { id: 15, name: 'Bloodmage Thalnos', expansion: 'classic' },
      { id: 16, name: 'Houndmaster Loksey', expansion: 'classic' },
      { id: 17, name: 'Arcanist Doan', expansion: 'classic' },
      { id: 18, name: 'Herod', expansion: 'classic' },
      { id: 19, name: 'Scarlet Commander Mograine', expansion: 'classic' },
      { id: 20, name: 'High Inquisitor Whitemane', expansion: 'classic' },
      { id: 30, name: 'Attumen the Huntsman', expansion: 'tbc' },
      { id: 31, name: 'The Curator', expansion: 'tbc' },
      { id: 32, name: 'Prince Malchezaar', expansion: 'tbc' },
      { id: 33, name: 'Lady Vashj', expansion: 'tbc' },
      { id: 34, name: "Kael'thas Sunstrider", expansion: 'tbc' },
      { id: 35, name: 'Illidan Stormrage', expansion: 'tbc' },
      { id: 36, name: "Kil'jaeden", expansion: 'tbc' },
      { id: 40, name: 'Yogg-Saron', expansion: 'wotlk' },
      { id: 41, name: 'Algalon the Observer', expansion: 'wotlk' },
      { id: 42, name: 'Mimiron', expansion: 'wotlk' },
      { id: 43, name: 'Hodir', expansion: 'wotlk' },
      { id: 44, name: 'The Lich King', expansion: 'wotlk' },
      { id: 45, name: 'Professor Putricide', expansion: 'wotlk' },
      { id: 46, name: 'Sindragosa', expansion: 'wotlk' },
      { id: 50, name: 'Ragnaros', expansion: 'cata' },
      { id: 51, name: 'Majordomo Staghelm', expansion: 'cata' },
      { id: 52, name: "Beth'tilac", expansion: 'cata' },
      { id: 53, name: 'Alysrazor', expansion: 'cata' },
      { id: 54, name: 'Madness of Deathwing', expansion: 'cata' },
      { id: 55, name: 'Spine of Deathwing', expansion: 'cata' },
      { id: 56, name: 'Nefarian', expansion: 'cata' },
      { id: 57, name: 'Magmaw', expansion: 'cata' },
      { id: 60, name: "Aku'mai (SoD)", expansion: 'sod' },
      { id: 61, name: 'Twilight Lord Kelris (SoD)', expansion: 'sod' },
      { id: 62, name: 'Mekgineer Thermaplugg (SoD)', expansion: 'sod' },
      { id: 63, name: 'Shade of Eranikus (SoD)', expansion: 'sod' },
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
