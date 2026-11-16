/**
 * Back button on the signup role step (ROK-2228).
 */
import type { ButtonInteraction } from 'discord.js';
import {
  handleSignupCharacterBack,
  routeSignupBack,
} from './signup-back.handlers';
import { createMockDeps } from './signup-handlers.spec-helpers';
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
    .mockReturnValueOnce(selectChain([{ id: 42 }]))
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
      .mockReturnValueOnce(selectChain([{ id: 42 }]))
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
