/**
 * Adversarial tests for buildReplyEmbed — edge cases and error paths
 * not covered by the dev's basic tests.
 */
import { EmbedBuilder } from 'discord.js';
import { buildReplyEmbed } from './signup-reply-embed.helpers';

describe('buildReplyEmbed — adversarial', () => {
  function createMockDeps() {
    const mockEmbed = new EmbedBuilder().setTitle('Test Event');
    return {
      deps: {
        eventsService: {
          buildEmbedEventData: jest.fn().mockResolvedValue({
            id: 42,
            title: 'Raid Night',
          }),
        },
        embedFactory: {
          buildEventEmbed: jest.fn().mockReturnValue({ embed: mockEmbed, row: {} }),
        },
        settingsService: {
          getBranding: jest.fn().mockResolvedValue({
            communityName: 'My Guild',
            communityLogoPath: null,
          }),
          getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
        },
        logger: { warn: jest.fn() },
      },
      mockEmbed,
    };
  }

  describe('CLIENT_URL env var handling', () => {
    it('passes null as clientUrl when CLIENT_URL is not set', async () => {
      const { deps } = createMockDeps();
      const saved = process.env.CLIENT_URL;
      delete process.env.CLIENT_URL;

      await buildReplyEmbed(7, deps as never);

      expect(deps.embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ clientUrl: null }),
      );

      process.env.CLIENT_URL = saved;
    });

    it('passes the CLIENT_URL string when set', async () => {
      const { deps } = createMockDeps();
      const saved = process.env.CLIENT_URL;
      process.env.CLIENT_URL = 'https://my-app.com';

      await buildReplyEmbed(7, deps as never);

      expect(deps.embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ clientUrl: 'https://my-app.com' }),
      );

      process.env.CLIENT_URL = saved;
    });
  });

  describe('graceful fallback on embedFactory failure', () => {
    it('returns undefined when buildEventEmbed throws synchronously', async () => {
      const { deps } = createMockDeps();
      deps.embedFactory.buildEventEmbed.mockImplementation(() => {
        throw new Error('embed build exploded');
      });

      const result = await buildReplyEmbed(1, deps as never);

      expect(result).toBeUndefined();
    });

    it('returns undefined when buildEventEmbed returns an object without embed property', async () => {
      const { deps } = createMockDeps();
      // Simulate a broken factory that returns an unexpected shape
      deps.embedFactory.buildEventEmbed.mockReturnValue({ row: {} });

      const result = await buildReplyEmbed(1, deps as never);

      // embed is undefined — the function should still return undefined, not throw
      expect(result).toBeUndefined();
    });
  });

  describe('graceful fallback on settings failures', () => {
    it('returns undefined when getDefaultTimezone throws', async () => {
      const { deps } = createMockDeps();
      deps.settingsService.getDefaultTimezone.mockRejectedValueOnce(
        new Error('timezone lookup failed'),
      );

      const result = await buildReplyEmbed(1, deps as never);

      expect(result).toBeUndefined();
    });

    it('returns undefined when both getBranding and getDefaultTimezone reject', async () => {
      const { deps } = createMockDeps();
      deps.settingsService.getBranding.mockRejectedValueOnce(
        new Error('branding error'),
      );
      deps.settingsService.getDefaultTimezone.mockRejectedValueOnce(
        new Error('timezone error'),
      );

      const result = await buildReplyEmbed(1, deps as never);

      expect(result).toBeUndefined();
    });
  });

  describe('correct forwarding of event data', () => {
    it('forwards the eventId to buildEmbedEventData', async () => {
      const { deps } = createMockDeps();

      await buildReplyEmbed(99, deps as never);

      expect(deps.eventsService.buildEmbedEventData).toHaveBeenCalledWith(99);
    });

    it('forwards eventData from eventsService directly to buildEventEmbed', async () => {
      const { deps } = createMockDeps();
      const eventData = { id: 42, title: 'Raid Night', slots: 10 };
      deps.eventsService.buildEmbedEventData.mockResolvedValueOnce(eventData);

      await buildReplyEmbed(42, deps as never);

      expect(deps.embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        eventData,
        expect.any(Object),
      );
    });

    it('forwards branding communityName to context', async () => {
      const { deps } = createMockDeps();
      deps.settingsService.getBranding.mockResolvedValueOnce({
        communityName: 'Dragons Inc',
        communityLogoPath: null,
      });

      await buildReplyEmbed(1, deps as never);

      expect(deps.embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ communityName: 'Dragons Inc' }),
      );
    });

    it('fetches branding and timezone concurrently (both called)', async () => {
      const { deps } = createMockDeps();

      await buildReplyEmbed(1, deps as never);

      expect(deps.settingsService.getBranding).toHaveBeenCalledTimes(1);
      expect(deps.settingsService.getDefaultTimezone).toHaveBeenCalledTimes(1);
    });
  });

  describe('return value', () => {
    it('returns the exact embed object from the factory result', async () => {
      const { deps, mockEmbed } = createMockDeps();

      const result = await buildReplyEmbed(1, deps as never);

      expect(result).toBe(mockEmbed);
    });
  });
});
