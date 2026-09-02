/**
 * Adversarial tests for left-participant roster rendering (ROK-680).
 *
 * Preserved verbatim from `discord-embed.helpers.left-status.adversarial.spec.ts`,
 * whose two ad-hoc describe blocks were deleted with their subjects in ROK-1459.
 * `getMentionsForRole` survives, so its coverage survives with it.
 *
 * Covers edge cases not handled by the dev-written left-status tests:
 * - left status with class emoji and role emojis
 * - left status combined with tentative (mutually exclusive in practice)
 * - left status at the ROSTER_NAME_CAP boundary (6th participant)
 * - left participants beyond truncation threshold
 * - all participants left (none active)
 * - left with "???" fallback (null discordId + null username)
 *
 * ROK-1460 moved the roster from `<@id>` mentions to bold display names and
 * lowered the cap from 25 to `ROSTER_NAME_CAP`; every assertion below is the
 * same signal re-anchored on the name shape.
 */
import { ROSTER_NAME_CAP } from '../embeds/embed-roster.helpers';
import { getMentionsForRole } from './discord-embed.helpers';
import type { DiscordEmojiService } from './discord-emoji.service';

const UNICODE_ROLES: Record<string, string> = {
  tank: '\uD83D\uDEE1\uFE0F',
  healer: '\uD83D\uDC9A',
  dps: '\u2694\uFE0F',
};

const mockEmojiService = {
  getRoleEmoji: jest.fn((role: string) => UNICODE_ROLES[role] ?? ''),
  getClassEmoji: jest.fn(() => '\uD83E\uDDD9'),
} as unknown as DiscordEmojiService;

function makeMention(
  discordId: string | null,
  status: string | null = null,
  overrides: Record<string, unknown> = {},
) {
  return {
    discordId,
    username: discordId ? `user-${discordId}` : null,
    role: null as string | null,
    preferredRoles: null as string[] | null,
    status,
    ...overrides,
  };
}

// ─── getMentionsForRole — left status edge cases ────────────

describe('getMentionsForRole — left status adversarial (ROK-680)', () => {
  it('applies strikethrough with class emoji for left participant', () => {
    const mention = makeMention('u1', 'left', { className: 'Mage' });
    const result = getMentionsForRole([mention], null, mockEmojiService);
    expect(result).toContain('~~**user-u1**~~');
    expect(result).toContain('\uD83E\uDDD9');
  });

  it('applies strikethrough with role emojis for left participant', () => {
    const mention = makeMention('u1', 'left', {
      preferredRoles: ['tank', 'healer'],
    });
    const result = getMentionsForRole([mention], null, mockEmojiService);
    expect(result).toContain('~~**user-u1**~~');
    expect(result).toContain('\uD83D\uDEE1\uFE0F');
    expect(result).toContain('\uD83D\uDC9A');
  });

  it('left status takes precedence over tentative prefix', () => {
    // In practice these should be mutually exclusive, but test the
    // implementation handles the case gracefully
    const mention = makeMention('u1', 'left');
    const result = getMentionsForRole([mention], null, mockEmojiService);
    expect(result).toContain('~~**user-u1**~~');
    // Left should have strikethrough, NOT hourglass prefix
    expect(result).not.toContain('\u23F3');
  });

  it('applies strikethrough to "???" fallback for left participant', () => {
    const mention = {
      discordId: null,
      username: null,
      role: null,
      preferredRoles: null,
      status: 'left',
    };
    const result = getMentionsForRole([mention], null, mockEmojiService);
    expect(result).toContain('~~**???**~~');
  });

  it('does NOT apply strikethrough when status is null', () => {
    const result = getMentionsForRole(
      [makeMention('u1', null)],
      null,
      mockEmojiService,
    );
    expect(result).toContain('**user-u1**');
    expect(result).not.toContain('~~');
  });

  it('does NOT apply strikethrough when status is undefined', () => {
    const mention = {
      discordId: 'u1',
      username: 'user-u1',
      role: null,
      preferredRoles: null,
    };
    const result = getMentionsForRole([mention], null, mockEmojiService);
    expect(result).toContain('**user-u1**');
    expect(result).not.toContain('~~');
  });

  it('does NOT apply strikethrough for signed_up status', () => {
    const result = getMentionsForRole(
      [makeMention('u1', 'signed_up')],
      null,
      mockEmojiService,
    );
    expect(result).toContain('**user-u1**');
    expect(result).not.toContain('~~');
  });

  it('renders all participants as left when none are active', () => {
    const mentions = [
      makeMention('u1', 'left'),
      makeMention('u2', 'left'),
      makeMention('u3', 'left'),
    ];
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    expect(result).toContain('~~**user-u1**~~');
    expect(result).toContain('~~**user-u2**~~');
    expect(result).toContain('~~**user-u3**~~');
  });

  it('left participant at the cap boundary is displayed', () => {
    const mentions = Array.from({ length: ROSTER_NAME_CAP }, (_, i) =>
      makeMention(`user-${i}`, i === ROSTER_NAME_CAP - 1 ? 'left' : null),
    );
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    // 6th name (index 5) should be present and struck through
    expect(result).toContain('~~**user-user-5**~~');
    expect(result).not.toContain('more');
  });

  it('left participant one past the cap is truncated', () => {
    const mentions = Array.from({ length: ROSTER_NAME_CAP + 1 }, (_, i) =>
      makeMention(`user-${i}`, i === ROSTER_NAME_CAP ? 'left' : null),
    );
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    // 7th name should NOT appear
    expect(result).not.toContain('**user-user-6**');
    expect(result).toContain('+1 more');
  });

  it('mixed active and left participants with truncation', () => {
    // 8 participants: first 3 active, last 5 left
    const mentions = Array.from({ length: 8 }, (_, i) =>
      makeMention(`user-${i}`, i >= 3 ? 'left' : null),
    );
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    // First 3 should be normal
    for (let i = 0; i < 3; i++) {
      expect(result).toContain(`**user-user-${i}**`);
    }
    // Left participants in range should have strikethrough
    expect(result).toContain('~~**user-user-3**~~');
    expect(result).toContain('~~**user-user-5**~~');
    // Beyond the cap should be truncated
    expect(result).not.toContain('**user-user-6**');
    expect(result).toContain('+2 more');
  });
});
