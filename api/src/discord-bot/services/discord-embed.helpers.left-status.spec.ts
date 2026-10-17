/**
 * Tests for left-participant rendering in ad-hoc embed rosters (ROK-680).
 *
 * Verifies that participants with status 'left' are rendered with
 * strikethrough formatting in the roster list. ROK-1460 moved the roster from
 * `<@id>` mentions to bold display names; the strikethrough marker survives
 * that move and now wraps the bold name.
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
  it('renders active participant name without strikethrough', () => {
    const result = getMentionsForRole(
      [makeMention('user-1', 'signed_up')],
      null,
      mockEmojiService,
    );
    expect(result).toContain('**user-user-1**');
    expect(result).not.toContain('~~');
  });

  it('renders left participant name with strikethrough', () => {
    const result = getMentionsForRole(
      [makeMention('user-2', 'left')],
      null,
      mockEmojiService,
    );
    expect(result).toContain('~~**user-user-2**~~');
  });

  it('renders mix of active and left participants correctly', () => {
    const mentions = [
      makeMention('active-1', 'signed_up'),
      makeMention('left-1', 'left'),
      makeMention('active-2', null),
    ];
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    expect(result).toContain('**user-active-1**');
    expect(result).not.toMatch(/~~\*\*user-active-1\*\*~~/);
    expect(result).toContain('~~**user-left-1**~~');
    expect(result).toContain('**user-active-2**');
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
    expect(result).toContain('~~**departed-user**~~');
  });

  it('renders all names with strikethrough when every participant left (ROK-1243)', () => {
    const mentions = [
      makeMention('left-1', 'left'),
      makeMention('left-2', 'left'),
      makeMention('left-3', 'left'),
    ];
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    expect(result).toContain('~~**user-left-1**~~');
    expect(result).toContain('~~**user-left-2**~~');
    expect(result).toContain('~~**user-left-3**~~');
    // No un-struck name must remain in the rendered output.
    const unstruck = /(?<!~~)\*\*user-left-[123]\*\*(?!~~)/g;
    expect(result.match(unstruck)).toBeNull();
  });
});
