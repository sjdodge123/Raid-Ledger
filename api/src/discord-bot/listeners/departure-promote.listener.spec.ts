import { DeparturePromoteListener } from './departure-promote.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { NotificationService } from '../../notifications/notification.service';
import { SignupsService } from '../../events/signups.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SIGNUP_EVENTS,
  DEPARTURE_PROMOTE_BUTTON_IDS,
} from '../discord-bot.constants';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import type { ButtonInteraction, Message } from 'discord.js';

/** Test-friendly interface exposing private members needed by specs */
interface TestableDeparturePromoteListener {
  handlePromote: (
    interaction: ButtonInteraction,
    eventId: number,
  ) => Promise<void>;
  handleDismiss: (
    interaction: ButtonInteraction,
    role: string,
    signupId: number,
  ) => Promise<void>;
  handleButtonInteraction: (interaction: ButtonInteraction) => Promise<void>;
}

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
  let listener: TestableDeparturePromoteListener;
  let mockDb: MockDb;
  let mockClientService: { getClient: jest.Mock; isConnected: jest.Mock };
  let mockNotificationService: {
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
    create: jest.Mock;
  };
  let mockSignupsService: { promoteFromBench: jest.Mock };
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
    mockSignupsService = {
      promoteFromBench: jest.fn(),
    };
    mockEventEmitter = { emit: jest.fn() };

    listener = new DeparturePromoteListener(
      mockDb as never,
      mockClientService as unknown as DiscordBotClientService,
      mockNotificationService as unknown as NotificationService,
      mockSignupsService as unknown as SignupsService,
      mockEventEmitter as unknown as EventEmitter2,
    ) as unknown as TestableDeparturePromoteListener;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('promote', () => {
    it('promotes bench player via role calculation engine', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:1:tank:1`,
      );

      // Bench player query
      mockDb.limit.mockResolvedValueOnce([{ signupId: 20, userId: 5 }]);

      // promoteFromBench returns successful placement
      mockSignupsService.promoteFromBench.mockResolvedValueOnce({
        role: 'tank',
        position: 1,
        username: 'BenchPlayer',
      });

      // Event title for notification
      mockDb.limit.mockResolvedValueOnce([{ title: 'Test Raid' }]);

      await listener.handlePromote(interaction, 1);

      // Should call role calculation engine
      expect(mockSignupsService.promoteFromBench).toHaveBeenCalledWith(1, 20);

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

    it('shows warning when role calc places player in non-preferred role', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:1:healer:1`,
      );

      // Bench player query
      mockDb.limit.mockResolvedValueOnce([{ signupId: 20, userId: 5 }]);

      // promoteFromBench returns placement with warning
      mockSignupsService.promoteFromBench.mockResolvedValueOnce({
        role: 'healer',
        position: 1,
        username: 'DPSOnly',
        warning:
          'DPSOnly was placed in **healer** which is not in their preferred roles (dps).',
      });

      // Event title for notification
      mockDb.limit.mockResolvedValueOnce([{ title: 'Test Raid' }]);

      await listener.handlePromote(interaction, 1);

      expect(mockSignupsService.promoteFromBench).toHaveBeenCalledWith(1, 20);
      expect(interaction.message.edit).toHaveBeenCalled();
    });

    it('returns message when role calc cannot place player', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:1:tank:1`,
      );

      // Bench player query
      mockDb.limit.mockResolvedValueOnce([{ signupId: 20, userId: 5 }]);

      // promoteFromBench returns bench (no suitable slot)
      mockSignupsService.promoteFromBench.mockResolvedValueOnce({
        role: 'bench',
        position: 1,
        username: 'BenchPlayer',
        warning:
          'Could not find a suitable roster slot for BenchPlayer based on their preferred roles.',
      });

      await listener.handlePromote(interaction, 1);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      expect(interaction.message.edit).toHaveBeenCalled();
    });

    it('returns "no bench players" when bench is empty', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:1:tank:1`,
      );

      // No bench players
      mockDb.limit.mockResolvedValueOnce([]);

      await listener.handlePromote(interaction, 1);

      expect(mockSignupsService.promoteFromBench).not.toHaveBeenCalled();
      expect(interaction.message.edit).toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('edits DM to show "slot left empty" and disables buttons', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.DISMISS}:1:healer:2`,
      );

      await listener.handleDismiss(interaction, 'healer', 2);

      expect(interaction.message.edit).toHaveBeenCalled();
    });
  });

  describe('button routing', () => {
    it('ignores interactions with wrong prefix', async () => {
      const interaction = makeMockInteraction('signup:42');

      await listener.handleButtonInteraction(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it('ignores interactions with wrong part count', async () => {
      const interaction = makeMockInteraction(
        `${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:1`,
      );

      await listener.handleButtonInteraction(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });
});
