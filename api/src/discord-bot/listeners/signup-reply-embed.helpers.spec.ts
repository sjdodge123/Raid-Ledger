import { EmbedBuilder } from 'discord.js';
import { buildReplyEmbed } from './signup-reply-embed.helpers';

describe('buildReplyEmbed', () => {
  function createMockDeps() {
    const mockEmbed = new EmbedBuilder().setTitle('Test Event');
    return {
      deps: {
        eventsService: {
          buildEmbedEventData: jest.fn().mockResolvedValue({
            id: 1,
            title: 'Test Event',
          }),
        },
        embedFactory: {
          buildEventEmbed: jest.fn().mockReturnValue({
            embed: mockEmbed,
            row: {},
          }),
        },
        settingsService: {
          getBranding: jest.fn().mockResolvedValue({
            communityName: 'Test Guild',
            communityLogoPath: null,
          }),
          getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
        },
        logger: { warn: jest.fn() },
      },
      mockEmbed,
    };
  }

  it('returns the embed from embedFactory', async () => {
    const { deps, mockEmbed } = createMockDeps();

    const result = await buildReplyEmbed(1, deps as never);

    expect(result).toBe(mockEmbed);
  });

  it('passes correct context to buildEventEmbed', async () => {
    const { deps } = createMockDeps();
    const originalEnv = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'https://example.com';

    await buildReplyEmbed(1, deps as never);

    expect(deps.embedFactory.buildEventEmbed).toHaveBeenCalledWith(
      { id: 1, title: 'Test Event' },
      {
        communityName: 'Test Guild',
        clientUrl: 'https://example.com',
        timezone: 'UTC',
      },
    );

    process.env.CLIENT_URL = originalEnv;
  });

  it('returns undefined when buildEmbedEventData throws', async () => {
    const { deps } = createMockDeps();
    deps.eventsService.buildEmbedEventData.mockRejectedValueOnce(
      new Error('DB error'),
    );

    const result = await buildReplyEmbed(1, deps as never);

    expect(result).toBeUndefined();
  });

  it('returns undefined when settingsService throws', async () => {
    const { deps } = createMockDeps();
    deps.settingsService.getBranding.mockRejectedValueOnce(
      new Error('Settings error'),
    );

    const result = await buildReplyEmbed(1, deps as never);

    expect(result).toBeUndefined();
  });
});
