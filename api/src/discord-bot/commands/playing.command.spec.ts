import { Test, TestingModule } from '@nestjs/testing';
import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { COMMAND_REPLY_AUTHORS } from './command-reply-chrome.helpers';
import { colorForState } from '../embeds/embed-chrome.helpers';
import { PlayingCommand } from './playing.command';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

/** Build a ChatInputCommandInteraction-like mock. */
function makeChatInteraction(gameName: string | null = null) {
  return {
    user: { id: 'user-discord-1' },
    options: { getString: jest.fn().mockReturnValue(gameName) },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

/** Build an AutocompleteInteraction-like mock. */
function makeAutocompleteInteraction(focusedValue = '') {
  return {
    options: {
      getFocused: jest
        .fn()
        .mockReturnValue({ name: 'game', value: focusedValue }),
    },
    respond: jest.fn().mockResolvedValue(undefined),
  };
}

function buildSelectChain(limitFn: jest.Mock) {
  return {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: limitFn,
  };
}

async function buildModule(mockDb: unknown, detector: unknown) {
  return Test.createTestingModule({
    providers: [
      PlayingCommand,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: PresenceGameDetectorService, useValue: detector },
    ],
  }).compile();
}

type MockDetector = {
  setManualOverride: jest.Mock;
  clearManualOverride: jest.Mock;
  getManualOverride: jest.Mock;
};

function createDetector(): MockDetector {
  return {
    setManualOverride: jest.fn(),
    clearManualOverride: jest.fn(),
    getManualOverride: jest.fn().mockReturnValue(null),
  };
}

function createDbAndModule(detector: MockDetector) {
  const limitFn = jest.fn();
  const db = { select: jest.fn().mockReturnValue(buildSelectChain(limitFn)) };
  return { limitFn, db, detector };
}

describe('PlayingCommand — getDefinition', () => {
  let command: PlayingCommand;

  beforeEach(async () => {
    const { db, detector } = createDbAndModule(createDetector());
    const module: TestingModule = await buildModule(db, detector);
    command = module.get(PlayingCommand);
  });

  it('returns a command definition with name "playing"', () => {
    expect(command.getDefinition().name).toBe('playing');
  });

  it('includes a "game" string option', () => {
    const options = command.getDefinition().options as Array<{ name: string }>;
    expect(options.some((o) => o.name === 'game')).toBe(true);
  });
});

describe('PlayingCommand — handleInteraction set', () => {
  let command: PlayingCommand;
  let detector: MockDetector;
  let limitFn: jest.Mock;

  beforeEach(async () => {
    detector = createDetector();
    const setup = createDbAndModule(detector);
    limitFn = setup.limitFn;
    const module: TestingModule = await buildModule(setup.db, detector);
    command = module.get(PlayingCommand);
  });

  it('sets manual override when a game name is provided', async () => {
    limitFn.mockResolvedValueOnce([{ id: 1, name: 'World of Warcraft' }]);
    const interaction = makeChatInteraction('world of warcraft');
    await command.handleInteraction(interaction as any);
    expect(detector.setManualOverride).toHaveBeenCalledWith(
      'user-discord-1',
      'World of Warcraft',
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it('uses the raw input as override name when no DB match found', async () => {
    limitFn.mockResolvedValueOnce([]);
    const interaction = makeChatInteraction('MyCustomGame');
    await command.handleInteraction(interaction as any);
    expect(detector.setManualOverride).toHaveBeenCalledWith(
      'user-discord-1',
      'MyCustomGame',
    );
  });
});

describe('PlayingCommand — handleInteraction clear', () => {
  let command: PlayingCommand;
  let detector: MockDetector;
  let limitFn: jest.Mock;

  beforeEach(async () => {
    detector = createDetector();
    const setup = createDbAndModule(detector);
    limitFn = setup.limitFn;
    const module: TestingModule = await buildModule(setup.db, detector);
    command = module.get(PlayingCommand);
  });

  it('clears manual override when no game name is provided', async () => {
    const interaction = makeChatInteraction(null);
    await command.handleInteraction(interaction as any);
    expect(detector.clearManualOverride).toHaveBeenCalledWith('user-discord-1');
    expect(detector.setManualOverride).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it('replies ephemerally in both set and clear cases', async () => {
    limitFn.mockResolvedValueOnce([{ id: 1, name: 'Fortnite' }]);
    const setInteraction = makeChatInteraction('Fortnite');
    await command.handleInteraction(setInteraction as any);
    expect(setInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    const clearInteraction = makeChatInteraction(null);
    await command.handleInteraction(clearInteraction as any);
    expect(clearInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });
});

describe('PlayingCommand — autocomplete matching', () => {
  let command: PlayingCommand;
  let limitFn: jest.Mock;

  beforeEach(async () => {
    const detector = createDetector();
    const setup = createDbAndModule(detector);
    limitFn = setup.limitFn;
    const module: TestingModule = await buildModule(setup.db, detector);
    command = module.get(PlayingCommand);
  });

  it('responds with matching game names', async () => {
    const mockResults = [
      { id: 1, name: 'World of Warcraft' },
      { id: 2, name: 'Warframe' },
    ];
    limitFn.mockResolvedValueOnce(mockResults);
    const interaction = makeAutocompleteInteraction('War');
    await command.handleAutocomplete(interaction as any);
    expect(interaction.respond).toHaveBeenCalledWith(
      expect.arrayContaining([
        { name: 'World of Warcraft', value: 'World of Warcraft' },
        { name: 'Warframe', value: 'Warframe' },
      ]),
    );
  });

  it('responds with empty array when no games match', async () => {
    limitFn.mockResolvedValueOnce([]);
    const interaction = makeAutocompleteInteraction('xyz123');
    await command.handleAutocomplete(interaction as any);
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});

describe('PlayingCommand — autocomplete non-game focus', () => {
  let command: PlayingCommand;

  beforeEach(async () => {
    const detector = createDetector();
    const setup = createDbAndModule(detector);
    const module: TestingModule = await buildModule(setup.db, detector);
    command = module.get(PlayingCommand);
  });

  it('does nothing when the focused option is not "game"', async () => {
    const interaction = {
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'other', value: '' }),
      },
      respond: jest.fn().mockResolvedValue(undefined),
    };
    await command.handleAutocomplete(interaction as any);
    expect(interaction.respond).not.toHaveBeenCalled();
  });
});

/**
 * ROK-1477 (Lane A) — `/playing` on the shared chrome (D3).
 *
 * Ephemeral replies are still CHANNEL embeds: an ephemeral message renders in
 * a channel context and must never carry a personalized field, so the
 * `ChannelEmbedBuilder` write-time guard is exactly the protection we want.
 * Set and clear are distinct outcomes and get distinct author lines.
 */
describe('PlayingCommand — shared chrome (ROK-1477)', () => {
  let command: PlayingCommand;
  let detector: MockDetector;
  let limitFn: jest.Mock;

  beforeEach(async () => {
    detector = createDetector();
    const setup = createDbAndModule(detector);
    limitFn = setup.limitFn;
    const module: TestingModule = await buildModule(setup.db, detector);
    command = module.get(PlayingCommand);
  });

  async function embedData(
    gameName: string | null,
  ): Promise<{ color?: number; author?: { name: string } }> {
    limitFn.mockResolvedValueOnce([]);
    const interaction = makeChatInteraction(gameName);
    await command.handleInteraction(
      interaction as unknown as ChatInputCommandInteraction,
    );
    const payload = interaction.reply.mock.calls[0][0] as {
      embeds: { data: { color?: number; author?: { name: string } } }[];
    };
    return payload.embeds[0].data;
  }

  it('names the SET outcome in the author line', async () => {
    expect((await embedData('Hades')).author?.name).toBe(
      COMMAND_REPLY_AUTHORS.PLAYING_SET,
    );
  });

  it('names the CLEARED outcome distinctly from SET', async () => {
    expect((await embedData(null)).author?.name).toBe(
      COMMAND_REPLY_AUTHORS.PLAYING_CLEARED,
    );
  });

  it('renders both outcomes slate done', async () => {
    expect((await embedData('Hades')).color).toBe(colorForState('done'));
    expect((await embedData(null)).color).toBe(colorForState('done'));
  });
});
