import { DeparturePromoteListener } from './departure-promote.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { NotificationService } from '../../notifications/notification.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SIGNUP_EVENTS, DEPARTURE_PROMOTE_BUTTON_IDS } from '../discord-bot.constants';
import { createDrizzleMock, type MockDb } from '../../common/testing/drizzle-mock';
import type { ButtonInteraction, Message } from 'discord.js';

function makeMockInteraction(
  customId: string,
  overrides: Partial<{
    embeds: Array<{ description: string }>;
    components: unknown[];
  }> = {},
): ButtonInteraction {
  const mockMessage = {
    embeds: overrides.embeds ?? [{ description: 'Original embed text' }],
    components: overrides.components ?? [],
    edit: jest.fn().mockResolvedValue(undefined),
  };

  return {
    customId,
    isButton: () => true,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    message: mockMessage as unknown as Message,
  } as unknown as ButtonInteraction;
}

describe('DeparturePromoteListener', () => {
  let listener: DeparturePromoteListener;
  let mockDb: MockDb;
  let mockClientService: { getClient: jest.Mock; isConnected: jest.Mock };
  let mockNotificationService: {
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
    create: jest.Mock;
  };
  let mockEventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockClientService = {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(true),
    };
    mockNotificationService = {
      getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
    };
    mockEventEmitter = { emit: jest.fn() };

    listener = new DeparturePromoteListener(
      mockDb as never,
      mockClientService as unknown as DiscordBotClientService,
      mockNotificationService as unknown as NotificationService,
      mockEventEmitter as unknown as EventEmitter2,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('promote', () => {
    it('promotes FIFO bench player to vacated slot', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:1:tank:1`,
      );

      // Slot empty check
      mockDb.limit.mockResolvedValueOnce([]);
      // Bench player query
      mockDb.limit.mockResolvedValueOnce([
        { assignmentId: 88, signupId: 20, userId: 5 },
      ]);
      // Event title for notification
      mockDb.limit.mockResolvedValueOnce([{ title: 'Test Raid' }]);
      // Promoted player name
      mockDb.limit.mockResolvedValueOnce([{ username: 'BenchPlayer' }]);

      // Access private method via prototype
      await (listener as any).handlePromote(interaction, 1, 'tank', 1);

      // Should update roster assignment
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({ role: 'tank', position: 1 });

      // Should notify the promoted player
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 5,
          type: 'bench_promoted',
          title: 'Promoted from Bench!',
        }),
      );

      // Should emit signup event
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SIGNUP_EVENTS.UPDATED,
        expect.objectContaining({
          eventId: 1,
          action: 'bench_promoted',
        }),
      );

      // Should edit the DM
      expect(interaction.message.edit).toHaveBeenCalled();
    });

    it('returns "slot already filled" when slot is occupied', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:1:tank:1`,
      );

      // Slot occupied
      mockDb.limit.mockResolvedValueOnce([{ id: 99, role: 'tank', position: 1 }]);

      await (listener as any).handlePromote(interaction, 1, 'tank', 1);

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(interaction.message.edit).toHaveBeenCalled();
    });

    it('returns "no bench players" when bench is empty', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:1:tank:1`,
      );

      // Slot empty
      mockDb.limit.mockResolvedValueOnce([]);
      // No bench players
      mockDb.limit.mockResolvedValueOnce([]);

      await (listener as any).handlePromote(interaction, 1, 'tank', 1);

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(interaction.message.edit).toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('edits DM to show "slot left empty" and disables buttons', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.DISMISS}:1:healer:2`,
      );

      await (listener as any).handleDismiss(interaction, 1, 'healer', 2);

      expect(interaction.message.edit).toHaveBeenCalled();
    });
  });

  describe('button routing', () => {
    it('ignores interactions with wrong prefix', async () => {
      const interaction = makeMockInteraction('signup:42');

      await (listener as any).handleButtonInteraction(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it('ignores interactions with wrong part count', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:1`,
      );

      await (listener as any).handleButtonInteraction(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });
});
