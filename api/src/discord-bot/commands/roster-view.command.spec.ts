/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { RosterViewCommand } from './roster-view.command';
import { SignupsService } from '../../events/signups.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import { EMBED_COLORS } from '../discord-bot.constants';

describe('RosterViewCommand', () => {
  let module: TestingModule;
  let command: RosterViewCommand;
  let signupsService: jest.Mocked<SignupsService>;
  let mockDb: {
    select: jest.Mock;
  };

  const originalClientUrl = process.env.CLIENT_URL;

  const mockInteraction = (eventInput: string) => ({
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    options: {
      getString: jest.fn().mockReturnValue(eventInput),
    },
  });

  const makeRoster = (
    assignments: { slot: string | null; username: string }[] = [],
    pool: { username: string }[] = [],
    slots: Record<string, number> | null = null,
  ) => ({
    assignments,
    pool,
    slots,
  });

  // Chain-able mock for Drizzle query builder
  const createChainMock = (resolvedValue: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(resolvedValue);
    chain.orderBy = jest.fn().mockReturnValue(chain);
    return chain;
  };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;

    mockDb = {
      select: jest.fn().mockReturnValue(createChainMock()),
    };

    const module_: TestingModule = await Test.createTestingModule({
      providers: [
        RosterViewCommand,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
        {
          provide: SignupsService,
          useValue: {
            getRosterWithAssignments: jest.fn(),
          },
        },
        {
          provide: DiscordEmojiService,
          useValue: {
            getRoleEmoji: jest.fn((role: string) => {
              const map: Record<string, string> = {
                tank: '\uD83D\uDEE1\uFE0F',
                healer: '\uD83D\uDC9A',
                dps: '\u2694\uFE0F',
              };
              return map[role] ?? '';
            }),
            isUsingCustomEmojis: jest.fn(() => false),
          },
        },
      ],
    }).compile();

    module = module_;
    command = module.get(RosterViewCommand);
    signupsService = module.get(SignupsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();

    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  describe('getDefinition', () => {
    it('should return a command definition named "roster"', () => {
      const definition = command.getDefinition();
      expect(definition.name).toBe('roster');
    });

    it('should have required "event" option', () => {
      const definition = command.getDefinition();
      const options = definition.options ?? [];
      const eventOption = options.find((o) => o.name === 'event');
      expect(eventOption).toBeDefined();
    });
  });

  describe('handleInteraction', () => {
    it('should defer reply as ephemeral', async () => {
      const interaction = mockInteraction('42');
      const chain = createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]);
      mockDb.select.mockReturnValue(chain);
      signupsService.getRosterWithAssignments.mockResolvedValue(
        makeRoster() as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it('should resolve event by numeric ID', async () => {
      const interaction = mockInteraction('42');
      const chain = createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]);
      mockDb.select.mockReturnValue(chain);
      signupsService.getRosterWithAssignments.mockResolvedValue(
        makeRoster() as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(signupsService.getRosterWithAssignments).toHaveBeenCalledWith(42);
    });

    it('should search by title when input is not a number', async () => {
      const interaction = mockInteraction('Test Raid');

      const searchChain = createChainMock([{ id: 99 }]);
      const detailChain = createChainMock([
        { title: 'Test Raid', maxAttendees: 20 },
      ]);

      mockDb.select
        .mockReturnValueOnce(searchChain)
        .mockReturnValueOnce(detailChain);

      signupsService.getRosterWithAssignments.mockResolvedValue(
        makeRoster() as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(signupsService.getRosterWithAssignments).toHaveBeenCalledWith(99);
    });

    it('should reply with not found message when title search returns no results', async () => {
      const interaction = mockInteraction('Unknown Event');
      const chain = createChainMock([]); // no results
      mockDb.select.mockReturnValue(chain);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        'No event found matching "Unknown Event".',
      );
      expect(signupsService.getRosterWithAssignments).not.toHaveBeenCalled();
    });

    it('should reply with "Event not found" when event detail query returns nothing', async () => {
      const interaction = mockInteraction('42');
      // roster service returns fine, but event details query returns empty
      signupsService.getRosterWithAssignments.mockResolvedValue(
        makeRoster() as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );
      const chain = createChainMock([]); // no event details
      mockDb.select.mockReturnValue(chain);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith('Event not found.');
    });

    it('should show "No signups yet." when roster is empty', async () => {
      const interaction = mockInteraction('42');
      const chain = createChainMock([
        { title: 'Empty Raid', maxAttendees: 20 },
      ]);
      mockDb.select.mockReturnValue(chain);
      signupsService.getRosterWithAssignments.mockResolvedValue(
        makeRoster([], []) as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toBe('No signups yet.');
    });

    it('should group assignments by role', async () => {
      const interaction = mockInteraction('42');
      const chain = createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]);
      mockDb.select.mockReturnValue(chain);

      const roster = makeRoster(
        [
          { slot: 'tank', username: 'TankPlayer' },
          { slot: 'healer', username: 'HealerPlayer' },
          { slot: 'dps', username: 'DpsPlayer' },
        ],
        [],
        { tank: 2, healer: 3, dps: 5 },
      );
      signupsService.getRosterWithAssignments.mockResolvedValue(
        roster as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      const description = call.embeds[0].data.description ?? '';
      expect(description).toContain('TankPlayer');
      expect(description).toContain('HealerPlayer');
      expect(description).toContain('DpsPlayer');
    });

    it('should show unassigned pool members', async () => {
      const interaction = mockInteraction('42');
      const chain = createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]);
      mockDb.select.mockReturnValue(chain);

      const roster = makeRoster([], [{ username: 'UnassignedPlayer' }], null);
      signupsService.getRosterWithAssignments.mockResolvedValue(
        roster as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('UnassignedPlayer');
      expect(call.embeds[0].data.description).toContain('Unassigned');
    });

    it('should use roster update color for the embed', async () => {
      const interaction = mockInteraction('42');
      const chain = createChainMock([
        { title: 'Test Raid', maxAttendees: null },
      ]);
      mockDb.select.mockReturnValue(chain);
      signupsService.getRosterWithAssignments.mockResolvedValue(
        makeRoster() as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { color?: number } }[];
      };
      expect(call.embeds[0].data.color).toBe(EMBED_COLORS.ROSTER_UPDATE);
    });

    it('should include footer with total and max attendees when set', async () => {
      const interaction = mockInteraction('42');
      const chain = createChainMock([{ title: 'Test Raid', maxAttendees: 25 }]);
      mockDb.select.mockReturnValue(chain);

      const roster = makeRoster(
        [{ slot: 'tank', username: 'Player1' }],
        [{ username: 'Player2' }],
      );
      signupsService.getRosterWithAssignments.mockResolvedValue(
        roster as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { footer?: { text: string } } }[];
      };
      expect(call.embeds[0].data.footer?.text).toContain('2 total signups');
      expect(call.embeds[0].data.footer?.text).toContain('25');
    });

    it('should include View Full Roster button when CLIENT_URL is set', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      const interaction = mockInteraction('42');
      const chain = createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]);
      mockDb.select.mockReturnValue(chain);
      signupsService.getRosterWithAssignments.mockResolvedValue(
        makeRoster() as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: unknown[];
      };
      expect(call.components.length).toBeGreaterThan(0);
    });

    it('should not include button when CLIENT_URL is not set', async () => {
      delete process.env.CLIENT_URL;
      const interaction = mockInteraction('42');
      const chain = createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]);
      mockDb.select.mockReturnValue(chain);
      signupsService.getRosterWithAssignments.mockResolvedValue(
        makeRoster() as unknown as Awaited<
          ReturnType<typeof signupsService.getRosterWithAssignments>
        >,
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: unknown[];
      };
      expect(call.components).toHaveLength(0);
    });

    it('should handle service errors gracefully', async () => {
      const interaction = mockInteraction('42');
      signupsService.getRosterWithAssignments.mockRejectedValue(
        new Error('Database error'),
      );

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        'Failed to fetch roster. Please try again later.',
      );
    });
  });

  describe('handleAutocomplete', () => {
    it('should respond with matching events', async () => {
      const mockRespond = jest.fn().mockResolvedValue(undefined);
      const mockAutocompleteInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue('Test'),
        },
        respond: mockRespond,
      };

      const chain = createChainMock([
        { id: 1, title: 'Test Raid' },
        { id: 2, title: 'Test Dungeon' },
      ]);
      mockDb.select.mockReturnValue(chain);

      await command.handleAutocomplete(
        mockAutocompleteInteraction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(mockRespond).toHaveBeenCalledWith([
        { name: 'Test Raid', value: '1' },
        { name: 'Test Dungeon', value: '2' },
      ]);
    });

    it('should respond with empty array when no events match', async () => {
      const mockRespond = jest.fn().mockResolvedValue(undefined);
      const mockAutocompleteInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue('NonExistent'),
        },
        respond: mockRespond,
      };

      const chain = createChainMock([]);
      mockDb.select.mockReturnValue(chain);

      await command.handleAutocomplete(
        mockAutocompleteInteraction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(mockRespond).toHaveBeenCalledWith([]);
    });

    it('should respond with all upcoming events when query is empty', async () => {
      const mockRespond = jest.fn().mockResolvedValue(undefined);
      const mockAutocompleteInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue(''),
        },
        respond: mockRespond,
      };

      const chain = createChainMock([{ id: 5, title: 'Upcoming Event' }]);
      mockDb.select.mockReturnValue(chain);

      await command.handleAutocomplete(
        mockAutocompleteInteraction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(mockRespond).toHaveBeenCalledWith([
        { name: 'Upcoming Event', value: '5' },
      ]);
    });

    it('should return event IDs as strings for values', async () => {
      const mockRespond = jest.fn().mockResolvedValue(undefined);
      const mockAutocompleteInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue(''),
        },
        respond: mockRespond,
      };

      const chain = createChainMock([{ id: 42, title: 'My Event' }]);
      mockDb.select.mockReturnValue(chain);

      await command.handleAutocomplete(
        mockAutocompleteInteraction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      const callArgs = (mockRespond.mock.calls as unknown[][])[0][0] as {
        name: string;
        value: string;
      }[];
      expect(typeof callArgs[0].value).toBe('string');
      expect(callArgs[0].value).toBe('42');
    });
  });
});
