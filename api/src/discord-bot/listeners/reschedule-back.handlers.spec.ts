/**
 * Back button on the reschedule role step (ROK-2228).
 */
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  handleRescheduleCharacterBack,
  routeRescheduleBack,
} from './reschedule-back.handlers';
import { showRescheduleRoleForCharacter } from './reschedule-role-step.helpers';
import type { EventRow, RescheduleDeps } from './reschedule-response.helpers';

type SentRow = { components: Array<{ custom_id?: string; label?: string }> };

function selectChain(rows: unknown[]): unknown {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

const EVENT: EventRow = {
  id: 7,
  title: 'Moved Raid',
  cancelledAt: null,
  gameId: 3,
  slotConfig: { type: 'mmo' },
} as EventRow;

function mockDeps(): RescheduleDeps {
  return {
    db: { select: jest.fn() },
    logger: { error: jest.fn() },
    charactersService: {
      findOne: jest.fn().mockResolvedValue({ name: 'Thrall', role: 'tank' }),
      findAllForUser: jest.fn().mockResolvedValue({
        data: [
          { id: 'c1', name: 'Thrall' },
          { id: 'c2', name: 'Jaina' },
        ],
      }),
    },
    emojiService: {
      getRoleEmojiComponent: jest.fn().mockReturnValue(undefined),
      getClassEmojiComponent: jest.fn().mockReturnValue(undefined),
    },
  } as unknown as RescheduleDeps;
}

function interaction(customId = ''): ButtonInteraction {
  return {
    customId,
    user: { id: 'discord-1' },
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

function sentRows(i: { editReply: unknown }): SentRow[] {
  const call = (i.editReply as jest.Mock).mock.calls[0][0] as {
    content: string;
    components: Array<{ toJSON(): SentRow }>;
  };
  return call.components.map((row) => row.toJSON());
}

describe('showRescheduleRoleForCharacter — Back (ROK-2228)', () => {
  it.each([
    [undefined, 'char_back:reschedule_char_select:7'],
    ['tentative' as const, 'char_back:reschedule_char_select:7:tentative'],
  ])('with status %s offers Back as %s', async (status, backId) => {
    const i = interaction();
    await showRescheduleRoleForCharacter(
      mockDeps(),
      i as unknown as StringSelectMenuInteraction,
      EVENT,
      { id: 42 },
      'c1',
      status,
    );
    expect(sentRows(i)[1]?.components).toEqual([
      expect.objectContaining({ label: 'Back', custom_id: backId }),
    ]);
  });
});

describe('routeRescheduleBack (ROK-2228)', () => {
  it.each(['reschedule_confirm:7', 'char_back:char_select:7'])(
    'leaves %s to other handlers',
    (customId) => {
      expect(routeRescheduleBack(interaction(customId), mockDeps())).toBe(
        false,
      );
    },
  );
});

describe('handleRescheduleCharacterBack (ROK-2228)', () => {
  it('claims a Back to the reschedule character list', () => {
    const deps = mockDeps();
    (deps.db.select as jest.Mock).mockReturnValue(selectChain([]));
    const i = interaction('char_back:reschedule_char_select:7:tentative');

    expect(routeRescheduleBack(i, deps)).toBe(true);
    expect(i.deferUpdate).toHaveBeenCalled();
  });

  it('rebuilds the list via the same character query', async () => {
    const deps = mockDeps();
    (deps.db.select as jest.Mock)
      .mockReturnValueOnce(selectChain([{ id: 42 }]))
      .mockReturnValueOnce(selectChain([EVENT]))
      .mockReturnValueOnce(selectChain([{ id: 3 }]));
    const i = interaction();

    await handleRescheduleCharacterBack(
      i,
      {
        charSelectPrefix: 'reschedule_char_select',
        eventId: 7,
        suffix: 'tentative',
      },
      deps,
    );

    expect(deps.charactersService.findAllForUser).toHaveBeenCalledWith(42, 3);
    const rows = sentRows(i);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.components[0]?.custom_id).toBe(
      'reschedule_char_select:7:tentative',
    );
  });

  it('stops quietly when the interaction has expired (10062)', async () => {
    const deps = mockDeps();
    const i = interaction();
    (i.deferUpdate as jest.Mock).mockRejectedValue({ code: 10062 });

    await handleRescheduleCharacterBack(
      i,
      { charSelectPrefix: 'reschedule_char_select', eventId: 7 },
      deps,
    );

    expect(i.editReply).not.toHaveBeenCalled();
    expect(deps.db.select).not.toHaveBeenCalled();
  });
});
