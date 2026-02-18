/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { InteractionListener } from './interaction.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EventCreateCommand } from '../commands/event-create.command';
import { EventsListCommand } from '../commands/events-list.command';
import { RosterViewCommand } from '../commands/roster-view.command';
import { Events } from 'discord.js';

describe('InteractionListener', () => {
  let module: TestingModule;
  let listener: InteractionListener;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let eventCreateCommand: jest.Mocked<EventCreateCommand>;
  let eventsListCommand: jest.Mocked<EventsListCommand>;
  let rosterViewCommand: jest.Mocked<RosterViewCommand>;
  let mockClient: {
    on: jest.Mock;
  };

  beforeEach(async () => {
    mockClient = {
      on: jest.fn(),
    };

    eventCreateCommand = {
      commandName: 'event',
      handleInteraction: jest.fn().mockResolvedValue(undefined),
      handleAutocomplete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EventCreateCommand>;

    eventsListCommand = {
      commandName: 'events',
      handleInteraction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EventsListCommand>;

    rosterViewCommand = {
      commandName: 'roster',
      handleInteraction: jest.fn().mockResolvedValue(undefined),
      handleAutocomplete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RosterViewCommand>;

    const module_: TestingModule = await Test.createTestingModule({
      providers: [
        InteractionListener,
        {
          provide: DiscordBotClientService,
          useValue: {
            getClient: jest.fn().mockReturnValue(mockClient),
          },
        },
        {
          provide: EventCreateCommand,
          useValue: eventCreateCommand,
        },
        {
          provide: EventsListCommand,
          useValue: eventsListCommand,
        },
        {
          provide: RosterViewCommand,
          useValue: rosterViewCommand,
        },
      ],
    }).compile();

    module = module_;
    listener = module.get(InteractionListener);
    clientService = module.get(DiscordBotClientService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
  });

  describe('attachListener', () => {
    it('should attach an interaction listener to the Discord client', () => {
      listener.attachListener();

      expect(clientService.getClient).toHaveBeenCalled();
      expect(mockClient.on).toHaveBeenCalledWith(
        Events.InteractionCreate,
        expect.any(Function),
      );
    });

    it('should not attach a listener if client is null', () => {
      clientService.getClient.mockReturnValue(null);

      listener.attachListener();

      expect(mockClient.on).not.toHaveBeenCalled();
    });

    it('should not attach a second listener if already attached', () => {
      listener.attachListener();
      listener.attachListener();

      // on() should only be called once
      expect(mockClient.on).toHaveBeenCalledTimes(1);
    });

    it('should allow re-attaching after detachListener is called', () => {
      listener.attachListener();
      listener.detachListener();
      listener.attachListener();

      expect(mockClient.on).toHaveBeenCalledTimes(2);
    });
  });

  describe('detachListener', () => {
    it('should reset listener state on disconnect', () => {
      listener.attachListener();
      listener.detachListener();

      // After detach, should be able to re-attach
      listener.attachListener();
      expect(mockClient.on).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleInteraction (via attached listener)', () => {
    let interactionHandler: (interaction: unknown) => void;

    beforeEach(() => {
      listener.attachListener();

      // Capture the handler registered with client.on
      const callArgs = mockClient.on.mock.calls[0] as [
        string,
        (interaction: unknown) => void,
      ];
      interactionHandler = callArgs[1];
    });

    it('should route ChatInputCommandInteraction to correct handler', async () => {
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        isAutocomplete: jest.fn().mockReturnValue(false),
        commandName: 'events',
        replied: false,
        deferred: false,
      };

      await interactionHandler(mockInteraction);

      // Wait for the async handler
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(eventsListCommand.handleInteraction).toHaveBeenCalledWith(
        mockInteraction,
      );
    });

    it('should route AutocompleteInteraction to correct handler', async () => {
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(false),
        isAutocomplete: jest.fn().mockReturnValue(true),
        commandName: 'event',
        respond: jest.fn().mockResolvedValue(undefined),
      };

      await interactionHandler(mockInteraction);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(eventCreateCommand.handleAutocomplete).toHaveBeenCalledWith(
        mockInteraction,
      );
    });

    it('should route roster command to roster handler', async () => {
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        isAutocomplete: jest.fn().mockReturnValue(false),
        commandName: 'roster',
        replied: false,
        deferred: false,
      };

      await interactionHandler(mockInteraction);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(rosterViewCommand.handleInteraction).toHaveBeenCalledWith(
        mockInteraction,
      );
    });

    it('should ignore unknown commands without throwing', async () => {
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        isAutocomplete: jest.fn().mockReturnValue(false),
        commandName: 'unknown-command',
        replied: false,
        deferred: false,
      };

      await interactionHandler(mockInteraction);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(eventCreateCommand.handleInteraction).not.toHaveBeenCalled();
      expect(eventsListCommand.handleInteraction).not.toHaveBeenCalled();
      expect(rosterViewCommand.handleInteraction).not.toHaveBeenCalled();
    });

    it('should ignore non-command, non-autocomplete interactions', async () => {
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(false),
        isAutocomplete: jest.fn().mockReturnValue(false),
        commandName: 'some-button',
      };

      await interactionHandler(mockInteraction);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(eventCreateCommand.handleInteraction).not.toHaveBeenCalled();
      expect(eventsListCommand.handleInteraction).not.toHaveBeenCalled();
    });

    it('should reply with error when command handler throws and interaction not yet replied', async () => {
      const mockReply = jest.fn().mockResolvedValue(undefined);
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        isAutocomplete: jest.fn().mockReturnValue(false),
        commandName: 'events',
        replied: false,
        deferred: false,
        reply: mockReply,
      };

      eventsListCommand.handleInteraction.mockRejectedValue(
        new Error('Handler error'),
      );

      await interactionHandler(mockInteraction);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockReply).toHaveBeenCalledWith({
        content: 'Something went wrong. Please try again later.',
        ephemeral: true,
      });
    });

    it('should followUp with error when command handler throws and interaction already deferred', async () => {
      const mockFollowUp = jest.fn().mockResolvedValue(undefined);
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        isAutocomplete: jest.fn().mockReturnValue(false),
        commandName: 'events',
        replied: false,
        deferred: true,
        followUp: mockFollowUp,
      };

      eventsListCommand.handleInteraction.mockRejectedValue(
        new Error('Handler error'),
      );

      await interactionHandler(mockInteraction);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockFollowUp).toHaveBeenCalledWith({
        content: 'Something went wrong. Please try again later.',
        ephemeral: true,
      });
    });

    it('should followUp with error when command handler throws and interaction already replied', async () => {
      const mockFollowUp = jest.fn().mockResolvedValue(undefined);
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        isAutocomplete: jest.fn().mockReturnValue(false),
        commandName: 'events',
        replied: true,
        deferred: false,
        followUp: mockFollowUp,
      };

      eventsListCommand.handleInteraction.mockRejectedValue(
        new Error('Handler error'),
      );

      await interactionHandler(mockInteraction);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockFollowUp).toHaveBeenCalledWith({
        content: 'Something went wrong. Please try again later.',
        ephemeral: true,
      });
    });

    it('should respond with empty array when autocomplete handler throws', async () => {
      const mockRespond = jest.fn().mockResolvedValue(undefined);
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(false),
        isAutocomplete: jest.fn().mockReturnValue(true),
        commandName: 'event',
        respond: mockRespond,
      };

      eventCreateCommand.handleAutocomplete!.mockRejectedValue(
        new Error('Autocomplete error'),
      );

      await interactionHandler(mockInteraction);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRespond).toHaveBeenCalledWith([]);
    });

    it('should skip autocomplete for commands without autocomplete handler', async () => {
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(false),
        isAutocomplete: jest.fn().mockReturnValue(true),
        commandName: 'events', // eventsListCommand has no handleAutocomplete
        respond: jest.fn().mockResolvedValue(undefined),
      };

      await interactionHandler(mockInteraction);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not throw and should not call any handleAutocomplete
      expect(eventsListCommand.handleInteraction).not.toHaveBeenCalled();
    });
  });
});
