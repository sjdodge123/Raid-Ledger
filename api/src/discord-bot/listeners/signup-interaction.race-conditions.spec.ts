/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-enable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-enable @typescript-eslint/no-unsafe-return */

import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import {
  type SignupInteractionMocks,
  createSignupInteractionTestModule,
  makeButtonInteraction,
  makeSelectMenuInteraction,
  makeChain,
} from './signup-interaction.spec-helpers';

describe('SignupInteractionListener — error handling & race conditions', () => {
  let mocks: SignupInteractionMocks;
  const originalClientUrl = process.env.CLIENT_URL;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mocks = await createSignupInteractionTestModule();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await mocks.module.close();
    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  describe('error handling', () => {
    it('should reply with error message when handler throws', async () => {
      const userId = 'user-error-1';
      mocks.mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB connection failed'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:701`,
        userId,
      );

      await mocks.listener.handleButtonInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something went wrong'),
        }),
      );
    });

    it('should ignore button interactions with non-matching customId format', async () => {
      const interaction = makeButtonInteraction('not-a-signup-button');
      await mocks.listener.handleButtonInteraction(interaction);
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should ignore button interactions with NaN eventId', async () => {
      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:not-a-number`,
      );
      await mocks.listener.handleButtonInteraction(interaction);
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe('ROK-376 — interaction race condition handling', () => {
    it('should defer reply immediately before any async work', async () => {
      const userId = 'user-race-defer-1';
      mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 2001, title: 'Race Test', gameId: null }]),
          }),
        }),
      });

      mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
        eventId: 2001,
        signups: [],
        count: 0,
      });
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
      mocks.mockDb.select.mockReturnValueOnce(makeChain([]));

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2001`,
        userId,
      );
      await mocks.listener.handleButtonInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledTimes(1);
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it('should gracefully handle expired interaction (code 10062) at deferReply', async () => {
      const userId = 'user-defer-10062';

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2010`,
        userId,
      );

      const discordError = new Error('Unknown interaction');
      (discordError as unknown as { code: number }).code = 10062;
      interaction.deferReply.mockRejectedValueOnce(discordError);

      await expect(
        mocks.listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();

      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should re-throw non-Discord errors from deferReply', async () => {
      const userId = 'user-defer-rethrow';

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2011`,
        userId,
      );

      interaction.deferReply.mockRejectedValueOnce(
        new Error('Network failure'),
      );

      await expect(
        mocks.listener.handleButtonInteraction(interaction),
      ).rejects.toThrow('Network failure');
    });

    it('should gracefully handle already-acknowledged interaction (code 40060) at deferReply', async () => {
      const userId = 'user-defer-40060';

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2012`,
        userId,
      );

      const discordError = new Error('Interaction has already been acknowledged');
      (discordError as unknown as { code: number }).code = 40060;
      interaction.deferReply.mockRejectedValueOnce(discordError);

      await expect(
        mocks.listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();

      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should gracefully handle already-acknowledged interaction (code 40060) in error path', async () => {
      const userId = 'user-race-40060';
      mocks.mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB error'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2002`,
        userId,
      );

      const discordError = new Error('Interaction has already been acknowledged.');
      (discordError as unknown as { code: number }).code = 40060;
      interaction.editReply.mockRejectedValueOnce(discordError);

      await expect(
        mocks.listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();
    });

    it('should gracefully handle expired interaction (code 10062) in error path', async () => {
      const userId = 'user-race-10062';
      mocks.mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB error'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2003`,
        userId,
      );

      const discordError = new Error('Unknown interaction');
      (discordError as unknown as { code: number }).code = 10062;
      interaction.editReply.mockRejectedValueOnce(discordError);

      await expect(
        mocks.listener.handleButtonInteraction(interaction),
      ).resolves.not.toThrow();
    });

    it('should re-throw non-Discord errors from safeEditReply', async () => {
      const userId = 'user-race-rethrow';
      mocks.mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB error'),
      );

      const interaction = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:2004`,
        userId,
      );

      interaction.editReply.mockRejectedValueOnce(new Error('Network failure'));

      await expect(
        mocks.listener.handleButtonInteraction(interaction),
      ).rejects.toThrow('Network failure');
    });

    it('should handle already-acknowledged error in select menu error path', async () => {
      const userId = 'user-race-select-40060';

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 42, discordId: userId }]),
          }),
        }),
      });

      mocks.mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 2005, title: 'Test', slotConfig: null }]),
          }),
        }),
      });

      mocks.mockSignupsService.signup.mockRejectedValueOnce(
        new Error('Event cancelled'),
      );

      const interaction = makeSelectMenuInteraction(
        `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:2005`,
        ['char-1'],
        userId,
      );

      const discordError = new Error('Interaction has already been acknowledged.');
      (discordError as unknown as { code: number }).code = 40060;
      interaction.editReply.mockRejectedValueOnce(discordError);

      await expect(
        mocks.listener.handleSelectMenuInteraction(interaction),
      ).resolves.not.toThrow();
    });
  });
});
