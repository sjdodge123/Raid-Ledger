import { Test, TestingModule } from '@nestjs/testing';
import { MessageFlags } from 'discord.js';
import { RunningLateInteractionListener } from './running-late-interaction.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { RunningLateService } from '../../events/running-late.service';
import { EventsService } from '../../events/events.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { RUNNING_LATE_BUTTON_IDS } from '../discord-bot.constants';
import {
  _resetLateCooldowns,
  clearRunningLateOnVoiceJoin,
} from './running-late-interaction.handlers';

// findLinkedUser is the linked-account lookup; mock the module so we control it.
jest.mock('./signup-interaction.helpers', () => ({
  findLinkedUser: jest.fn(),
}));
import { findLinkedUser } from './signup-interaction.helpers';
const mockFindLinkedUser = findLinkedUser as jest.Mock;

/** Test-friendly view exposing the private members the specs drive. */
interface TestableRunningLateListener {
  onBotConnected: () => void;
  handleButtonInteraction: (interaction: unknown) => Promise<void>;
  handleLateClick: (interaction: unknown, eventId: number) => Promise<void>;
  handleHereClick: (interaction: unknown, eventId: number) => Promise<void>;
  handleDelayConfirm: (
    interaction: unknown,
    eventId: number,
    minutes: number,
  ) => Promise<void>;
}

const HOST_ID = 100;
const ATTENDEE_ID = 200;
const EVENT_ID = 42;

/** Minimal ButtonInteraction mock (mirrors roach-out-interaction.listener.spec). */
function makeButtonInteraction(customId: string, userId = 'discord-user-123') {
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
    reply: jest.fn().mockResolvedValue(undefined),
  };
  return interaction;
}

function futureEvent(overrides: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + 60_000);
  return {
    id: EVENT_ID,
    title: 'Mythic Raid',
    cancelledAt: null,
    duration: [start, new Date(start.getTime() + 7_200_000)],
    creatorId: HOST_ID,
    ...overrides,
  };
}

let testModule: TestingModule;
let listener: TestableRunningLateListener;
let mockClientService: {
  getClient: jest.Mock;
  getGuildId: jest.Mock;
  editEmbed: jest.Mock;
};
let mockRunningLateService: {
  setRunningLate: jest.Mock;
  clearRunningLate: jest.Mock;
  notifyRunningLate: jest.Mock;
};
let mockEventsService: {
  delayEvent: jest.Mock;
  buildEmbedEventData: jest.Mock;
};
let mockDb: {
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  limit: jest.Mock;
};

async function setup() {
  mockFindLinkedUser.mockReset();
  _resetLateCooldowns();
  mockClientService = {
    getClient: jest
      .fn()
      .mockReturnValue({ on: jest.fn(), removeListener: jest.fn() }),
    // null guildId → updateChannelEmbeds is a safe no-op in these unit tests
    getGuildId: jest.fn().mockReturnValue(null),
    editEmbed: jest.fn().mockResolvedValue(undefined),
  };
  mockRunningLateService = {
    setRunningLate: jest.fn().mockResolvedValue(true),
    clearRunningLate: jest.fn().mockResolvedValue(true),
    notifyRunningLate: jest.fn().mockResolvedValue(undefined),
  };
  mockEventsService = {
    delayEvent: jest.fn(),
    buildEmbedEventData: jest.fn().mockResolvedValue({ id: EVENT_ID }),
  };
  mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  };

  testModule = await Test.createTestingModule({
    providers: [
      RunningLateInteractionListener,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: DiscordBotClientService, useValue: mockClientService },
      { provide: RunningLateService, useValue: mockRunningLateService },
      { provide: EventsService, useValue: mockEventsService },
      { provide: DiscordEmbedFactory, useValue: {} },
      { provide: SettingsService, useValue: {} },
    ],
  }).compile();

  listener = testModule.get(RunningLateInteractionListener);
}

describe('RunningLateInteractionListener', () => {
  beforeEach(setup);
  afterEach(async () => {
    await testModule.close();
  });

  describe('onBotConnected', () => {
    it('registers an interactionCreate handler on connect', () => {
      const client = { on: jest.fn(), removeListener: jest.fn() };
      mockClientService.getClient.mockReturnValue(client);
      listener.onBotConnected();
      expect(client.on).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
    });

    it('removes the previous handler on reconnect', () => {
      const client = { on: jest.fn(), removeListener: jest.fn() };
      mockClientService.getClient.mockReturnValue(client);
      listener.onBotConnected();
      listener.onBotConnected();
      expect(client.removeListener).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
    });

    it('does nothing when getClient returns null', () => {
      mockClientService.getClient.mockReturnValue(null);
      expect(() => listener.onBotConnected()).not.toThrow();
    });
  });

  describe('attendee marks running late', () => {
    it('sets the late flag and confirms for a signed-up attendee', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: ATTENDEE_ID });
      mockDb.limit
        .mockResolvedValueOnce([futureEvent()]) // lookupEvent
        .mockResolvedValueOnce([{ id: 1 }]); // userHasSignup
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleLateClick(interaction, EVENT_ID);
      expect(mockRunningLateService.setRunningLate).toHaveBeenCalledWith(
        EVENT_ID,
        ATTENDEE_ID,
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('running late'),
      });
    });

    it('replies "not signed up" and does NOT set the flag without a signup', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: ATTENDEE_ID });
      mockDb.limit
        .mockResolvedValueOnce([futureEvent()]) // lookupEvent
        .mockResolvedValueOnce([]); // userHasSignup → none
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleLateClick(interaction, EVENT_ID);
      expect(mockRunningLateService.setRunningLate).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're not signed up for this event.",
      });
    });

    it('notifies attendees on the FIRST transition to late', async () => {
      mockFindLinkedUser.mockResolvedValue({
        id: ATTENDEE_ID,
        username: 'LateGuy',
        displayName: null,
      });
      mockDb.limit
        .mockResolvedValueOnce([futureEvent()]) // lookupEvent
        .mockResolvedValueOnce([{ id: 1 }]); // userHasSignup
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleLateClick(interaction, EVENT_ID);
      expect(mockRunningLateService.notifyRunningLate).toHaveBeenCalledWith(
        expect.objectContaining({ id: EVENT_ID, title: 'Mythic Raid' }),
        ATTENDEE_ID,
        'LateGuy',
      );
    });

    it('does NOT re-notify when the attendee was already marked late', async () => {
      mockRunningLateService.setRunningLate.mockResolvedValue(false);
      mockFindLinkedUser.mockResolvedValue({ id: ATTENDEE_ID });
      mockDb.limit
        .mockResolvedValueOnce([futureEvent()]) // lookupEvent
        .mockResolvedValueOnce([{ id: 1 }]); // userHasSignup
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleLateClick(interaction, EVENT_ID);
      expect(mockRunningLateService.notifyRunningLate).not.toHaveBeenCalled();
    });

    it('still confirms to the attendee when the notify fan-out fails', async () => {
      mockRunningLateService.notifyRunningLate.mockRejectedValue(
        new Error('notification service down'),
      );
      mockFindLinkedUser.mockResolvedValue({
        id: ATTENDEE_ID,
        username: 'LateGuy',
      });
      mockDb.limit
        .mockResolvedValueOnce([futureEvent()]) // lookupEvent
        .mockResolvedValueOnce([{ id: 1 }]); // userHasSignup
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleLateClick(interaction, EVENT_ID);
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('running late'),
      });
    });
  });

  describe('host marks running late → delay prompt', () => {
    it('shows the +15/+30/Cancel delay prompt to the host', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: HOST_ID });
      mockDb.limit.mockResolvedValueOnce([futureEvent()]); // lookupEvent
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleLateClick(interaction, EVENT_ID);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Delay the event'),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });
  });

  describe('host confirms a delay', () => {
    it('calls delayEvent with the chosen offset and confirms the new time', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: HOST_ID });
      mockDb.limit.mockResolvedValueOnce([futureEvent()]); // lookupEvent
      const newStart = new Date(Date.now() + 16 * 60_000);
      mockEventsService.delayEvent.mockResolvedValue({
        startTime: newStart.toISOString(),
      });
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.DELAY}:${EVENT_ID}:15`,
      );
      await listener.handleDelayConfirm(interaction, EVENT_ID, 15);
      expect(mockEventsService.delayEvent).toHaveBeenCalledWith(
        EVENT_ID,
        15,
        HOST_ID,
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('delayed to'),
          components: [],
        }),
      );
    });

    it('rejects a non-host pressing the delay button (delayEvent NOT called)', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: ATTENDEE_ID });
      mockDb.limit.mockResolvedValueOnce([futureEvent()]); // creatorId=HOST_ID
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.DELAY}:${EVENT_ID}:30`,
      );
      await listener.handleDelayConfirm(interaction, EVENT_ID, 30);
      expect(mockEventsService.delayEvent).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Only the host can delay this event.',
        components: [],
      });
    });
  });

  describe('"I\'m here now" clears the flag', () => {
    it('calls clearRunningLate and confirms', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: ATTENDEE_ID });
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.HERE}:${EVENT_ID}`,
      );
      await listener.handleHereClick(interaction, EVENT_ID);
      expect(mockRunningLateService.clearRunningLate).toHaveBeenCalledWith(
        EVENT_ID,
        ATTENDEE_ID,
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('no longer marked'),
      });
    });
  });

  describe('graceful fallbacks', () => {
    it('prompts to link account when the presser is unlinked', async () => {
      mockFindLinkedUser.mockResolvedValue(null);
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleLateClick(interaction, EVENT_ID);
      expect(mockRunningLateService.setRunningLate).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Link your Raid Ledger account'),
      });
    });

    it('replies "event not found" when the event is missing', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: ATTENDEE_ID });
      mockDb.limit.mockResolvedValueOnce([]); // lookupEvent → none
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleLateClick(interaction, EVENT_ID);
      expect(mockRunningLateService.setRunningLate).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Event not found.',
      });
    });
  });

  describe('handleButtonInteraction — routing', () => {
    it('early-returns on an unknown custom-id (no defer, no service calls)', async () => {
      const interaction = makeButtonInteraction('unknown_action:42');
      await listener.handleButtonInteraction(interaction);
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(mockFindLinkedUser).not.toHaveBeenCalled();
    });

    it('defers ephemerally for the LATE marker action', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: ATTENDEE_ID });
      mockDb.limit
        .mockResolvedValueOnce([futureEvent()])
        .mockResolvedValueOnce([{ id: 1 }]);
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleButtonInteraction(interaction);
      expect(interaction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
    });

    it('uses deferUpdate (not deferReply) for the DELAY action', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: HOST_ID });
      mockDb.limit.mockResolvedValueOnce([futureEvent()]);
      mockEventsService.delayEvent.mockResolvedValue({
        startTime: new Date(Date.now() + 16 * 60_000).toISOString(),
      });
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.DELAY}:${EVENT_ID}:15`,
      );
      await listener.handleButtonInteraction(interaction);
      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('surfaces a generic error message when an action throws', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: ATTENDEE_ID });
      mockDb.limit.mockRejectedValueOnce(new Error('DB Error'));
      const interaction = makeButtonInteraction(
        `${RUNNING_LATE_BUTTON_IDS.LATE}:${EVENT_ID}`,
      );
      await listener.handleButtonInteraction(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Something went wrong. Please try again.',
      });
    });
  });

  describe('voice-join auto-clear (AC3)', () => {
    function voiceDeps() {
      return {
        db: mockDb,
        clientService: mockClientService,
        runningLateService: mockRunningLateService,
        eventsService: mockEventsService,
        embedFactory: {},
        settingsService: {},
        logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
      } as unknown as Parameters<typeof clearRunningLateOnVoiceJoin>[0];
    }

    it('clears the flag for an event whose ephemeral voice channel was joined', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: ATTENDEE_ID });
      mockDb.where.mockResolvedValueOnce([{ id: EVENT_ID }]);
      await clearRunningLateOnVoiceJoin(
        voiceDeps(),
        'discord-user-123',
        'vc-1',
      );
      expect(mockRunningLateService.clearRunningLate).toHaveBeenCalledWith(
        EVENT_ID,
        ATTENDEE_ID,
      );
    });

    it('no-ops for an unlinked user', async () => {
      mockFindLinkedUser.mockResolvedValue(null);
      await clearRunningLateOnVoiceJoin(voiceDeps(), 'discord-user-x', 'vc-1');
      expect(mockRunningLateService.clearRunningLate).not.toHaveBeenCalled();
    });
  });
});
