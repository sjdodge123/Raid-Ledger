/**
 * Tests for tentativeSingleCharacter passing preferredRoles (ROK-775).
 *
 * We test via the exported handleLinkedTentative which calls the private
 * tentativeSingleCharacter when conditions are met.
 */
import { handleLinkedTentative } from './signup-status-tentative.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import type { ButtonInteraction } from 'discord.js';

function createMockDeps(): SignupInteractionDeps {
  return {
    db: { select: jest.fn() } as unknown as SignupInteractionDeps['db'],
    logger: { error: jest.fn() } as unknown as SignupInteractionDeps['logger'],
    signupsService: {
      signup: jest.fn().mockResolvedValue({ id: 1, assignedSlot: 'dps' }),
      confirmSignup: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    } as unknown as SignupInteractionDeps['signupsService'],
    charactersService: {
      findAllForUser: jest.fn(),
    } as unknown as SignupInteractionDeps['charactersService'],
    updateEmbedSignupCount: jest.fn().mockResolvedValue(undefined),
  } as unknown as SignupInteractionDeps;
}

function createMockInteraction(): ButtonInteraction {
  return {
    editReply: jest.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

const MOCK_USER = {
  id: 42,
} as Parameters<typeof handleLinkedTentative>[2];

describe('handleLinkedTentative — single char path (ROK-775)', () => {
  it('passes preferredRoles from character to signup', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();

    // First select: fetchEvent
    const event = {
      id: 10,
      title: 'Raid',
      gameId: 1,
      slotConfig: { type: 'generic' },
    };
    // Second select: game lookup in loadTentativeGameContext
    const game = { id: 1, hasRoles: true };

    // Two sequential db.select calls
    (deps.db.select as jest.Mock)
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([event]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([game]),
          }),
        }),
      });

    const char = {
      id: 'char-1',
      name: 'MyChar',
      role: 'tank' as const,
      roleOverride: null,
    };
    (deps.charactersService.findAllForUser as jest.Mock).mockResolvedValue({
      data: [char],
    });

    await handleLinkedTentative(interaction, 10, MOCK_USER, deps);

    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42, {
      preferredRoles: ['tank'],
    });
  });

  it('uses roleOverride when set on the character', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();
    const event = {
      id: 10,
      title: 'Raid',
      gameId: 1,
      slotConfig: { type: 'generic' },
    };
    const game = { id: 1, hasRoles: true };

    (deps.db.select as jest.Mock)
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([event]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([game]),
          }),
        }),
      });

    const char = {
      id: 'char-2',
      name: 'OverrideChar',
      role: 'dps' as const,
      roleOverride: 'healer' as const,
    };
    (deps.charactersService.findAllForUser as jest.Mock).mockResolvedValue({
      data: [char],
    });

    await handleLinkedTentative(interaction, 10, MOCK_USER, deps);

    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42, {
      preferredRoles: ['healer'],
    });
  });
});
