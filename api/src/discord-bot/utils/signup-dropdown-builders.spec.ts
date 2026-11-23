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

describe('character-import link button (ROK-2294)', () => {
  const IMPORT_URL =
    'https://raid.example.com/profile/gaming/characters?game=7';
  const IMPORT_BUTTON = {
    type: 2,
    style: 5,
    label: "Don't see your character? Import it",
    url: IMPORT_URL,
  };

  function rowsOf(
    interaction: ReturnType<typeof createMockInteraction>,
  ): Array<{ components: Array<Record<string, unknown>> }> {
    const call = interaction.editReply.mock.calls[0][0] as {
      components: Array<{ toJSON(): unknown }>;
    };
    return call.components.map(
      (row) => row.toJSON() as { components: Array<Record<string, unknown>> },
    );
  }

  const charOpts = {
    customIdPrefix: 'char_select',
    eventId: 1,
    eventTitle: 'Raid Night',
    characters: [{ id: 'c1', name: 'Thrall' }] as never[],
  };

  it('(a) adds a second row with the Link button when importUrl is set', async () => {
    const interaction = createMockInteraction();
    await showCharacterSelect(interaction as never, {
      ...charOpts,
      emojiService: createMockEmojiService() as never,
      importUrl: IMPORT_URL,
    });
    const rows = rowsOf(interaction);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.components).toEqual([IMPORT_BUTTON]);
  });

  it('(b) keeps the single select row when importUrl is absent', async () => {
    const interaction = createMockInteraction();
    await showCharacterSelect(interaction as never, {
      ...charOpts,
      emojiService: createMockEmojiService() as never,
    });
    const rows = rowsOf(interaction);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.components[0]).toEqual(
      expect.objectContaining({ type: 3, custom_id: 'char_select:1' }),
    );
  });

  it('(c) role select with Back + importUrl stays at 2 rows, both buttons in the Back row', async () => {
    const interaction = createMockInteraction();
    await showRoleSelect(interaction as never, {
      customIdPrefix: 'role_select',
      eventId: 1,
      emojiService: createMockEmojiService() as never,
      characterId: 'c1',
      characterInfo: { name: 'Thrall', role: null },
      backCustomId: 'char_back:char_select:1',
      importUrl: IMPORT_URL,
    });
    const rows = rowsOf(interaction);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.components).toEqual([
      expect.objectContaining({
        label: 'Back',
        custom_id: 'char_back:char_select:1',
      }),
      IMPORT_BUTTON,
    ]);
  });

  it('role select with no character + importUrl puts the Link button in its own row', async () => {
    const interaction = createMockInteraction();
    await showRoleSelect(interaction as never, {
      customIdPrefix: 'role_select',
      eventId: 1,
      emojiService: createMockEmojiService() as never,
      importUrl: IMPORT_URL,
    });
    const rows = rowsOf(interaction);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.components).toEqual([IMPORT_BUTTON]);
  });
});
