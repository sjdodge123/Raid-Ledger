import { Test, TestingModule } from '@nestjs/testing';
import { PlayingCommand } from './playing.command';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

/** Build a ChatInputCommandInteraction-like mock. */
function makeChatInteraction(gameName: string | null = null) {
  return {
    user: { id: 'user-discord-1' },
    options: {
      getString: jest.fn().mockReturnValue(gameName),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

/** Build an AutocompleteInteraction-like mock. */
function makeAutocompleteInteraction(focusedValue = '') {
  return {
    options: {
      getFocused: jest.fn().mockReturnValue({ name: 'game', value: focusedValue }),
    },
    respond: jest.fn().mockResolvedValue(undefined),
  };
}

describe('PlayingCommand', () => {
  let command: PlayingCommand;
  let mockPresenceDetector: {
    setManualOverride: jest.Mock;
    clearManualOverride: jest.Mock;
    getManualOverride: jest.Mock;
  };
  let mockLimitFn: jest.Mock;

  beforeEach(async () => {
    mockLimitFn = jest.fn();

    const selectChain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: mockLimitFn,
    };

    const mockDb = {
      select: jest.fn().mockReturnValue(selectChain),
    };

    mockPresenceDetector = {
      setManualOverride: jest.fn(),
      clearManualOverride: jest.fn(),
      getManualOverride: jest.fn().mockReturnValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayingCommand,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: PresenceGameDetectorService, useValue: mockPresenceDetector },
      ],
    }).compile();

    command = module.get(PlayingCommand);
  });

  describe('getDefinition', () => {
    it('returns a command definition with name "playing"', () => {
      const def = command.getDefinition();
      expect(def.name).toBe('playing');
    });

    it('includes a "game" string option', () => {
      const def = command.getDefinition();
      expect(def.options).toBeDefined();
      const options = def.options as Array<{ name: string }>;
      expect(options.some((o) => o.name === 'game')).toBe(true);
    });
  });

  describe('handleInteraction', () => {
    it('sets manual override when a game name is provided', async () => {
      // DB lookup resolves the game name to a canonical name
      mockLimitFn.mockResolvedValueOnce([{ id: 1, name: 'World of Warcraft' }]);

      const interaction = makeChatInteraction('world of warcraft');
      await command.handleInteraction(interaction as any);

      expect(mockPresenceDetector.setManualOverride).toHaveBeenCalledWith(
        'user-discord-1',
        'World of Warcraft',
      );
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true }),
      );
    });

    it('uses the raw input as override name when no DB match found', async () => {
      mockLimitFn.mockResolvedValueOnce([]); // no game match

      const interaction = makeChatInteraction('MyCustomGame');
      await command.handleInteraction(interaction as any);

      expect(mockPresenceDetector.setManualOverride).toHaveBeenCalledWith(
        'user-discord-1',
        'MyCustomGame',
      );
    });

    it('clears manual override when no game name is provided', async () => {
      const interaction = makeChatInteraction(null);
      await command.handleInteraction(interaction as any);

      expect(mockPresenceDetector.clearManualOverride).toHaveBeenCalledWith(
        'user-discord-1',
      );
      expect(mockPresenceDetector.setManualOverride).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true }),
      );
    });

    it('replies ephemerally in both set and clear cases', async () => {
      // Set case
      mockLimitFn.mockResolvedValueOnce([{ id: 1, name: 'Fortnite' }]);
      const setInteraction = makeChatInteraction('Fortnite');
      await command.handleInteraction(setInteraction as any);
      expect(setInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true }),
      );

      // Clear case
      const clearInteraction = makeChatInteraction(null);
      await command.handleInteraction(clearInteraction as any);
      expect(clearInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true }),
      );
    });
  });

  describe('handleAutocomplete', () => {
    it('responds with matching game names', async () => {
      const mockResults = [
        { id: 1, name: 'World of Warcraft' },
        { id: 2, name: 'Warframe' },
      ];
      mockLimitFn.mockResolvedValueOnce(mockResults);

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
      mockLimitFn.mockResolvedValueOnce([]);

      const interaction = makeAutocompleteInteraction('xyz123');
      await command.handleAutocomplete(interaction as any);

      expect(interaction.respond).toHaveBeenCalledWith([]);
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
});
