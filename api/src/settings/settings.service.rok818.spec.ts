/**
 * ROK-818: Regression tests for ITAD API key env var fallback.
 * Verifies that getItadApiKey() falls back to process.env.ITAD_API_KEY
 * when the DB value is null, preventing the "Best Price" section from
 * being empty on production when the admin panel was never configured.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from './settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SETTING_KEYS } from '../drizzle/schema';
import { encrypt } from './encryption.util';

/** Build a DB row as returned by drizzle select().from(appSettings). */
function makeRow(key: string, value: string) {
  return {
    key,
    encryptedValue: encrypt(value),
    updatedAt: new Date(),
    createdAt: new Date(),
    id: 1,
  };
}

describe('SettingsService — ROK-818 ITAD API key env var fallback', () => {
  let service: SettingsService;
  let mockDb: {
    select: jest.Mock;
    insert: jest.Mock;
    delete: jest.Mock;
    _selectChain: { from: jest.Mock };
    _insertChain: { values: jest.Mock };
    _deleteChain: { where: jest.Mock };
    _insertValuesChain: { onConflictDoUpdate: jest.Mock };
  };

  const originalEnv = process.env.ITAD_API_KEY;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-rok818-settings-tests';
    delete process.env.ITAD_API_KEY;

    mockDb = {
      _selectChain: { from: jest.fn() },
      _insertChain: { values: jest.fn() },
      _deleteChain: { where: jest.fn() },
      _insertValuesChain: {
        onConflictDoUpdate: jest.fn().mockResolvedValue([]),
      },
      select: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
    };

    mockDb.select.mockReturnValue(mockDb._selectChain);
    mockDb._selectChain.from.mockResolvedValue([]);
    mockDb.insert.mockReturnValue(mockDb._insertChain);
    mockDb._insertChain.values.mockReturnValue(mockDb._insertValuesChain);
    mockDb.delete.mockReturnValue(mockDb._deleteChain);
    mockDb._deleteChain.where.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ITAD_API_KEY = originalEnv;
    } else {
      delete process.env.ITAD_API_KEY;
    }
    jest.clearAllMocks();
  });

  it('returns DB value when ITAD_API_KEY is stored in settings', async () => {
    mockDb._selectChain.from.mockResolvedValue([
      makeRow(SETTING_KEYS.ITAD_API_KEY, 'db-itad-key'),
    ]);

    const result = await service.getItadApiKey();
    expect(result).toBe('db-itad-key');
  });

  it('falls back to process.env.ITAD_API_KEY when DB value is null', async () => {
    mockDb._selectChain.from.mockResolvedValue([]);
    process.env.ITAD_API_KEY = 'env-itad-key';

    const result = await service.getItadApiKey();
    expect(result).toBe('env-itad-key');
  });

  it('returns null when neither DB nor env var is set', async () => {
    mockDb._selectChain.from.mockResolvedValue([]);
    delete process.env.ITAD_API_KEY;

    const result = await service.getItadApiKey();
    expect(result).toBeNull();
  });

  it('prefers DB value over env var when both are set', async () => {
    mockDb._selectChain.from.mockResolvedValue([
      makeRow(SETTING_KEYS.ITAD_API_KEY, 'db-itad-key'),
    ]);
    process.env.ITAD_API_KEY = 'env-itad-key';

    const result = await service.getItadApiKey();
    expect(result).toBe('db-itad-key');
  });
});
