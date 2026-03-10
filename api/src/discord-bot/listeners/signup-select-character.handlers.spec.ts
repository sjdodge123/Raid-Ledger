/**
 * Tests for signupWithCharacterDirect passing preferredRoles (ROK-775).
 *
 * We test via the exported handleCharacterSelectMenu which eventually calls
 * signupWithCharacterDirect for non-MMO events.
 */
import { handleCharacterSelectMenu } from './signup-select-character.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import type { StringSelectMenuInteraction } from 'discord.js';

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
      findOne: jest.fn(),
    } as unknown as SignupInteractionDeps['charactersService'],
    updateEmbedSignupCount: jest.fn().mockResolvedValue(undefined),
  } as unknown as SignupInteractionDeps;
}

describe('handleCharacterSelectMenu — non-MMO (ROK-775)', () => {
  it('passes preferredRoles derived from character', async () => {
    const deps = createMockDeps();
    const charId = 'char-uuid-1';
    const interaction = {
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      values: [charId],
      user: { id: 'discord-123' },
      editReply: jest.fn().mockResolvedValue(undefined),
    } as unknown as StringSelectMenuInteraction;

    // 1st select: findLinkedUser
    // 2nd select: tryMmoRoleRedirect (event lookup)
    const linkedUser = { id: 42, discordId: 'discord-123' };
    const event = {
      id: 10,
      slotConfig: { type: 'generic' },
    };
    (deps.db.select as jest.Mock)
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([linkedUser]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([event]),
          }),
        }),
      });

    // findOne returns the character after signup
    const character = {
      id: charId,
      name: 'MyWarrior',
      role: 'tank' as const,
      roleOverride: null,
    };
    (deps.charactersService.findOne as jest.Mock).mockResolvedValue(character);

    await handleCharacterSelectMenu(interaction, 10, deps);

    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42, {
      preferredRoles: ['tank'],
    });
  });

  it('uses roleOverride when available', async () => {
    const deps = createMockDeps();
    const charId = 'char-uuid-2';
    const interaction = {
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      values: [charId],
      user: { id: 'discord-456' },
      editReply: jest.fn().mockResolvedValue(undefined),
    } as unknown as StringSelectMenuInteraction;

    const linkedUser = { id: 43, discordId: 'discord-456' };
    const event = { id: 11, slotConfig: { type: 'generic' } };
    (deps.db.select as jest.Mock)
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([linkedUser]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([event]),
          }),
        }),
      });

    const character = {
      id: charId,
      name: 'MyPaladin',
      role: 'dps' as const,
      roleOverride: 'healer' as const,
    };
    (deps.charactersService.findOne as jest.Mock).mockResolvedValue(character);

    await handleCharacterSelectMenu(interaction, 11, deps);

    expect(deps.signupsService.signup).toHaveBeenCalledWith(11, 43, {
      preferredRoles: ['healer'],
    });
  });
});

describe('handleCharacterSelectMenu — adversarial edge cases (ROK-775)', () => {
  function setupNonMmoFlow(
    deps: SignupInteractionDeps,
    linkedUser: Record<string, unknown>,
    event: Record<string, unknown>,
  ): void {
    (deps.db.select as jest.Mock)
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([linkedUser]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([event]),
          }),
        }),
      });
  }

  it('omits preferredRoles when character has no role', async () => {
    const deps = createMockDeps();
    const charId = 'null-role-char';
    const interaction = {
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      values: [charId],
      user: { id: 'discord-789' },
      editReply: jest.fn().mockResolvedValue(undefined),
    } as unknown as StringSelectMenuInteraction;

    setupNonMmoFlow(
      deps,
      { id: 50, discordId: 'discord-789' },
      { id: 10, slotConfig: { type: 'generic' } },
    );

    (deps.charactersService.findOne as jest.Mock).mockResolvedValue({
      id: charId,
      name: 'NullRoleChar',
      role: null,
      roleOverride: null,
    });

    await handleCharacterSelectMenu(interaction, 10, deps);

    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 50);
  });

  it('passes preferredRoles in tentative mode', async () => {
    const deps = createMockDeps();
    const charId = 'tent-char';
    const interaction = {
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      values: [charId],
      user: { id: 'discord-tent' },
      editReply: jest.fn().mockResolvedValue(undefined),
    } as unknown as StringSelectMenuInteraction;

    setupNonMmoFlow(
      deps,
      { id: 55, discordId: 'discord-tent' },
      { id: 20, slotConfig: { type: 'generic' } },
    );

    (deps.charactersService.findOne as jest.Mock).mockResolvedValue({
      id: charId,
      name: 'TentativeChar',
      role: 'tank' as const,
      roleOverride: null,
    });

    await handleCharacterSelectMenu(interaction, 20, deps, 'tentative');

    expect(deps.signupsService.signup).toHaveBeenCalledWith(20, 55, {
      preferredRoles: ['tank'],
    });
    expect(deps.signupsService.updateStatus).toHaveBeenCalledWith(
      20,
      { userId: 55 },
      { status: 'tentative' },
    );
  });

  it('uses roleOverride when role is null', async () => {
    const deps = createMockDeps();
    const charId = 'override-null-role';
    const interaction = {
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      values: [charId],
      user: { id: 'discord-ovr' },
      editReply: jest.fn().mockResolvedValue(undefined),
    } as unknown as StringSelectMenuInteraction;

    setupNonMmoFlow(
      deps,
      { id: 60, discordId: 'discord-ovr' },
      { id: 15, slotConfig: { type: 'generic' } },
    );

    (deps.charactersService.findOne as jest.Mock).mockResolvedValue({
      id: charId,
      name: 'OverrideNullRole',
      role: null,
      roleOverride: 'dps' as const,
    });

    await handleCharacterSelectMenu(interaction, 15, deps);

    expect(deps.signupsService.signup).toHaveBeenCalledWith(15, 60, {
      preferredRoles: ['dps'],
    });
  });

  it('updates embed signup count after character select', async () => {
    const deps = createMockDeps();
    const charId = 'count-char';
    const interaction = {
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      values: [charId],
      user: { id: 'discord-cnt' },
      editReply: jest.fn().mockResolvedValue(undefined),
    } as unknown as StringSelectMenuInteraction;

    setupNonMmoFlow(
      deps,
      { id: 70, discordId: 'discord-cnt' },
      { id: 30, slotConfig: { type: 'generic' } },
    );

    (deps.charactersService.findOne as jest.Mock).mockResolvedValue({
      id: charId,
      name: 'CountChar',
      role: 'healer' as const,
      roleOverride: null,
    });

    await handleCharacterSelectMenu(interaction, 30, deps);

    expect(deps.updateEmbedSignupCount).toHaveBeenCalledWith(30);
  });
});
