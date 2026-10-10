import { Test, TestingModule } from '@nestjs/testing';
import { DungeonQuestSeeder } from './dungeon-quest-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { readFileSync } from 'fs';
import { join } from 'path';

const readData = (file: string): Array<Record<string, unknown>> =>
  JSON.parse(readFileSync(join(__dirname, 'data', file), 'utf-8')) as Array<
    Record<string, unknown>
  >;
const classicData = readData('dungeon-quest-data.json');
const foreverData = readData('forever-dungeon-quest-data.json');

jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, readFile: jest.fn(actual.readFile) };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsPromises = require('fs/promises') as { readFile: jest.Mock };

let seeder: DungeonQuestSeeder;
let mockValues: jest.Mock;
let mockDb: {
  insert: jest.Mock;
  delete: jest.Mock;
};

async function setupEach() {
  const mockReturning = jest.fn().mockResolvedValue([{ id: 1 }]);
  const mockOnConflictDoNothing = jest
    .fn()
    .mockReturnValue({ returning: mockReturning });
  mockValues = jest
    .fn()
    .mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });

  mockDb = {
    insert: jest.fn().mockReturnValue({ values: mockValues }),
    delete: jest.fn().mockResolvedValue(undefined),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DungeonQuestSeeder,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();

  seeder = module.get<DungeonQuestSeeder>(DungeonQuestSeeder);
}

describe('DungeonQuestSeeder', () => {
  beforeEach(() => setupEach());

  describe('seed()', () => {
    it('should insert dungeon quests from bundled data', async () => {
      const result = await seeder.seed();

      expect(result).toHaveProperty('inserted');
      expect(result).toHaveProperty('total');
      expect(result.total).toBeGreaterThan(0);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should return total matching the bundled data count', async () => {
      const result = await seeder.seed();

      // The bundled data should have a reasonable number of quests
      expect(result.total).toBeGreaterThanOrEqual(100);
    });
  });

  describe('seed() — Forever file (ROK-1748)', () => {
    const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises');
    afterEach(() => fsPromises.readFile.mockImplementation(actual.readFile));

    it('reads both bundled files; the shipped [] forever file is a no-op', async () => {
      const result = await seeder.seed();
      const paths = fsPromises.readFile.mock.calls.map((c) => String(c[0]));
      expect(paths.some((p) => p.endsWith('dungeon-quest-data.json'))).toBe(true);
      expect(paths.some((p) => p.endsWith('forever-dungeon-quest-data.json'))).toBe(true);
      expect(foreverData).toEqual([]);
      expect(result.total).toBe(classicData.length);
    });

    it('appends forever rows to the same upsert', async () => {
      const row = { ...classicData[0], questId: 999001, expansion: 'forever' };
      fsPromises.readFile.mockImplementation((p: string, enc: BufferEncoding) =>
        String(p).endsWith('forever-dungeon-quest-data.json')
          ? Promise.resolve(JSON.stringify([row]))
          : actual.readFile(p, enc),
      );
      const result = await seeder.seed();
      expect(result.total).toBe(classicData.length + 1);
      const inserted = mockValues.mock.calls.flatMap((c) => c[0] as unknown[]);
      expect(inserted).toContainEqual(row);
    });
  });

  describe('drop()', () => {
    it('should delete all dungeon quest data', async () => {
      await seeder.drop();

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
