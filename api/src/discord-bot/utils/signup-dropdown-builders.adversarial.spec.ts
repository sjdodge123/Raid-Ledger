/**
 * Adversarial tests for signup-dropdown-builders — edge cases not covered
 * by the dev's basic embed-presence tests.
 */
import { EmbedBuilder } from 'discord.js';
import {
  showCharacterSelect,
  showRoleSelect,
} from './signup-dropdown-builders';

function createMockInteraction() {
  return { editReply: jest.fn().mockResolvedValue(undefined) };
}

function createMockEmojiService() {
  return {
    getClassEmojiComponent: jest.fn(() => undefined),
    getRoleEmojiComponent: jest.fn(() => undefined),
  };
}

describe('showCharacterSelect — adversarial', () => {
  describe('customId construction', () => {
    it('builds customId without suffix when customIdSuffix is omitted', async () => {
      const interaction = createMockInteraction();

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 5,
        eventTitle: 'Test Event',
        characters: [{ id: 'c1', name: 'Thrall' }] as never[],
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      expect(menu.data.custom_id).toBe('char_select:5');
    });

    it('appends customIdSuffix to customId when provided', async () => {
      const interaction = createMockInteraction();

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 5,
        eventTitle: 'Test Event',
        characters: [{ id: 'c1', name: 'Thrall' }] as never[],
        emojiService: createMockEmojiService() as never,
        customIdSuffix: 'tentative',
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      expect(menu.data.custom_id).toBe('char_select:5:tentative');
    });
  });

  describe('character options', () => {
    it('limits options to 25 characters even when more are provided', async () => {
      const interaction = createMockInteraction();
      const characters = Array.from({ length: 30 }, (_, i) => ({
        id: `c${i}`,
        name: `Char${i}`,
      }));

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 1,
        eventTitle: 'Raid',
        characters: characters as never[],
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      expect(menu.options).toHaveLength(25);
    });

    it('marks the main character as default when multiple characters exist', async () => {
      const interaction = createMockInteraction();
      const characters = [
        { id: 'c1', name: 'Alt', isMain: false },
        { id: 'c2', name: 'Main', isMain: true },
      ];

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 1,
        eventTitle: 'Raid',
        characters: characters as never[],
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      const options = menu.options.map((o: { toJSON: () => { value: string; default: boolean } }) => o.toJSON());
      const altOpt = options.find((o: { value: string }) => o.value === 'c1');
      const mainOpt = options.find((o: { value: string }) => o.value === 'c2');
      expect(altOpt?.default).toBe(false);
      expect(mainOpt?.default).toBe(true);
    });

    it('does not set any character as default when only one character exists', async () => {
      const interaction = createMockInteraction();

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 1,
        eventTitle: 'Raid',
        characters: [{ id: 'c1', name: 'Solo', isMain: true }] as never[],
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      const options = menu.options.map((o: { toJSON: () => { default: boolean } }) => o.toJSON());
      expect(options[0].default).toBe(false);
    });

    it('includes class and spec in description when present', async () => {
      const interaction = createMockInteraction();
      const characters = [{ id: 'c1', name: 'Thrall', class: 'Shaman', spec: 'Enhancement' }];

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 1,
        eventTitle: 'Raid',
        characters: characters as never[],
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      const options = menu.options.map((o: { toJSON: () => { description: string } }) => o.toJSON());
      expect(options[0].description).toContain('Shaman (Enhancement)');
    });

    it('includes level in description when present', async () => {
      const interaction = createMockInteraction();
      const characters = [{ id: 'c1', name: 'Thrall', level: 60 }];

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 1,
        eventTitle: 'Raid',
        characters: characters as never[],
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      const options = menu.options.map((o: { toJSON: () => { description: string } }) => o.toJSON());
      expect(options[0].description).toContain('Level 60');
    });
  });

  describe('content text', () => {
    it('includes event title in the content text', async () => {
      const interaction = createMockInteraction();

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 1,
        eventTitle: 'Dragon Keep Raid',
        characters: [{ id: 'c1', name: 'Hero' }] as never[],
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      expect(call.content).toContain('Dragon Keep Raid');
    });
  });

  describe('embed passthrough', () => {
    it('passes embed through as an array element', async () => {
      const interaction = createMockInteraction();
      const embed = new EmbedBuilder().setTitle('Roster');

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 1,
        eventTitle: 'Raid',
        characters: [{ id: 'c1', name: 'Hero' }] as never[],
        emojiService: createMockEmojiService() as never,
        embed,
      });

      const call = interaction.editReply.mock.calls[0][0];
      expect(call.embeds).toHaveLength(1);
      expect(call.embeds[0]).toBe(embed);
    });

    it('does not include a null embed as a value', async () => {
      const interaction = createMockInteraction();

      await showCharacterSelect(interaction as never, {
        customIdPrefix: 'char_select',
        eventId: 1,
        eventTitle: 'Raid',
        characters: [{ id: 'c1', name: 'Hero' }] as never[],
        emojiService: createMockEmojiService() as never,
        embed: undefined,
      });

      const call = interaction.editReply.mock.calls[0][0];
      expect(call.embeds).toEqual([]);
    });
  });
});

describe('showRoleSelect — adversarial', () => {
  describe('customId construction', () => {
    it('builds customId without characterId when omitted', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 3,
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      expect(menu.data.custom_id).toBe('role_select:3');
    });

    it('includes characterId segment when provided', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 3,
        emojiService: createMockEmojiService() as never,
        characterId: 'char-abc',
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      expect(menu.data.custom_id).toBe('role_select:3:char-abc');
    });

    it('appends customIdSuffix after characterId when both provided', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 3,
        emojiService: createMockEmojiService() as never,
        characterId: 'char-abc',
        customIdSuffix: 'tentative',
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      expect(menu.data.custom_id).toBe('role_select:3:char-abc:tentative');
    });

    it('appends customIdSuffix when no characterId', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 3,
        emojiService: createMockEmojiService() as never,
        customIdSuffix: 'tentative',
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      expect(menu.data.custom_id).toBe('role_select:3:tentative');
    });
  });

  describe('content text', () => {
    it('shows character name in content when characterInfo is provided', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 1,
        emojiService: createMockEmojiService() as never,
        characterInfo: { name: 'Thrall', role: null },
      });

      const call = interaction.editReply.mock.calls[0][0];
      expect(call.content).toContain('Thrall');
    });

    it('shows current role hint when characterInfo.role is set', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 1,
        emojiService: createMockEmojiService() as never,
        characterInfo: { name: 'Thrall', role: 'healer' },
      });

      const call = interaction.editReply.mock.calls[0][0];
      expect(call.content).toContain('current: healer');
    });

    it('shows generic prompt when no characterInfo', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 1,
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      expect(call.content).toContain("Select your preferred role(s)");
    });

    it('uses custom characterVerb when provided', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 1,
        emojiService: createMockEmojiService() as never,
        characterInfo: { name: 'Thrall', role: null },
        characterVerb: 'Going tentative as',
      });

      const call = interaction.editReply.mock.calls[0][0];
      expect(call.content).toContain('Going tentative as');
    });
  });

  describe('role options', () => {
    it('always includes tank, healer, and dps options', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 1,
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      const values = menu.options.map((o: { toJSON: () => { value: string } }) => o.toJSON().value);
      expect(values).toEqual(expect.arrayContaining(['tank', 'healer', 'dps']));
      expect(values).toHaveLength(3);
    });

    it('sets minValues=1 and maxValues=3 on the select menu', async () => {
      const interaction = createMockInteraction();

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 1,
        emojiService: createMockEmojiService() as never,
      });

      const call = interaction.editReply.mock.calls[0][0];
      const menu = call.components[0].components[0];
      expect(menu.data.min_values).toBe(1);
      expect(menu.data.max_values).toBe(3);
    });
  });

  describe('embed passthrough', () => {
    it('passes embed through as a single-element array', async () => {
      const interaction = createMockInteraction();
      const embed = new EmbedBuilder().setTitle('Roster');

      await showRoleSelect(interaction as never, {
        customIdPrefix: 'role_select',
        eventId: 1,
        emojiService: createMockEmojiService() as never,
        embed,
      });

      const call = interaction.editReply.mock.calls[0][0];
      expect(call.embeds).toHaveLength(1);
      expect(call.embeds[0]).toBe(embed);
    });
  });
});
