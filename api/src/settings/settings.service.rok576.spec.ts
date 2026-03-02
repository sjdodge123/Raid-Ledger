/**
 * Unit tests for SettingsService ROK-576 methods:
 * - getEventAutoExtendEnabled (defaults to true when not set)
 * - getEventAutoExtendIncrementMinutes (defaults to 15)
 * - getEventAutoExtendMaxOverageMinutes (defaults to 720)
 * - getEventAutoExtendMinVoiceMembers (defaults to 2)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from './settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SETTING_KEYS } from '../drizzle/schema';
import { encrypt } from './encryption.util';

function makeRow(key: string, value: string) {
  return {
    key,
    encryptedValue: encrypt(value),
    updatedAt: new Date(),
    createdAt: new Date(),
    id: 1,
  };
}

describe('SettingsService — ROK-576 auto-extend methods', () => {
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
  let mockEventEmitter: Partial<EventEmitter2>;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-rok576-settings-tests';

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

    mockEventEmitter = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── getEventAutoExtendEnabled ────────────────────────────────────────────

  describe('getEventAutoExtendEnabled', () => {
    it('defaults to true when the setting is not in the DB', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);

      const result = await service.getEventAutoExtendEnabled();

      expect(result).toBe(true);
    });

    it('returns true when DB value is "true"', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.EVENT_AUTO_EXTEND_ENABLED, 'true'),
      ]);

      const result = await service.getEventAutoExtendEnabled();

      expect(result).toBe(true);
    });

    it('returns false when DB value is "false"', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.EVENT_AUTO_EXTEND_ENABLED, 'false'),
      ]);

      const result = await service.getEventAutoExtendEnabled();

      expect(result).toBe(false);
    });
  });

  // ─── getEventAutoExtendIncrementMinutes ───────────────────────────────────

  describe('getEventAutoExtendIncrementMinutes', () => {
    it('defaults to 15 when the setting is not in the DB', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);

      const result = await service.getEventAutoExtendIncrementMinutes();

      expect(result).toBe(15);
    });

    it('returns the configured integer value from DB', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.EVENT_AUTO_EXTEND_INCREMENT_MINUTES, '30'),
      ]);

      const result = await service.getEventAutoExtendIncrementMinutes();

      expect(result).toBe(30);
    });

    it('returns 15 when DB value is not a valid integer', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(
          SETTING_KEYS.EVENT_AUTO_EXTEND_INCREMENT_MINUTES,
          'not-a-number',
        ),
      ]);

      const result = await service.getEventAutoExtendIncrementMinutes();

      expect(result).toBe(15);
    });
  });

  // ─── getEventAutoExtendMaxOverageMinutes ──────────────────────────────────

  describe('getEventAutoExtendMaxOverageMinutes', () => {
    it('defaults to 720 when the setting is not in the DB', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);

      const result = await service.getEventAutoExtendMaxOverageMinutes();

      expect(result).toBe(720);
    });

    it('returns the configured integer value from DB', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.EVENT_AUTO_EXTEND_MAX_OVERAGE_MINUTES, '60'),
      ]);

      const result = await service.getEventAutoExtendMaxOverageMinutes();

      expect(result).toBe(60);
    });

    it('returns 720 when DB value is not a valid integer', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.EVENT_AUTO_EXTEND_MAX_OVERAGE_MINUTES, ''),
      ]);

      const result = await service.getEventAutoExtendMaxOverageMinutes();

      expect(result).toBe(720);
    });
  });

  // ─── getEventAutoExtendMinVoiceMembers ────────────────────────────────────

  describe('getEventAutoExtendMinVoiceMembers', () => {
    it('defaults to 2 when the setting is not in the DB', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);

      const result = await service.getEventAutoExtendMinVoiceMembers();

      expect(result).toBe(2);
    });

    it('returns the configured integer value from DB', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.EVENT_AUTO_EXTEND_MIN_VOICE_MEMBERS, '5'),
      ]);

      const result = await service.getEventAutoExtendMinVoiceMembers();

      expect(result).toBe(5);
    });

    it('returns 2 when DB value is not a valid integer', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.EVENT_AUTO_EXTEND_MIN_VOICE_MEMBERS, 'abc'),
      ]);

      const result = await service.getEventAutoExtendMinVoiceMembers();

      expect(result).toBe(2);
    });

    it('returns 1 when configured to 1 (minimum meaningful value)', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.EVENT_AUTO_EXTEND_MIN_VOICE_MEMBERS, '1'),
      ]);

      const result = await service.getEventAutoExtendMinVoiceMembers();

      expect(result).toBe(1);
    });
  });
});
