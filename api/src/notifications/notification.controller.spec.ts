import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';

interface AuthenticatedRequest {
  user: { id: number; discordId?: string };
}

describe('NotificationController — getChannelAvailability (ROK-180 AC-7)', () => {
  let controller: NotificationController;

  const mockNotificationService = {
    getAll: jest.fn().mockResolvedValue([]),
    getUnreadCount: jest.fn().mockResolvedValue(0),
    markRead: jest.fn().mockResolvedValue(undefined),
    markAllRead: jest.fn().mockResolvedValue(undefined),
    getPreferences: jest
      .fn()
      .mockResolvedValue({ userId: 1, channelPrefs: {} }),
    updatePreferences: jest
      .fn()
      .mockResolvedValue({ userId: 1, channelPrefs: {} }),
  };

  const mockBotClientService = {
    isConnected: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        { provide: NotificationService, useValue: mockNotificationService },
        {
          provide: DiscordBotClientService,
          useValue: mockBotClientService,
        },
      ],
    }).compile();

    controller = module.get<NotificationController>(NotificationController);
  });

  describe('GET /notifications/channels', () => {
    it('should return discord available when user has discordId and bot is connected', () => {
      const req = {
        user: { id: 1, discordId: '123456789' },
      } as AuthenticatedRequest;

      const result = controller.getChannelAvailability(req);

      expect(result).toEqual({ discord: { available: true } });
    });

    it('should return discord unavailable when user has no discordId', () => {
      const req = {
        user: { id: 1, discordId: undefined },
      } as AuthenticatedRequest;

      const result = controller.getChannelAvailability(req);

      expect(result.discord.available).toBe(false);
      expect(result.discord.reason).toBe(
        'Link your Discord account to enable Discord notifications',
      );
    });

    it('should return discord unavailable when bot is not connected', () => {
      mockBotClientService.isConnected.mockReturnValueOnce(false);
      const req = {
        user: { id: 1, discordId: '123456789' },
      } as AuthenticatedRequest;

      const result = controller.getChannelAvailability(req);

      expect(result.discord.available).toBe(false);
      expect(result.discord.reason).toBe('Discord bot is not connected');
    });

    it('should not include reason when discord is available', () => {
      const req = {
        user: { id: 1, discordId: '123456789' },
      } as AuthenticatedRequest;

      const result = controller.getChannelAvailability(req);

      expect(result.discord.reason).toBeUndefined();
    });

    it('should return discord unavailable with discord reason when no discordId even if bot is disconnected', () => {
      mockBotClientService.isConnected.mockReturnValue(false);
      const req = {
        user: { id: 2, discordId: undefined },
      } as AuthenticatedRequest;

      const result = controller.getChannelAvailability(req);

      // Should return the discordId-missing reason (evaluated first in the if chain)
      expect(result.discord.available).toBe(false);
      expect(result.discord.reason).toBe(
        'Link your Discord account to enable Discord notifications',
      );
    });
  });

  describe('GET /notifications', () => {
    it('should call notificationService.getAll with parsed limit and offset', async () => {
      const req = { user: { id: 1 } } as AuthenticatedRequest;

      await controller.getNotifications(req, '10', '5');

      expect(mockNotificationService.getAll).toHaveBeenCalledWith(1, 10, 5);
    });

    it('should use defaults when limit and offset are not provided', async () => {
      const req = { user: { id: 1 } } as AuthenticatedRequest;

      await controller.getNotifications(req);

      expect(mockNotificationService.getAll).toHaveBeenCalledWith(1, 20, 0);
    });

    it('should cap limit at 100', async () => {
      const req = { user: { id: 1 } } as AuthenticatedRequest;

      await controller.getNotifications(req, '9999', '0');

      expect(mockNotificationService.getAll).toHaveBeenCalledWith(1, 100, 0);
    });

    it('should clamp negative offset to 0', async () => {
      const req = { user: { id: 1 } } as AuthenticatedRequest;

      await controller.getNotifications(req, '20', '-10');

      expect(mockNotificationService.getAll).toHaveBeenCalledWith(1, 20, 0);
    });
  });

  describe('GET /notifications/unread/count', () => {
    it('should return count from notificationService', async () => {
      mockNotificationService.getUnreadCount.mockResolvedValueOnce(5);
      const req = { user: { id: 1 } } as AuthenticatedRequest;

      const result = await controller.getUnreadCount(req);

      expect(result).toEqual({ count: 5 });
    });
  });

  describe('POST /notifications/:id/read', () => {
    it('should mark notification as read and return success', async () => {
      const req = { user: { id: 1 } } as AuthenticatedRequest;

      const result = await controller.markRead(req, 'notif-abc');

      expect(mockNotificationService.markRead).toHaveBeenCalledWith(
        1,
        'notif-abc',
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('POST /notifications/read-all', () => {
    it('should mark all notifications as read and return success', async () => {
      const req = { user: { id: 1 } } as AuthenticatedRequest;

      const result = await controller.markAllRead(req);

      expect(mockNotificationService.markAllRead).toHaveBeenCalledWith(1);
      expect(result).toEqual({ success: true });
    });
  });
});
