import { EmbedBuilder } from 'discord.js';
import {
  showCharacterSelect,
  showRoleSelect,
} from './signup-dropdown-builders';

function createMockInteraction() {
  return {
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockEmojiService() {
  return {
    getClassEmojiComponent: jest.fn(() => undefined),
    getRoleEmojiComponent: jest.fn(() => undefined),
  };
}

describe('showCharacterSelect', () => {
  it('includes embed in editReply when provided', async () => {
    const interaction = createMockInteraction();
    const embed = new EmbedBuilder().setTitle('Event Roster');

    await showCharacterSelect(interaction as never, {
      customIdPrefix: 'char_select',
      eventId: 1,
      eventTitle: 'Raid Night',
      characters: [{ id: 'c1', name: 'Thrall' }] as never[],
      emojiService: createMockEmojiService() as never,
      embed,
    });

    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds).toEqual([embed]);
  });

  it('sends empty embeds array when embed is not provided', async () => {
    const interaction = createMockInteraction();

    await showCharacterSelect(interaction as never, {
      customIdPrefix: 'char_select',
      eventId: 1,
      eventTitle: 'Raid Night',
      characters: [{ id: 'c1', name: 'Thrall' }] as never[],
      emojiService: createMockEmojiService() as never,
    });

    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds).toEqual([]);
  });
});

describe('showRoleSelect', () => {
  it('includes embed in editReply when provided', async () => {
    const interaction = createMockInteraction();
    const embed = new EmbedBuilder().setTitle('Event Roster');

    await showRoleSelect(interaction as never, {
      customIdPrefix: 'role_select',
      eventId: 1,
      emojiService: createMockEmojiService() as never,
      embed,
    });

    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds).toEqual([embed]);
  });

  it('sends empty embeds array when embed is not provided', async () => {
    const interaction = createMockInteraction();

    await showRoleSelect(interaction as never, {
      customIdPrefix: 'role_select',
      eventId: 1,
      emojiService: createMockEmojiService() as never,
    });

    const call = interaction.editReply.mock.calls[0][0];
    expect(call.embeds).toEqual([]);
  });
});

describe('showRoleSelect — Back button (ROK-2228)', () => {
  const BACK_ID = 'char_back:char_select:1:tentative';

  /** The JSON of every action row sent in the first editReply. */
  function sentRows(
    interaction: ReturnType<typeof createMockInteraction>,
  ): Array<{ components: Array<Record<string, unknown>> }> {
    const call = interaction.editReply.mock.calls[0][0] as {
      components: Array<{ toJSON(): unknown }>;
    };
    return call.components.map(
      (row) => row.toJSON() as { components: Array<Record<string, unknown>> },
    );
  }

  it('renders a secondary Back button in its own row after a character pick', async () => {
    const interaction = createMockInteraction();

    await showRoleSelect(interaction as never, {
      customIdPrefix: 'role_select',
      eventId: 1,
      emojiService: createMockEmojiService() as never,
      characterId: 'c1',
      characterInfo: { name: 'Thrall', role: null },
      backCustomId: BACK_ID,
    });

    const rows = sentRows(interaction);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.components).toEqual([
      expect.objectContaining({
        type: 2,
        style: 2,
        label: 'Back',
        custom_id: BACK_ID,
      }),
    ]);
  });

  it('renders no Back button when no character was picked', async () => {
    const interaction = createMockInteraction();

    await showRoleSelect(interaction as never, {
      customIdPrefix: 'role_select',
      eventId: 1,
      emojiService: createMockEmojiService() as never,
      backCustomId: BACK_ID,
    });

    expect(sentRows(interaction)).toHaveLength(1);
  });

  it('renders no Back button when the flow did not come through a character list', async () => {
    const interaction = createMockInteraction();

    await showRoleSelect(interaction as never, {
      customIdPrefix: 'role_select',
      eventId: 1,
      emojiService: createMockEmojiService() as never,
      characterId: 'c1',
      characterInfo: { name: 'Thrall', role: null },
    });

    expect(sentRows(interaction)).toHaveLength(1);
  });
});
