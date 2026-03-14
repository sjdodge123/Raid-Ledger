/**
 * Tests for discord-embed.helpers.ts — formatMentionLine class icon handling (ROK-824).
 *
 * Verifies that getMentionsForRole correctly handles mentions with
 * and without class names (class icon rendering).
 */
import { getMentionsForRole } from './discord-embed.helpers';
import type { DiscordEmojiService } from './discord-emoji.service';

/** Mock emoji service that returns predictable emoji strings. */
function createMockEmojiService(): DiscordEmojiService {
  return {
    getRoleEmoji: jest.fn((role: string) => `[${role}]`),
    getClassEmoji: jest.fn((cls: string) => `{${cls}}`),
  } as unknown as DiscordEmojiService;
}

describe('getMentionsForRole — class icon handling (ROK-824)', () => {
  let emojiService: DiscordEmojiService;

  beforeEach(() => {
    emojiService = createMockEmojiService();
  });

  it('includes class emoji when className is present', () => {
    const mentions = [
      {
        discordId: '123',
        username: 'TestUser',
        role: 'dps',
        preferredRoles: ['dps'],
        status: 'signed_up',
        className: 'Rogue',
      },
    ];

    const result = getMentionsForRole(mentions, null, emojiService);
    expect(result).toContain('{Rogue}');
    expect(result).toContain('<@123>');
  });

  it('omits class emoji when className is null', () => {
    const mentions = [
      {
        discordId: '456',
        username: 'AnonUser',
        role: 'healer',
        preferredRoles: ['healer'],
        status: 'signed_up',
        className: null,
      },
    ];

    const result = getMentionsForRole(mentions, null, emojiService);
    expect(result).not.toContain('{');
    expect(result).toContain('<@456>');
  });

  it('handles mixed mentions — some with class, some without', () => {
    const mentions = [
      {
        discordId: '111',
        username: 'Player1',
        role: 'tank',
        preferredRoles: ['tank'],
        status: 'signed_up',
        className: 'Warrior',
      },
      {
        discordId: '222',
        username: 'Player2',
        role: 'healer',
        preferredRoles: ['healer'],
        status: 'signed_up',
        className: null,
      },
    ];

    const result = getMentionsForRole(mentions, null, emojiService);
    expect(result).toContain('{Warrior}');
    expect(result).toContain('<@111>');
    expect(result).toContain('<@222>');
    // Player2 has no class, so no class emoji for them
    const lines = result.split('\n');
    expect(lines[0]).toContain('{Warrior}');
    expect(lines[1]).not.toContain('{');
  });

  it('does not render broken embed when className is undefined', () => {
    const mentions = [
      {
        discordId: '789',
        username: 'NoClass',
        role: null,
        preferredRoles: null,
        status: 'signed_up',
        className: undefined as unknown as string | null,
      },
    ];

    const result = getMentionsForRole(mentions, null, emojiService);
    expect(result).toContain('<@789>');
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
  });

  it('filters by role when role parameter is provided', () => {
    const mentions = [
      {
        discordId: '111',
        username: 'Tank1',
        role: 'tank',
        preferredRoles: ['tank'],
        status: 'signed_up',
        className: 'Paladin',
      },
      {
        discordId: '222',
        username: 'Healer1',
        role: 'healer',
        preferredRoles: ['healer'],
        status: 'signed_up',
        className: 'Priest',
      },
    ];

    const result = getMentionsForRole(mentions, 'tank', emojiService);
    expect(result).toContain('{Paladin}');
    expect(result).not.toContain('{Priest}');
  });
});
