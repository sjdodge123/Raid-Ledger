/**
 * Back button on the signup role step (ROK-2228).
 */
import type { ButtonInteraction } from 'discord.js';
import {
  handleSignupCharacterBack,
  routeSignupBack,
} from './signup-back.handlers';
import { createMockDeps } from './signup-handlers.spec-helpers';
import { ACCOUNT_BLOCKED_REPLY } from '../../users/discord-account-status.helpers';
import type { SignupInteractionDeps } from './signup-interaction.types';

type SentRow = { components: Array<{ custom_id?: string }> };

function backInteraction(customId: string): ButtonInteraction {
  return {
    customId,
    user: { id: 'discord-1' },
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

function selectChain(rows: unknown[]): unknown {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

/** linked user → event → game, then the characters for that game. */
function seedCharacterList(deps: SignupInteractionDeps): void {
  (deps.db.select as jest.Mock)
    .mockReturnValueOnce(selectChain([{ id: 42, discordId: 'discord-1' }]))
    .mockReturnValueOnce(
      selectChain([
        { id: 10, title: 'Raid Night', gameId: 3, slotConfig: { type: 'mmo' } },
      ]),
    )
    .mockReturnValueOnce(selectChain([{ id: 3 }]));
  (deps.charactersService.findAllForUser as jest.Mock).mockResolvedValue({
    data: [
      { id: 'c1', name: 'Thrall' },
      { id: 'c2', name: 'Jaina' },
    ],
  });
}

function firstEdit(i: ButtonInteraction): {
  content: string;
  components: Array<{ toJSON(): SentRow }>;
} {
  return (i.editReply as jest.Mock).mock.calls[0][0];
}

/** Let the detached Back handler settle (it runs behind `void`). */
function flushDetached(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('routeSignupBack (ROK-2228)', () => {
  it.each([
    'signup:10',
    'char_select:10',
    'char_back:reschedule_char_select:10',
  ])('leaves %s to other handlers', (customId) => {
    expect(routeSignupBack(backInteraction(customId), createMockDeps())).toBe(
      false,
    );
  });

  it('claims a Back to the char_select list', () => {
    const deps = createMockDeps();
    seedCharacterList(deps);
    const interaction = backInteraction('char_back:char_select:10');

    expect(routeSignupBack(interaction, deps)).toBe(true);
    expect(interaction.deferUpdate).toHaveBeenCalled();
  });

  it('logs a non-expiry deferUpdate failure instead of rejecting', async () => {
    const deps = createMockDeps();
    const boom = new Error('500 Internal Server Error');
    const interaction = backInteraction('char_back:char_select:10');
    (interaction.deferUpdate as jest.Mock).mockRejectedValue(boom);

    expect(routeSignupBack(interaction, deps)).toBe(true);
    await flushDetached();

    expect(deps.logger.error).toHaveBeenCalledWith(
      'Signup character Back failed for event 10:',
      boom,
    );
  });
});

describe('handleSignupCharacterBack (ROK-2228)', () => {
  it.each([
    [undefined, 'char_select:10'],
    ['tentative', 'char_select:10:tentative'],
  ])(
    'with suffix %s re-renders the same character list as %s',
    async (suffix, expectedMenuId) => {
      const deps = createMockDeps();
      seedCharacterList(deps);
      const interaction = backInteraction('char_back:char_select:10');

      await handleSignupCharacterBack(
        interaction,
        { charSelectPrefix: 'char_select', eventId: 10, suffix },
        deps,
      );

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(deps.charactersService.findAllForUser).toHaveBeenCalledWith(42, 3);
      const edit = firstEdit(interaction);
      expect(edit.content).toBe('Pick a character for **Raid Night**');
      const rows = edit.components.map((row) => row.toJSON());
      expect(rows).toHaveLength(1);
      expect(rows[0]?.components[0]?.custom_id).toBe(expectedMenuId);
    },
  );

  it('stops quietly when the interaction has expired (10062)', async () => {
    const deps = createMockDeps();
    const interaction = backInteraction('char_back:char_select:10');
    (interaction.deferUpdate as jest.Mock).mockRejectedValue({ code: 10062 });

    await expect(
      handleSignupCharacterBack(
        interaction,
        { charSelectPrefix: 'char_select', eventId: 10 },
        deps,
      ),
    ).resolves.toBeUndefined();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(deps.db.select).not.toHaveBeenCalled();
  });

  it('says the event is gone when it no longer exists', async () => {
    const deps = createMockDeps();
    (deps.db.select as jest.Mock)
      .mockReturnValueOnce(selectChain([{ id: 42, discordId: 'discord-1' }]))
      .mockReturnValueOnce(selectChain([]));
    const interaction = backInteraction('char_back:char_select:10');

    await handleSignupCharacterBack(
      interaction,
      { charSelectPrefix: 'char_select', eventId: 10 },
      deps,
    );

    expect(firstEdit(interaction).content).toBe('Event not found.');
  });
});

describe('handleSignupCharacterBack — blocked account (ROK-2298, A8)', () => {
  it('replies the blocked copy and renders no character list', async () => {
    const deps = createMockDeps();
    (deps.db.select as jest.Mock).mockReturnValueOnce(
      selectChain([
        {
          id: 42,
          discordId: 'discord-1',
          bannedAt: new Date(),
          deactivatedAt: null,
        },
      ]),
    );
    const interaction = backInteraction('char_back:char_select:10');
    // discord.js flips `deferred` on deferUpdate; the helper reads it.
    Object.assign(interaction, { deferred: false });
    (interaction.deferUpdate as jest.Mock).mockImplementation(() => {
      Object.assign(interaction, { deferred: true });
      return Promise.resolve(undefined);
    });

    await handleSignupCharacterBack(
      interaction,
      { charSelectPrefix: 'char_select', eventId: 10 },
      deps,
    );

    expect(firstEdit(interaction).content).toBe(ACCOUNT_BLOCKED_REPLY);
    expect(deps.charactersService.findAllForUser).not.toHaveBeenCalled();
  });
});

describe('handleSignupCharacterBack — import link (ROK-2294)', () => {
  it('re-renders the import Link row for the event game when a trusted URL is set', async () => {
    const deps = createMockDeps();
    seedCharacterList(deps);
    (deps.settingsService.getTrustedClientUrl as jest.Mock).mockResolvedValue(
      'https://raid.example',
    );
    const interaction = backInteraction('char_back:char_select:10');

    await handleSignupCharacterBack(
      interaction,
      { charSelectPrefix: 'char_select', eventId: 10 },
      deps,
    );

    const rows: unknown[] = firstEdit(interaction).components.map((row) =>
      row.toJSON(),
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: "Don't see your character? Import it",
          url: 'https://raid.example/profile/gaming/characters?game=3',
        },
      ],
    });
  });
});
