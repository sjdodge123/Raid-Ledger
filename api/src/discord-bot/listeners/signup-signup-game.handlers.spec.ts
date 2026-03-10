import { tryGameSignupFlow } from './signup-signup-game.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import type { ButtonInteraction } from 'discord.js';

/**
 * Creates minimal mock deps for testing signup-game handlers.
 * Only stubs the methods used by the single-character signup path.
 */
function createMockDeps(): SignupInteractionDeps {
  return {
    db: { select: jest.fn() } as unknown as SignupInteractionDeps['db'],
    logger: { error: jest.fn() } as unknown as SignupInteractionDeps['logger'],
    signupsService: {
      signup: jest.fn().mockResolvedValue({ id: 1, assignedSlot: 'dps' }),
      confirmSignup: jest.fn().mockResolvedValue(undefined),
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

const MOCK_EVENT = {
  id: 10,
  title: 'Raid Night',
  gameId: 1,
  slotConfig: { type: 'generic' },
} as Parameters<typeof tryGameSignupFlow>[0]['event'];

const MOCK_USER = {
  id: 42,
} as Parameters<typeof tryGameSignupFlow>[0]['linkedUser'];

describe('tryGameSignupFlow — single character path (ROK-775)', () => {
  it('passes preferredRoles from character role to signup', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();
    const char = {
      id: 'char-uuid-1',
      name: 'TestChar',
      role: 'healer' as const,
      roleOverride: null,
    };

    // Game lookup returns a game
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ id: 1, hasRoles: true }]),
        }),
      }),
    });
    // Single character for user
    (deps.charactersService.findAllForUser as jest.Mock).mockResolvedValue({
      data: [char],
    });

    await tryGameSignupFlow({
      interaction,
      eventId: 10,
      linkedUser: MOCK_USER,
      event: MOCK_EVENT,
      deps,
    });

    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42, {
      preferredRoles: ['healer'],
    });
  });

  it('passes roleOverride over role when set', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();
    const char = {
      id: 'char-uuid-2',
      name: 'TankChar',
      role: 'dps' as const,
      roleOverride: 'tank' as const,
    };

    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ id: 1, hasRoles: true }]),
        }),
      }),
    });
    (deps.charactersService.findAllForUser as jest.Mock).mockResolvedValue({
      data: [char],
    });

    await tryGameSignupFlow({
      interaction,
      eventId: 10,
      linkedUser: MOCK_USER,
      event: MOCK_EVENT,
      deps,
    });

    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42, {
      preferredRoles: ['tank'],
    });
  });

  it('omits preferredRoles when character has no role', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();
    const char = {
      id: 'char-uuid-3',
      name: 'NoRoleChar',
      role: null,
      roleOverride: null,
    };

    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ id: 1, hasRoles: true }]),
        }),
      }),
    });
    (deps.charactersService.findAllForUser as jest.Mock).mockResolvedValue({
      data: [char],
    });

    await tryGameSignupFlow({
      interaction,
      eventId: 10,
      linkedUser: MOCK_USER,
      event: MOCK_EVENT,
      deps,
    });

    // Should be called without a dto (or with undefined preferredRoles)
    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42);
  });
});

describe('tryGameSignupFlow — adversarial edge cases (ROK-775)', () => {
  function setupSingleCharFlow(
    deps: SignupInteractionDeps,
    char: Record<string, unknown>,
  ): void {
    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ id: 1, hasRoles: true }]),
        }),
      }),
    });
    (deps.charactersService.findAllForUser as jest.Mock).mockResolvedValue({
      data: [char],
    });
  }

  it('uses roleOverride when role is null', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();
    const char = {
      id: 'edge-1',
      name: 'NullRoleChar',
      role: null,
      roleOverride: 'tank' as const,
    };
    setupSingleCharFlow(deps, char);

    await tryGameSignupFlow({
      interaction,
      eventId: 10,
      linkedUser: MOCK_USER,
      event: MOCK_EVENT,
      deps,
    });

    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42, {
      preferredRoles: ['tank'],
    });
  });

  it('confirms signup with character id after signup', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();
    const char = {
      id: 'edge-2',
      name: 'ConfirmChar',
      role: 'healer' as const,
      roleOverride: null,
    };
    setupSingleCharFlow(deps, char);

    await tryGameSignupFlow({
      interaction,
      eventId: 10,
      linkedUser: MOCK_USER,
      event: MOCK_EVENT,
      deps,
    });

    expect(deps.signupsService.confirmSignup).toHaveBeenCalledWith(
      10,
      1,
      42,
      { characterId: 'edge-2' },
    );
  });

  it('does not pass preferredRoles for no-character signup', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();

    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ id: 1, hasRoles: true }]),
        }),
      }),
    });
    (deps.charactersService.findAllForUser as jest.Mock).mockResolvedValue({
      data: [],
    });

    await tryGameSignupFlow({
      interaction,
      eventId: 10,
      linkedUser: MOCK_USER,
      event: MOCK_EVENT,
      deps,
    });

    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42);
  });

  it('returns false when game is not found', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();

    (deps.db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await tryGameSignupFlow({
      interaction,
      eventId: 10,
      linkedUser: MOCK_USER,
      event: MOCK_EVENT,
      deps,
    });

    expect(result).toBe(false);
    expect(deps.signupsService.signup).not.toHaveBeenCalled();
  });

  it('updates embed signup count after single char signup', async () => {
    const deps = createMockDeps();
    const interaction = createMockInteraction();
    const char = {
      id: 'edge-3',
      name: 'CountChar',
      role: 'dps' as const,
      roleOverride: null,
    };
    setupSingleCharFlow(deps, char);

    await tryGameSignupFlow({
      interaction,
      eventId: 10,
      linkedUser: MOCK_USER,
      event: MOCK_EVENT,
      deps,
    });

    expect(deps.updateEmbedSignupCount).toHaveBeenCalledWith(10);
  });
});
