import { Test, TestingModule } from '@nestjs/testing';
import { RoachOutInteractionListener } from './roach-out-interaction.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ROACH_OUT_BUTTON_IDS } from '../discord-bot.constants';

/** Test-friendly interface exposing private members needed by specs */
interface TestableRoachOutInteractionListener {
  onBotConnected: () => void;
  handleButtonInteraction: (interaction: unknown) => Promise<void>;
  handleRoachOutClick: (interaction: unknown, eventId: number) => Promise<void>;
  handleConfirm: (interaction: unknown, eventId: number) => Promise<void>;
  handleCancel: (interaction: unknown) => Promise<void>;
  safeEditReply: (interaction: unknown, payload: unknown) => Promise<void>;
  editReminderEmbed: (
    interaction: unknown,
    eventTitle: string,
  ) => Promise<void>;
  updateChannelEmbeds: (eventId: number) => Promise<void>;
  isDiscordInteractionError: (error: unknown) => boolean;
}

/** Create a minimal ButtonInteraction mock */
function makeButtonInteraction(
  customId: string,
  userId: string = 'discord-user-123',
) {
  const interaction = {
    isButton: () => true,
    customId,
    id: 'interaction-id-1',
    user: { id: userId, username: 'TestUser', avatar: null },
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    }),
    deferUpdate: jest.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    }),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(() => {
      interaction.replied = true;
      return Promise.resolve(undefined);
    }),
    message: {
      embeds: [
        {
          description: 'Mythic Raid starts in 15 minutes!',
          title: 'Event Reminder',
          color: 0xf59e0b,
        },
      ],
      components: [],
      edit: jest.fn().mockResolvedValue(undefined),
    },
  };
  return interaction;
}

let testModule: TestingModule;
let listener: TestableRoachOutInteractionListener;
let mockClientService: {
  getClient: jest.Mock;
  getGuildId: jest.Mock;
  editEmbed: jest.Mock;
};
let mockSignupsService: {
  findByDiscordUser: jest.Mock;
  cancelByDiscordUser: jest.Mock;
};
let mockEventsService: { buildEmbedEventData: jest.Mock };
let mockDb: {
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  limit: jest.Mock;
};

async function setupRoachOutModule() {
  mockClientService = {
    getClient: jest.fn().mockReturnValue({
      on: jest.fn(),
      removeListener: jest.fn(),
    }),
    getGuildId: jest.fn().mockReturnValue(null),
    editEmbed: jest.fn().mockResolvedValue(undefined),
  };
  mockSignupsService = {
    findByDiscordUser: jest.fn(),
    cancelByDiscordUser: jest.fn().mockResolvedValue(undefined),
  };
  mockEventsService = { buildEmbedEventData: jest.fn() };

  const mockChain = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  };
  mockDb = mockChain as typeof mockDb;

  testModule = await Test.createTestingModule({
    providers: [
      RoachOutInteractionListener,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: DiscordBotClientService, useValue: mockClientService },
      { provide: SignupsService, useValue: mockSignupsService },
      { provide: EventsService, useValue: mockEventsService },
      { provide: DiscordEmbedFactory, useValue: {} },
      { provide: SettingsService, useValue: {} },
    ],
  }).compile();

  const instance: unknown = testModule.get(RoachOutInteractionListener);
  listener = instance as TestableRoachOutInteractionListener;
}

describe('RoachOutInteractionListener', () => {
  beforeEach(async () => {
    await setupRoachOutModule();
  });

  afterEach(async () => {
    await testModule.close();
  });

  describe('onBotConnected', () => {
    botConnectedTests();
  });

  describe('handleRoachOutClick', () => {
    roachOutClickTests();
  });

  describe('handleConfirm', () => {
    confirmTests();
  });

  describe('handleCancel', () => {
    cancelTests();
  });

  describe('onBotConnected — edge cases', () => {
    botConnectedEdgeCaseTests();
  });

  describe('handleButtonInteraction — routing', () => {
    buttonRoutingIgnoreTests();
    buttonRoutingDeferTests();
  });

  describe('handleRoachOutClick — event not found', () => {
    roachOutNotFoundTests();
  });

  describe('handleConfirm — event not found', () => {
    confirmNotFoundTests();
  });

  describe('isDiscordInteractionError', () => {
    discordInteractionErrorTests();
  });

  describe('safeEditReply', () => {
    safeEditReplyTests();
  });

  describe('updateChannelEmbeds', () => {
    updateChannelEmbedsTests();
  });

  describe('editReminderEmbed', () => {
    editReminderEmbedTests();
  });
});

function botConnectedTests() {
  it('should register interaction handler on bot connect', () => {
    const mockClient = { on: jest.fn(), removeListener: jest.fn() };
    mockClientService.getClient.mockReturnValue(mockClient);
    listener.onBotConnected();
    expect(mockClient.on).toHaveBeenCalledWith(
      'interactionCreate',
      expect.any(Function),
    );
  });

  it('should remove previous handler on reconnect', () => {
    const mockClient = { on: jest.fn(), removeListener: jest.fn() };
    mockClientService.getClient.mockReturnValue(mockClient);
    listener.onBotConnected();
    listener.onBotConnected();
    expect(mockClient.removeListener).toHaveBeenCalledWith(
      'interactionCreate',
      expect.any(Function),
    );
  });
}

function makeFutureEvent() {
  const futureDate = new Date(Date.now() + 60000);
  return {
    id: 42,
    title: 'Mythic Raid',
    cancelledAt: null,
    duration: [futureDate, new Date(futureDate.getTime() + 7200000)],
  };
}

function roachOutClickTests() {
  it('should show confirmation prompt when user is signed up', async () => {
    mockDb.limit.mockResolvedValueOnce([makeFutureEvent()]);
    mockSignupsService.findByDiscordUser.mockResolvedValue({
      id: 1,
      status: 'signed_up',
    });
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
    );
    await listener['handleRoachOutClick'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'Are you sure you want to roach out of **Mythic Raid**?',
        ),
        components: expect.any(Array),
      }),
    );
  });

  it('should reply "not signed up" when user has no signup', async () => {
    mockDb.limit.mockResolvedValueOnce([makeFutureEvent()]);
    mockSignupsService.findByDiscordUser.mockResolvedValue(null);
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
    );
    await listener['handleRoachOutClick'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "You're not signed up for this event.",
    });
  });

  it('should reply "cancelled" when event is cancelled', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 42,
        title: 'Mythic Raid',
        cancelledAt: new Date(),
        duration: [new Date(), new Date()],
      },
    ]);
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
    );
    await listener['handleRoachOutClick'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'This event has been cancelled.',
    });
  });

  it('should show warning when event has already started', async () => {
    const pastDate = new Date(Date.now() - 60000);
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 42,
        title: 'Mythic Raid',
        cancelledAt: null,
        duration: [pastDate, new Date(pastDate.getTime() + 7200000)],
      },
    ]);
    mockSignupsService.findByDiscordUser.mockResolvedValue({
      id: 1,
      status: 'signed_up',
    });
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
    );
    await listener['handleRoachOutClick'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('This event has already started.'),
      }),
    );
  });
}

function confirmTests() {
  it('should remove signup and confirm on successful roach out', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { id: 42, title: 'Mythic Raid', cancelledAt: null },
    ]);
    mockSignupsService.findByDiscordUser.mockResolvedValue({
      id: 1,
      status: 'signed_up',
    });
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
    );
    await listener['handleConfirm'](interaction, 42);
    expect(mockSignupsService.cancelByDiscordUser).toHaveBeenCalledWith(
      42,
      'discord-user-123',
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "You've roached out of **Mythic Raid**.",
        ),
        components: [],
      }),
    );
  });

  it('should handle user not signed up on confirm', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { id: 42, title: 'Mythic Raid', cancelledAt: null },
    ]);
    mockSignupsService.findByDiscordUser.mockResolvedValue(null);
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
    );
    await listener['handleConfirm'](interaction, 42);
    expect(mockSignupsService.cancelByDiscordUser).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "You're not signed up for this event.",
      components: [],
    });
  });

  it('should handle cancelled event on confirm', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { id: 42, title: 'Mythic Raid', cancelledAt: new Date() },
    ]);
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
    );
    await listener['handleConfirm'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'This event has been cancelled.',
      components: [],
    });
  });
}

function cancelTests() {
  it('should dismiss the confirmation without changes', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
    );
    await listener['handleCancel'](interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Cancelled. Your signup is unchanged.',
      components: [],
    });
  });
}

function botConnectedEdgeCaseTests() {
  it('should do nothing when getClient returns null', () => {
    mockClientService.getClient.mockReturnValue(null);
    expect(() => listener.onBotConnected()).not.toThrow();
  });
}

function buttonRoutingIgnoreTests() {
  it('should ignore non-button interactions', async () => {
    const mockClient = { on: jest.fn(), removeListener: jest.fn() };
    mockClientService.getClient.mockReturnValue(mockClient);
    listener.onBotConnected();
    const [, boundHandler] = mockClient.on.mock.calls[0] as [
      string,
      (interaction: unknown) => Promise<void>,
    ];
    await boundHandler({ isButton: () => false });
    expect(mockSignupsService.findByDiscordUser).not.toHaveBeenCalled();
  });

  it('should ignore interactions with too many parts', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42:extra`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('should ignore interactions with NaN eventId', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:notanumber`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('should ignore unknown action prefix', async () => {
    const interaction = makeButtonInteraction('unknown_action:42');
    await listener['handleButtonInteraction'](interaction);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });
}

function buttonRoutingDeferTests() {
  it('should use deferUpdate for cancel actions', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('should use deferReply for roach_out action', async () => {
    mockDb.limit.mockResolvedValueOnce([makeFutureEvent()]);
    mockSignupsService.findByDiscordUser.mockResolvedValue({
      id: 1,
      status: 'signed_up',
    });
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });

  it('should return early when deferReply throws', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
    );
    interaction.deferReply.mockRejectedValueOnce(
      new Error('Unknown Interaction'),
    );
    await listener['handleButtonInteraction'](interaction);
    expect(mockSignupsService.findByDiscordUser).not.toHaveBeenCalled();
  });

  it('should return early when deferUpdate throws for cancel', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
    );
    interaction.deferUpdate.mockRejectedValueOnce(
      new Error('Unknown Interaction'),
    );
    await expect(
      listener['handleButtonInteraction'](interaction),
    ).resolves.not.toThrow();
  });

  it('should call safeEditReply with error when action throws', async () => {
    mockDb.limit.mockRejectedValueOnce(new Error('DB Error'));
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Something went wrong. Please try again.',
    });
  });
}

function roachOutNotFoundTests() {
  it('should reply "event not found" when db returns no event', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:999`,
    );
    await listener['handleRoachOutClick'](interaction, 999);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Event not found.',
    });
  });
}

function confirmNotFoundTests() {
  it('should reply "event not found" on confirm', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CONFIRM}:999`,
    );
    await listener['handleConfirm'](interaction, 999);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Event not found.',
      components: [],
    });
  });

  it('should reply gracefully when cancelByDiscordUser throws', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { id: 42, title: 'Mythic Raid', cancelledAt: null },
    ]);
    mockSignupsService.findByDiscordUser.mockResolvedValue({
      id: 1,
      status: 'signed_up',
    });
    mockSignupsService.cancelByDiscordUser.mockRejectedValueOnce(
      new Error('Constraint violation'),
    );
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
    );
    await listener['handleConfirm'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "You're not signed up for this event.",
      components: [],
    });
  });
}

function discordInteractionErrorTests() {
  it('should return true for error code 40060', () => {
    expect(
      listener['isDiscordInteractionError']({ code: 40060, message: '' }),
    ).toBe(true);
  });

  it('should return true for error code 10062', () => {
    expect(
      listener['isDiscordInteractionError']({ code: 10062, message: '' }),
    ).toBe(true);
  });

  it('should return false for other error codes', () => {
    expect(
      listener['isDiscordInteractionError']({ code: 50013, message: '' }),
    ).toBe(false);
  });

  it('should return false for null', () => {
    expect(listener['isDiscordInteractionError'](null)).toBe(false);
  });

  it('should return false for non-object values', () => {
    expect(listener['isDiscordInteractionError']('string error')).toBe(false);
    expect(listener['isDiscordInteractionError'](42)).toBe(false);
  });

  it('should return false for object without code', () => {
    expect(listener['isDiscordInteractionError']({ message: 'no code' })).toBe(
      false,
    );
  });
}

function safeEditReplyTests() {
  it('should swallow Discord interaction error codes', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
    );
    interaction.editReply.mockRejectedValueOnce({
      code: 40060,
      message: 'Interaction already acknowledged',
    });
    await expect(
      listener['safeEditReply'](interaction, { content: 'test' }),
    ).resolves.not.toThrow();
  });

  it('should re-throw non-Discord errors', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
    );
    interaction.editReply.mockRejectedValueOnce(new Error('Network error'));
    await expect(
      listener['safeEditReply'](interaction, { content: 'test' }),
    ).rejects.toThrow('Network error');
  });
}

function updateChannelEmbedsTests() {
  it('should return early when guildId is null', async () => {
    mockClientService.getGuildId.mockReturnValue(null);
    mockEventsService.buildEmbedEventData.mockResolvedValue({});
    await expect(listener['updateChannelEmbeds'](42)).resolves.not.toThrow();
  });

  it('should not call editEmbed when no channel records', async () => {
    mockClientService.getGuildId.mockReturnValue('guild-123');
    mockEventsService.buildEmbedEventData.mockResolvedValue({ id: 42 });
    mockDb.limit.mockResolvedValueOnce([]);
    const mockChainNoLimit = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    };
    (listener as unknown as { db: unknown }).db = mockChainNoLimit;
    await expect(listener['updateChannelEmbeds'](42)).resolves.not.toThrow();
    expect(mockClientService.editEmbed).not.toHaveBeenCalled();
  });

  it('should handle buildEmbedEventData throwing', async () => {
    mockEventsService.buildEmbedEventData.mockRejectedValueOnce(
      new Error('Event not found'),
    );
    await expect(listener['updateChannelEmbeds'](999)).resolves.not.toThrow();
  });
}

function editReminderEmbedTests() {
  it('should return early when no embed', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
    );
    interaction.message.embeds = [];
    await expect(
      listener['editReminderEmbed'](interaction, 'Mythic Raid'),
    ).resolves.not.toThrow();
    expect(interaction.message.edit).not.toHaveBeenCalled();
  });

  it('should edit original message when embed exists', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
    );
    await listener['editReminderEmbed'](interaction, 'Mythic Raid');
    expect(interaction.message.edit).toHaveBeenCalled();
  });

  it('should handle message.edit failing', async () => {
    const interaction = makeButtonInteraction(
      `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
    );
    interaction.message.edit.mockRejectedValueOnce(
      new Error('Unknown Message'),
    );
    await expect(
      listener['editReminderEmbed'](interaction, 'Mythic Raid'),
    ).resolves.not.toThrow();
  });
}
