import { Test, TestingModule } from '@nestjs/testing';
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
    mockUpdateReturning,
  };
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

    it('should return true when a binding was removed', async () => {
      mocks.mockDeleteReturning.mockResolvedValue([{ id: 'uuid-1' }]);
      const result = await service.unbind('guild-123', 'channel-456');
      expect(result).toBe(true);
    });

    it('should return false when no binding was found', async () => {
      mocks.mockDeleteReturning.mockResolvedValue([]);
      const result = await service.unbind('guild-123', 'channel-999');
      expect(result).toBe(false);
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
});
