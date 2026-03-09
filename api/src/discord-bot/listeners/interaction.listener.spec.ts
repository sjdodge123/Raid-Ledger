import { Test, TestingModule } from '@nestjs/testing';
import { InteractionListener } from './interaction.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EventCreateCommand } from '../commands/event-create.command';
import { EventsListCommand } from '../commands/events-list.command';
import { RosterViewCommand } from '../commands/roster-view.command';
import { BindCommand } from '../commands/bind.command';
import { UnbindCommand } from '../commands/unbind.command';
import { BindingsCommand } from '../commands/bindings.command';
import { InviteCommand } from '../commands/invite.command';
import { HelpCommand } from '../commands/help.command';
import { PlayingCommand } from '../commands/playing.command';
import { Events, MessageFlags } from 'discord.js';

let testModule: TestingModule;
let listener: InteractionListener;
let clientService: jest.Mocked<DiscordBotClientService>;
let eventCreateCommand: jest.Mocked<EventCreateCommand>;
let eventsListCommand: jest.Mocked<EventsListCommand>;
let rosterViewCommand: jest.Mocked<RosterViewCommand>;
let mockClient: { on: jest.Mock };

function createMockCommands() {
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
}

function buildInteractionProviders() {
  return [
    InteractionListener,
    {
      provide: DiscordBotClientService,
      useValue: { getClient: jest.fn().mockReturnValue(mockClient) },
    },
    { provide: EventCreateCommand, useValue: eventCreateCommand },
    { provide: EventsListCommand, useValue: eventsListCommand },
    { provide: RosterViewCommand, useValue: rosterViewCommand },
    {
      provide: BindCommand,
      useValue: {
        commandName: 'bind',
        handleInteraction: jest.fn().mockResolvedValue(undefined),
        handleAutocomplete: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: UnbindCommand,
      useValue: {
        commandName: 'unbind',
        handleInteraction: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: BindingsCommand,
      useValue: {
        commandName: 'bindings',
        handleInteraction: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: InviteCommand,
      useValue: {
        commandName: 'invite',
        handleInteraction: jest.fn().mockResolvedValue(undefined),
        handleAutocomplete: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: HelpCommand,
      useValue: {
        commandName: 'help',
        handleInteraction: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: PlayingCommand,
      useValue: {
        commandName: 'playing',
        handleInteraction: jest.fn().mockResolvedValue(undefined),
        handleAutocomplete: jest.fn().mockResolvedValue(undefined),
      },
    },
  ];
}

async function setupInteractionModule() {
  mockClient = { on: jest.fn() };
  createMockCommands();

  const module_ = await Test.createTestingModule({
    providers: buildInteractionProviders(),
  }).compile();

  testModule = module_;
  listener = testModule.get(InteractionListener);
  clientService = testModule.get(DiscordBotClientService);
}

function captureInteractionHandler(): (interaction: unknown) => Promise<void> {
  listener.attachListener();
  const callArgs = (mockClient.on.mock.calls as unknown[][])[0] as [
    string,
    (interaction: unknown) => Promise<void>,
  ];
  return callArgs[1];
}

describe('InteractionListener', () => {
  beforeEach(async () => {
    await setupInteractionModule();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await testModule.close();
  });

  describe('attachListener', () => {
    attachListenerTests();
  });

  describe('detachListener', () => {
    detachListenerTests();
  });

  describe('handleInteraction (via attached listener)', () => {
    handleInteractionTests();
  });
});

function attachListenerTests() {
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
    expect(mockClient.on).toHaveBeenCalledTimes(1);
  });

  it('should allow re-attaching after detachListener is called', () => {
    listener.attachListener();
    listener.detachListener();
    listener.attachListener();
    expect(mockClient.on).toHaveBeenCalledTimes(2);
  });
}

function detachListenerTests() {
  it('should reset listener state on disconnect', () => {
    listener.attachListener();
    listener.detachListener();
    listener.attachListener();
    expect(mockClient.on).toHaveBeenCalledTimes(2);
  });
}

function handleInteractionTests() {
  let interactionHandler: (interaction: unknown) => Promise<void>;

  beforeEach(() => {
    interactionHandler = captureInteractionHandler();
  });

  it('should route ChatInputCommandInteraction to correct handler', async () => {
    await handleInteractionCommandRouteTests(interactionHandler);
  });

  it('should route AutocompleteInteraction to correct handler', async () => {
    await handleAutocompleteRouteTest(interactionHandler);
  });

  it('should route roster command to roster handler', async () => {
    await handleRosterRouteTest(interactionHandler);
  });

  it('should ignore unknown commands without throwing', async () => {
    await handleUnknownCommandTest(interactionHandler);
  });

  it('should ignore non-command, non-autocomplete interactions', async () => {
    await handleNonCommandTest(interactionHandler);
  });

  it('should reply with error when handler throws and not yet replied', async () => {
    await handleErrorReplyTest(interactionHandler);
  });

  it('should followUp when handler throws and already deferred', async () => {
    await handleErrorFollowUpDeferredTest(interactionHandler);
  });

  it('should followUp when handler throws and already replied', async () => {
    await handleErrorFollowUpRepliedTest(interactionHandler);
  });

  it('should respond with empty array when autocomplete handler throws', async () => {
    await handleAutocompleteErrorTest(interactionHandler);
  });

  it('should skip autocomplete for commands without autocomplete handler', async () => {
    await handleAutocompleteNoHandlerTest(interactionHandler);
  });
}

async function handleInteractionCommandRouteTests(
  handler: (i: unknown) => Promise<void>,
) {
  const mockInteraction = {
    isChatInputCommand: jest.fn().mockReturnValue(true),
    isAutocomplete: jest.fn().mockReturnValue(false),
    commandName: 'events',
    replied: false,
    deferred: false,
  };
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(eventsListCommand.handleInteraction).toHaveBeenCalledWith(
    mockInteraction,
  );
}

async function handleAutocompleteRouteTest(
  handler: (i: unknown) => Promise<void>,
) {
  const mockInteraction = {
    isChatInputCommand: jest.fn().mockReturnValue(false),
    isAutocomplete: jest.fn().mockReturnValue(true),
    commandName: 'event',
    respond: jest.fn().mockResolvedValue(undefined),
  };
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(eventCreateCommand.handleAutocomplete).toHaveBeenCalledWith(
    mockInteraction,
  );
}

async function handleRosterRouteTest(handler: (i: unknown) => Promise<void>) {
  const mockInteraction = {
    isChatInputCommand: jest.fn().mockReturnValue(true),
    isAutocomplete: jest.fn().mockReturnValue(false),
    commandName: 'roster',
    replied: false,
    deferred: false,
  };
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(rosterViewCommand.handleInteraction).toHaveBeenCalledWith(
    mockInteraction,
  );
}

async function handleUnknownCommandTest(
  handler: (i: unknown) => Promise<void>,
) {
  const mockInteraction = {
    isChatInputCommand: jest.fn().mockReturnValue(true),
    isAutocomplete: jest.fn().mockReturnValue(false),
    commandName: 'unknown-command',
    replied: false,
    deferred: false,
  };
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(eventCreateCommand.handleInteraction).not.toHaveBeenCalled();
  expect(eventsListCommand.handleInteraction).not.toHaveBeenCalled();
  expect(rosterViewCommand.handleInteraction).not.toHaveBeenCalled();
}

async function handleNonCommandTest(handler: (i: unknown) => Promise<void>) {
  const mockInteraction = {
    isChatInputCommand: jest.fn().mockReturnValue(false),
    isAutocomplete: jest.fn().mockReturnValue(false),
    commandName: 'some-button',
  };
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(eventCreateCommand.handleInteraction).not.toHaveBeenCalled();
  expect(eventsListCommand.handleInteraction).not.toHaveBeenCalled();
}

async function handleErrorReplyTest(handler: (i: unknown) => Promise<void>) {
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
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(mockReply).toHaveBeenCalledWith({
    content: 'Something went wrong. Please try again later.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleErrorFollowUpDeferredTest(
  handler: (i: unknown) => Promise<void>,
) {
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
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(mockFollowUp).toHaveBeenCalledWith({
    content: 'Something went wrong. Please try again later.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleErrorFollowUpRepliedTest(
  handler: (i: unknown) => Promise<void>,
) {
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
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(mockFollowUp).toHaveBeenCalledWith({
    content: 'Something went wrong. Please try again later.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAutocompleteErrorTest(
  handler: (i: unknown) => Promise<void>,
) {
  const mockRespond = jest.fn().mockResolvedValue(undefined);
  const mockInteraction = {
    isChatInputCommand: jest.fn().mockReturnValue(false),
    isAutocomplete: jest.fn().mockReturnValue(true),
    commandName: 'event',
    respond: mockRespond,
  };
  eventCreateCommand.handleAutocomplete.mockRejectedValue(
    new Error('Autocomplete error'),
  );
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(mockRespond).toHaveBeenCalledWith([]);
}

async function handleAutocompleteNoHandlerTest(
  handler: (i: unknown) => Promise<void>,
) {
  const mockInteraction = {
    isChatInputCommand: jest.fn().mockReturnValue(false),
    isAutocomplete: jest.fn().mockReturnValue(true),
    commandName: 'events',
    respond: jest.fn().mockResolvedValue(undefined),
  };
  await handler(mockInteraction);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(eventsListCommand.handleInteraction).not.toHaveBeenCalled();
}
