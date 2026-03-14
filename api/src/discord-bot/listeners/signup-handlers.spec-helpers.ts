/**
 * Shared test helpers for signup handler spec files that test
 * individual handler functions (not the full NestJS listener module).
 *
 * Used by: signup-signup-game, signup-select-character, signup-status-tentative
 */
import type { SignupInteractionDeps } from './signup-interaction.types';
import type { ButtonInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

/** Reusable mock embed returned by the stubbed embedFactory. */
export const MOCK_EMBED = new EmbedBuilder().setTitle('Test Event');

/**
 * Creates a minimal SignupInteractionDeps mock with all stubs needed
 * across the handler-level spec files.
 *
 * Each property is a partial mock — only the methods exercised by the
 * handlers under test are stubbed. The outer cast is safe because
 * handlers only access the stubbed subset.
 */
export function createMockDeps(): SignupInteractionDeps {
  return {
    db: { select: jest.fn() },
    logger: { error: jest.fn(), warn: jest.fn() },
    signupsService: {
      signup: jest.fn().mockResolvedValue({ id: 1, assignedSlot: 'dps' }),
      confirmSignup: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    },
    charactersService: {
      findAllForUser: jest.fn(),
      findOne: jest.fn(),
    },
    eventsService: {
      buildEmbedEventData: jest
        .fn()
        .mockResolvedValue({ id: 1, title: 'Test Event' }),
    },
    embedFactory: {
      buildEventEmbed: jest
        .fn()
        .mockReturnValue({ embed: MOCK_EMBED, row: {} }),
    },
    settingsService: {
      getBranding: jest.fn().mockResolvedValue({
        communityName: 'Test Guild',
        communityLogoPath: null,
      }),
      getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
    },
    emojiService: {
      getRoleEmojiComponent: jest.fn().mockReturnValue(undefined),
      getClassEmojiComponent: jest.fn().mockReturnValue(undefined),
    },
    updateEmbedSignupCount: jest.fn().mockResolvedValue(undefined),
  } as unknown as SignupInteractionDeps;
}

/** Creates a minimal ButtonInteraction mock with editReply stubbed. */
export function createMockButtonInteraction(): ButtonInteraction {
  return {
    editReply: jest.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}
