/**
 * Tests for left-participant rendering in ad-hoc embed mentions (ROK-680).
 *
 * Verifies that participants with status 'left' are rendered with
 * strikethrough formatting in the mention list.
 */
import { getMentionsForRole } from './discord-embed.helpers';
import type { DiscordEmojiService } from './discord-emoji.service';

const mockEmojiService = {
  getRoleEmoji: jest.fn(() => ''),
  getClassEmoji: jest.fn(() => ''),
} as unknown as DiscordEmojiService;

function makeMention(discordId: string, status: string | null = 'signed_up') {
  return {
    discordId,
    username: `user-${discordId}`,
    role: null,
    preferredRoles: null,
    status,
  };
}

describe('getMentionsForRole — left participant strikethrough (ROK-680)', () => {
  it('renders active participant mention without strikethrough', () => {
    const result = getMentionsForRole(
      [makeMention('user-1', 'signed_up')],
      null,
      mockEmojiService,
    );
    expect(result).toContain('<@user-1>');
    expect(result).not.toContain('~~');
  });

  it('renders left participant mention with strikethrough', () => {
    const result = getMentionsForRole(
      [makeMention('user-2', 'left')],
      null,
      mockEmojiService,
    );
    expect(result).toContain('~~<@user-2>~~');
  });

  it('renders mix of active and left participants correctly', () => {
    const mentions = [
      makeMention('active-1', 'signed_up'),
      makeMention('left-1', 'left'),
      makeMention('active-2', null),
    ];
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    expect(result).toContain('<@active-1>');
    expect(result).not.toMatch(/<@active-1>.*~~/);
    expect(result).toContain('~~<@left-1>~~');
    expect(result).toContain('<@active-2>');
  });

  it('applies strikethrough to username fallback for left participants', () => {
    const mention = {
      discordId: null,
      username: 'departed-user',
      role: null,
      preferredRoles: null,
      status: 'left',
    };
    const result = getMentionsForRole([mention], null, mockEmojiService);
    expect(result).toContain('~~departed-user~~');
  });
});
