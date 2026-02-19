import { Test, TestingModule } from '@nestjs/testing';
import { ChannelBindingsService } from './channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

describe('ChannelBindingsService', () => {
  let service: ChannelBindingsService;

  // Mock chain for drizzle queries
  const mockReturning = jest.fn();
  const mockOnConflictDoUpdate = jest
    .fn()
    .mockReturnValue({ returning: mockReturning });
  const mockValues = jest
    .fn()
    .mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  const mockInsert = jest.fn().mockReturnValue({ values: mockValues });

  const mockDeleteReturning = jest.fn();
  const mockDeleteWhere = jest
    .fn()
    .mockReturnValue({ returning: mockDeleteReturning });
  const mockDelete = jest.fn().mockReturnValue({ where: mockDeleteWhere });

  const mockSelectLimit = jest.fn();
  const mockSelectWhere = jest.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectFrom = jest.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = jest.fn().mockReturnValue({ from: mockSelectFrom });

  const mockDb = {
    insert: mockInsert,
    delete: mockDelete,
    select: mockSelect,
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelBindingsService,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get(ChannelBindingsService);
  });

  describe('detectBehavior', () => {
    it('should detect text channels as game-announcements', () => {
      expect(service.detectBehavior('text')).toBe('game-announcements');
    });

    it('should detect voice channels as game-voice-monitor', () => {
      expect(service.detectBehavior('voice')).toBe('game-voice-monitor');
    });
  });

  describe('bind', () => {
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
      mockReturning.mockResolvedValue([mockBinding]);

      const result = await service.bind(
        'guild-123',
        'channel-456',
        'text',
        'game-announcements',
        null,
      );

      expect(result).toEqual(mockBinding);
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  describe('unbind', () => {
    it('should return true when a binding was removed', async () => {
      mockDeleteReturning.mockResolvedValue([{ id: 'uuid-1' }]);

      const result = await service.unbind('guild-123', 'channel-456');

      expect(result).toBe(true);
    });

    it('should return false when no binding was found', async () => {
      mockDeleteReturning.mockResolvedValue([]);

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
      // getBindings uses select().from().where() — no limit
      const whereReturn = mockBindings;
      mockSelectFrom.mockReturnValue({
        where: jest.fn().mockResolvedValue(whereReturn),
      });

      const result = await service.getBindings('guild-123');

      expect(result).toEqual(mockBindings);
    });
  });

  describe('getChannelForGame', () => {
    it('should return channel ID when a game binding exists', async () => {
      // getChannelForGame uses select({}).from().where().limit()
      const limitMock = jest
        .fn()
        .mockResolvedValue([{ channelId: 'channel-789' }]);
      const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
      const fromMock = jest.fn().mockReturnValue({ where: whereMock });
      mockSelect.mockReturnValueOnce({ from: fromMock });

      const result = await service.getChannelForGame('guild-123', 'game-uuid');

      expect(result).toBe('channel-789');
    });

    it('should return null when no game binding exists', async () => {
      const limitMock = jest.fn().mockResolvedValue([]);
      const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
      const fromMock = jest.fn().mockReturnValue({ where: whereMock });
      mockSelect.mockReturnValueOnce({ from: fromMock });

      const result = await service.getChannelForGame('guild-123', 'game-uuid');

      expect(result).toBeNull();
    });
  });
});
