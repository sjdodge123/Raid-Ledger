/**
 * Unit tests for SettingsService ROK-349 methods:
 * - isDiscordBotSetupCompleted
 * - markDiscordBotSetupCompleted
 * - getDiscordBotCommunityName / setDiscordBotCommunityName
 * - getDiscordBotTimezone / setDiscordBotTimezone
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

describe('SettingsService — ROK-349 setup wizard methods', () => {
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
    process.env.JWT_SECRET = 'test-jwt-secret-for-rok349-settings-tests';

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

    mockEventEmitter = { emit: jest.fn() };

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
    jest.useRealTimers();
  });

  // ── isDiscordBotSetupCompleted ────────────────────────────────────────

  describe('isDiscordBotSetupCompleted', () => {
    it('should return false when setting is not in DB', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);

      const result = await service.isDiscordBotSetupCompleted();

      expect(result).toBe(false);
    });

    it('should return false when setting is "false"', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED, 'false'),
      ]);

      const result = await service.isDiscordBotSetupCompleted();

      expect(result).toBe(false);
    });

    it('should return true when setting is "true"', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED, 'true'),
      ]);

      const result = await service.isDiscordBotSetupCompleted();

      expect(result).toBe(true);
    });

    it('should return false when setting has any other value (e.g. "1", "yes")', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED, 'yes'),
      ]);

      const result = await service.isDiscordBotSetupCompleted();

      // Only "true" should be truthy
      expect(result).toBe(false);
    });
  });

  // ── markDiscordBotSetupCompleted ──────────────────────────────────────

  describe('markDiscordBotSetupCompleted', () => {
    it('should write "true" to the DISCORD_BOT_SETUP_COMPLETED setting', async () => {
      await service.markDiscordBotSetupCompleted();

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      // Verify it calls set() with the correct key via the DB insert
      const valuesCall = (
        mockDb._insertChain.values.mock.calls as { key: string }[][]
      )[0][0];
      expect(valuesCall.key).toBe(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED);
    });

    it('should make isDiscordBotSetupCompleted return true after being called', async () => {
      // Empty DB initially
      mockDb._selectChain.from.mockResolvedValue([]);
      await service.get(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED); // prime cache

      await service.markDiscordBotSetupCompleted();

      // Cache write-through: should now return true
      const result = await service.isDiscordBotSetupCompleted();
      expect(result).toBe(true);
    });

    it('should not throw when called multiple times', async () => {
      await expect(
        Promise.all([
          service.markDiscordBotSetupCompleted(),
          service.markDiscordBotSetupCompleted(),
        ]),
      ).resolves.not.toThrow();
    });
  });

  // ── getDiscordBotCommunityName / setDiscordBotCommunityName ───────────

  describe('getDiscordBotCommunityName', () => {
    it('should return null when no community name is set', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);

      const result = await service.getDiscordBotCommunityName();

      expect(result).toBeNull();
    });

    it('should return the community name when set', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME, 'Epic Raiders'),
      ]);

      const result = await service.getDiscordBotCommunityName();

      expect(result).toBe('Epic Raiders');
    });

    it('should return community name with special characters', async () => {
      const specialName = "Sköldpadde's Élite Raid Guild & Friends";
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME, specialName),
      ]);

      const result = await service.getDiscordBotCommunityName();

      expect(result).toBe(specialName);
    });
  });

  describe('setDiscordBotCommunityName', () => {
    it('should write the community name to DB', async () => {
      await service.setDiscordBotCommunityName('My Raid Community');

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      const valuesCall = (
        mockDb._insertChain.values.mock.calls as { key: string }[][]
      )[0][0];
      expect(valuesCall.key).toBe(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME);
    });

    it('should make getDiscordBotCommunityName return the new value (write-through)', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);
      await service.get(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME); // prime cache

      await service.setDiscordBotCommunityName('Warriors of Light');

      const result = await service.getDiscordBotCommunityName();
      expect(result).toBe('Warriors of Light');
    });

    it('should allow overwriting an existing community name', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME, 'Old Name'),
      ]);
      await service.get(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME); // prime cache

      await service.setDiscordBotCommunityName('New Name');

      const result = await service.getDiscordBotCommunityName();
      expect(result).toBe('New Name');
    });
  });

  // ── getDiscordBotTimezone / setDiscordBotTimezone ─────────────────────

  describe('getDiscordBotTimezone', () => {
    it('should return null when timezone is not set', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);

      const result = await service.getDiscordBotTimezone();

      expect(result).toBeNull();
    });

    it('should return the timezone string when set', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_TIMEZONE, 'America/New_York'),
      ]);

      const result = await service.getDiscordBotTimezone();

      expect(result).toBe('America/New_York');
    });

    it('should return UTC when that is the stored timezone', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_TIMEZONE, 'UTC'),
      ]);

      const result = await service.getDiscordBotTimezone();

      expect(result).toBe('UTC');
    });

    it('should return timezone with slashes intact', async () => {
      const tz = 'Europe/London';
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_TIMEZONE, tz),
      ]);

      const result = await service.getDiscordBotTimezone();

      expect(result).toBe(tz);
    });
  });

  describe('setDiscordBotTimezone', () => {
    it('should write the timezone to DB', async () => {
      await service.setDiscordBotTimezone('Asia/Tokyo');

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      const valuesCall = (
        mockDb._insertChain.values.mock.calls as { key: string }[][]
      )[0][0];
      expect(valuesCall.key).toBe(SETTING_KEYS.DISCORD_BOT_TIMEZONE);
    });

    it('should make getDiscordBotTimezone return the new value (write-through)', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);
      await service.get(SETTING_KEYS.DISCORD_BOT_TIMEZONE); // prime cache

      await service.setDiscordBotTimezone('Pacific/Auckland');

      const result = await service.getDiscordBotTimezone();
      expect(result).toBe('Pacific/Auckland');
    });

    it('should allow updating timezone from one value to another', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_BOT_TIMEZONE, 'UTC'),
      ]);
      await service.get(SETTING_KEYS.DISCORD_BOT_TIMEZONE); // prime cache

      await service.setDiscordBotTimezone('America/Chicago');

      const result = await service.getDiscordBotTimezone();
      expect(result).toBe('America/Chicago');
    });
  });

  // ── DISCORD_BOT_SETUP_COMPLETED key in schema ─────────────────────────

  describe('SETTING_KEYS schema completeness', () => {
    it('should have DISCORD_BOT_SETUP_COMPLETED in SETTING_KEYS', () => {
      expect(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED).toBe(
        'discord_bot_setup_completed',
      );
    });

    it('should have DISCORD_BOT_COMMUNITY_NAME in SETTING_KEYS', () => {
      expect(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME).toBe(
        'discord_bot_community_name',
      );
    });

    it('should have DISCORD_BOT_TIMEZONE in SETTING_KEYS', () => {
      expect(SETTING_KEYS.DISCORD_BOT_TIMEZONE).toBe('discord_bot_timezone');
    });
  });
});
