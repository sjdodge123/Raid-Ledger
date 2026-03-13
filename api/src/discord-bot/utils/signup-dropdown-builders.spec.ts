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
