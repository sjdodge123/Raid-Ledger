import { Test, TestingModule } from '@nestjs/testing';
import type { ChannelBindingConfig } from '@raid-ledger/contract';
import { ChannelBindingsService } from './channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

// ─── Mock DB chain ──────────────────────────────────────────────────────────

function buildMockDb() {
  const mockInsertReturning = jest.fn();
  const mockInsertValues = jest
    .fn()
    .mockReturnValue({ returning: mockInsertReturning });
  const mockInsert = jest.fn().mockReturnValue({ values: mockInsertValues });
  const mockDeleteReturning = jest.fn();
  const mockDeleteWhere = jest
    .fn()
    .mockReturnValue({ returning: mockDeleteReturning });
  const mockDelete = jest.fn().mockReturnValue({ where: mockDeleteWhere });
  const mockSelectLimit = jest.fn();
  const mockSelectWhere = jest.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectFrom = jest.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = jest.fn().mockReturnValue({ from: mockSelectFrom });
  const mockUpdateReturning = jest.fn();
  const mockUpdateWhere = jest
    .fn()
    .mockReturnValue({ returning: mockUpdateReturning });
  const mockUpdateSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = jest.fn().mockReturnValue({ set: mockUpdateSet });

  return {
    mockDb: {
      insert: mockInsert,
      delete: mockDelete,
      select: mockSelect,
      update: mockUpdate,
    },
    mockInsertReturning,
    mockInsert,
    mockDeleteReturning,
    mockSelect,
    mockSelectFrom,
    mockSelectLimit,
    mockUpdateSet,
    mockUpdateReturning,
  };
}

// ─── ROK-1462 re-bind fixture ───────────────────────────────────────────────

const GUILD = 'guild-123';
const CHANNEL = 'channel-456';

/** A non-default tuning an admin would have set from the web binding form. */
const STORED: ChannelBindingConfig = {
  autoClose: false,
  minPlayers: 7,
  gracePeriod: 120,
};

/**
 * Wire the mock DB as a single-row store with PostgreSQL UPDATE semantics:
 * only the columns named in `.set()` are written; any column the statement
 * omits keeps its stored value. Returns a getter for the row as it stands
 * "in the database" after the write.
 */
function seedExistingBinding(
  mocks: ReturnType<typeof buildMockDb>,
  config: ChannelBindingConfig | null,
): () => Record<string, unknown> {
  let row: Record<string, unknown> = {
    id: 'uuid-1',
    guildId: GUILD,
    channelId: CHANNEL,
    channelType: 'voice',
    bindingPurpose: 'general-lobby',
    gameId: null,
    recurrenceGroupId: null,
    config,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  // findExistingBinding → hit, so upsertBinding takes the UPDATE branch.
  mocks.mockSelectLimit.mockResolvedValue([{ id: row.id }]);
  mocks.mockUpdateSet.mockImplementation((set: Record<string, unknown>) => {
    row = { ...row, ...set };
    return { where: () => ({ returning: () => Promise.resolve([row]) }) };
  });
  return () => row;
}

describe('ChannelBindingsService', () => {
  let service: ChannelBindingsService;
  let mocks: ReturnType<typeof buildMockDb>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mocks = buildMockDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelBindingsService,
        { provide: DrizzleAsyncProvider, useValue: mocks.mockDb },
      ],
    }).compile();

    service = module.get(ChannelBindingsService);
  });

  describe('detectBehavior', () => {
    it('should detect text channels as game-announcements', () => {
      expect(service.detectBehavior('text')).toBe('game-announcements');
    });

    it('should detect voice channels with game as game-voice-monitor', () => {
      expect(service.detectBehavior('voice', 1)).toBe('game-voice-monitor');
    });

    it('should detect voice channels without game as general-lobby', () => {
      expect(service.detectBehavior('voice')).toBe('general-lobby');
      expect(service.detectBehavior('voice', null)).toBe('general-lobby');
    });
  });

  describe('bind and unbind', () => {
    it('should insert a binding and return it', async () => {
      const mockBinding = {
        id: 'uuid-1',
        guildId: 'guild-123',
        channelId: 'channel-456',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
        gameId: null,
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // select finds no existing binding → insert path
      mocks.mockSelectLimit.mockResolvedValueOnce([]);
      mocks.mockInsertReturning.mockResolvedValue([mockBinding]);
      const result = await service.bind(
        'guild-123',
        'channel-456',
        'text',
        'game-announcements',
        null,
      );
      expect(result).toEqual({ binding: mockBinding, replacedChannelIds: [] });
      expect(mocks.mockInsert).toHaveBeenCalled();
    });

    // ROK-1462 (AC2): unbind() reports the REMOVED purposes so `/unbind` can
    // title its reply `#channel -> Purpose` like `/bind` does.
    it('should return the removed purposes when a binding was removed', async () => {
      mocks.mockDeleteReturning.mockResolvedValue([
        { id: 'uuid-1', bindingPurpose: 'general-lobby' },
      ]);
      const result = await service.unbind('guild-123', 'channel-456');
      expect(result).toEqual(['general-lobby']);
    });

    it('should return an empty array when no binding was found', async () => {
      mocks.mockDeleteReturning.mockResolvedValue([]);
      const result = await service.unbind('guild-123', 'channel-999');
      expect(result).toEqual([]);
    });
  });

  describe('getBindings', () => {
    it('should return all bindings for a guild', async () => {
      const mockBindings = [
        { id: 'uuid-1', guildId: 'guild-123', channelId: 'ch-1' },
        { id: 'uuid-2', guildId: 'guild-123', channelId: 'ch-2' },
      ];
      mocks.mockSelectFrom.mockReturnValue({
        where: jest.fn().mockResolvedValue(mockBindings),
      });
      const result = await service.getBindings('guild-123');
      expect(result).toEqual(mockBindings);
    });
  });

  describe('gameExists', () => {
    function mockSelectChain(resolvedRows: any[]) {
      const limitMock = jest.fn().mockResolvedValue(resolvedRows);
      const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
      const fromMock = jest.fn().mockReturnValue({ where: whereMock });
      mocks.mockSelect.mockReturnValueOnce({ from: fromMock });
    }

    it('should return true when the game exists', async () => {
      mockSelectChain([{ id: 42 }]);
      const result = await service.gameExists(42);
      expect(result).toBe(true);
    });

    it('should return false when the game does not exist', async () => {
      mockSelectChain([]);
      const result = await service.gameExists(99999);
      expect(result).toBe(false);
    });

    it('should return false when gameId is 0 and no row found', async () => {
      // gameId=0 is falsy but must still be queried — !!undefined is false
      mockSelectChain([]);
      const result = await service.gameExists(0);
      expect(result).toBe(false);
    });

    it('should return true when gameId is 0 and a row is found', async () => {
      // Verifies !!row coercion works correctly when a row is present
      mockSelectChain([{ id: 0 }]);
      const result = await service.gameExists(0);
      expect(result).toBe(true);
    });

    it('should return a boolean (not a row object or undefined)', async () => {
      mockSelectChain([{ id: 5 }]);
      const result = await service.gameExists(5);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getChannelForGame', () => {
    function mockSelectChain(resolvedRows: any[]) {
      const limitMock = jest.fn().mockResolvedValue(resolvedRows);
      const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
      const fromMock = jest.fn().mockReturnValue({ where: whereMock });
      mocks.mockSelect.mockReturnValueOnce({ from: fromMock });
    }

    it('should return channel ID when a game binding exists', async () => {
      mockSelectChain([{ channelId: 'channel-789' }]);
      const result = await service.getChannelForGame('guild-123', 42);
      expect(result).toBe('channel-789');
    });

    it('should return null when no game binding exists', async () => {
      mockSelectChain([]);
      const result = await service.getChannelForGame('guild-123', 42);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // ROK-1462: re-binding an already-bound channel must not destroy its stored
  // tuning. `/bind` calls bind() with NO config (bind.command.ts passes
  // `undefined`), and the UPDATE branch used to coerce that to `{}` — so the
  // admin's "Auto-close off, minPlayers 7, grace 120" was silently reset to
  // defaults on the next `/bind`. Pre-existing behaviour; ROK-1462 only made it
  // visible by printing the settings in the reply.
  // ---------------------------------------------------------------------------
  describe('re-bind config preservation (ROK-1462)', () => {
    /** Seed the stored binding; returns a getter for the persisted row. */
    const seed = (config: ChannelBindingConfig | null) =>
      seedExistingBinding(mocks, config);

    /** Re-bind the same channel the way `/bind` does — no config argument. */
    function rebind(config?: ChannelBindingConfig) {
      return service.bind(
        GUILD,
        CHANNEL,
        'voice',
        'general-lobby',
        null,
        config,
        null,
      );
    }

    it('keeps the stored config when /bind supplies none', async () => {
      const stored = seed(STORED);

      const { binding } = await rebind(undefined);

      expect(binding.config).toEqual(STORED);
      expect(stored().config).toEqual(STORED);
    });

    it('does not write the config column at all when none is supplied', async () => {
      seed(STORED);

      await rebind(undefined);

      const [writeSet] = mocks.mockUpdateSet.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(Object.keys(writeSet)).not.toContain('config');
    });

    it('still replaces the stored config when one is supplied', async () => {
      const stored = seed(STORED);

      const replacement: ChannelBindingConfig = {
        autoClose: true,
        minPlayers: 3,
      };
      const { binding } = await rebind(replacement);

      expect(binding.config).toEqual(replacement);
      expect(stored().config).toEqual(replacement);
    });

    it('treats an explicit empty config as a real clear', async () => {
      const stored = seed(STORED);

      const { binding } = await rebind({});

      expect(binding.config).toEqual({});
      expect(stored().config).toEqual({});
    });
  });
});
