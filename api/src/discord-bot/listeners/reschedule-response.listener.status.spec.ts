import { Test, TestingModule } from '@nestjs/testing';
import { RescheduleResponseListener } from './reschedule-response.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SignupsService } from '../../events/signups.service';
import { CharactersService } from '../../characters/characters.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { RESCHEDULE_BUTTON_IDS } from '../discord-bot.constants';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

/** Test-friendly interface exposing private members needed by specs */
interface TestableRescheduleResponseListener {
  onBotConnected: () => void;
  handleButtonInteraction: (interaction: unknown) => Promise<void>;
  handleConfirm: (interaction: unknown, eventId: number) => Promise<void>;
  handleTentative: (interaction: unknown, eventId: number) => Promise<void>;
  handleDecline: (interaction: unknown, eventId: number) => Promise<void>;
  handleSelectMenuInteraction: (interaction: unknown) => Promise<void>;
  handleCharacterSelect: (
    interaction: unknown,
    eventId: number,
  ) => Promise<void>;
  handleRoleSelect: (
    interaction: unknown,
    eventId: number,
    characterId?: string,
  ) => Promise<void>;
}

/** Create a minimal ButtonInteraction mock */
function makeButtonInteraction(
  customId: string,
  userId: string = 'discord-user-123',
  messageOverrides: {
    embeds?: Array<{ description: string; title?: string }>;
    components?: unknown[];
  } = {},
) {
  const message = {
    embeds: messageOverrides.embeds ?? [
      { description: 'Your event has been rescheduled.', title: 'Rescheduled' },
    ],
    components: messageOverrides.components ?? [],
    edit: jest.fn().mockResolvedValue(undefined),
  };

  const interaction = {
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId,
    id: 'btn-interaction-1',
    user: { id: userId, username: 'TestUser', avatar: null },
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    }),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(() => {
      interaction.replied = true;
      return Promise.resolve(undefined);
    }),
    message,
  };
  return interaction;
}

describe('RescheduleResponseListener — status', () => {
  let module: TestingModule;

  let listener: TestableRescheduleResponseListener;
  let mockDb: MockDb;
  let mockClientService: { getClient: jest.Mock };
  let mockSignupsService: {
    findByDiscordUser: jest.Mock;
    confirmSignup: jest.Mock;
    updateStatus: jest.Mock;
  };
  let mockCharactersService: {
    findAllForUser: jest.Mock;
    findOne: jest.Mock;
  };
  let mockEmbedSyncQueue: { enqueue: jest.Mock };
  let mockEmojiService: {
    getClassEmojiComponent: jest.Mock;
    getRoleEmojiComponent: jest.Mock;
  };

  const mockEvent = {
    id: 42,
    title: 'Mythic Raid Night',
    cancelledAt: null,
    gameId: null,
    slotConfig: null,
  };

  const mockCancelledEvent = {
    id: 42,
    title: 'Mythic Raid Night',
    cancelledAt: new Date('2026-01-01'),
    gameId: null,
    slotConfig: null,
  };

  const mockSignup = {
    id: 101,
    eventId: 42,
    status: 'signed_up',
    discordUserId: 'discord-user-1',
    user: { id: 41 },
  };

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    mockClientService = {
      getClient: jest.fn().mockReturnValue(null),
    };

    mockSignupsService = {
      findByDiscordUser: jest.fn().mockResolvedValue(null),
      confirmSignup: jest.fn().mockResolvedValue({ id: 101 }),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

    mockCharactersService = {
      findAllForUser: jest
        .fn()
        .mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Arthas' }),
    };

    mockEmbedSyncQueue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    mockEmojiService = {
      getClassEmojiComponent: jest.fn().mockReturnValue(undefined),
      getRoleEmojiComponent: jest.fn().mockReturnValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        RescheduleResponseListener,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: SignupsService, useValue: mockSignupsService },
        { provide: CharactersService, useValue: mockCharactersService },
        { provide: EmbedSyncQueueService, useValue: mockEmbedSyncQueue },
        { provide: DiscordEmojiService, useValue: mockEmojiService },
      ],
    }).compile();

    const instance: unknown = module.get(RescheduleResponseListener);
    listener = instance as TestableRescheduleResponseListener;
  });

  afterEach(async () => {
    await module.close();
    jest.clearAllMocks();
  });

  // ─── Bot connection ─────────────────────────────────────────────────

  describe('handleTentative', () => {
    it('sets signup status to tentative via DB update for unlinked user', async () => {
      // Event lookup
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      // Linked user lookup — unlinked
      mockDb.limit.mockResolvedValueOnce([]);
      // reconfirmSignup: find signup by discordUserId
      mockDb.limit.mockResolvedValueOnce([mockSignup]);
      // ensureRosterAssignment — no existing (slotConfig null → early return)
      mockDb.limit.mockResolvedValueOnce([]);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'tentative', roachedOutAt: null }),
      );
    });

    it('replies with tentative confirmation message', async () => {
      // Event lookup
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      // Linked user lookup — unlinked
      mockDb.limit.mockResolvedValueOnce([]);
      // reconfirmSignup: find signup by discordUserId
      mockDb.limit.mockResolvedValueOnce([mockSignup]);
      // ensureRosterAssignment — no existing (slotConfig null → early return)
      mockDb.limit.mockResolvedValueOnce([]);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('tentative'),
        }),
      );
    });

    it('enqueues embed sync after marking tentative', async () => {
      // Event lookup
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      // Linked user lookup — unlinked
      mockDb.limit.mockResolvedValueOnce([]);
      // reconfirmSignup: find signup by discordUserId
      mockDb.limit.mockResolvedValueOnce([mockSignup]);
      // ensureRosterAssignment — no existing (slotConfig null → early return)
      mockDb.limit.mockResolvedValueOnce([]);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(mockEmbedSyncQueue.enqueue).toHaveBeenCalledWith(
        42,
        'reschedule-tentative',
      );
    });

    it('replies "Event not found." when event does not exist', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
      );
      await listener['handleTentative'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Event not found.',
      });
    });

    it('replies "This event has been cancelled." for cancelled events', async () => {
      mockDb.limit.mockResolvedValueOnce([mockCancelledEvent]);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
      );
      await listener['handleTentative'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'This event has been cancelled.',
      });
    });

    it('replies "You\'re not signed up" when user has no signup', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(null);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
      );
      await listener['handleTentative'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're not signed up for this event.",
      });
    });
  });

  // ─── Decline flow ─────────────────────────────────────────────────────

  describe('handleDecline', () => {
    it('sets signup status to declined and deletes roster assignment', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      // update sets status to declined
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'declined' }),
      );

      // delete roster assignment
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('replies with "No worries!" message after successful decline', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('No worries!'),
        }),
      );
    });

    it('enqueues embed sync after decline', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(mockEmbedSyncQueue.enqueue).toHaveBeenCalledWith(
        42,
        'reschedule-decline',
      );
    });

    it('replies "Event not found." when event does not exist', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // no event
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleDecline'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Event not found.',
      });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('replies "This event has been cancelled." for cancelled events', async () => {
      mockDb.limit.mockResolvedValueOnce([mockCancelledEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleDecline'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'This event has been cancelled.',
      });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('replies "You\'re not signed up" when user has no signup', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(null);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleDecline'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're not signed up for this event.",
      });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('clears roachedOutAt when declining', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleDecline'](interaction, 42);

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ roachedOutAt: null }),
      );
    });
  });

  // ─── Select menu routing ─────────────────────────────────────────────
});
