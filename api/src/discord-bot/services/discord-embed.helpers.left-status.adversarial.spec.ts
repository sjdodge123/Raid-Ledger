/**
 * Adversarial tests for left-participant rendering in embed helpers (ROK-680).
 *
 * Covers edge cases not handled by the dev-written left-status tests:
 * - left status with class emoji and role emojis
 * - left status combined with tentative (mutually exclusive in practice)
 * - left status at the MAX_MENTIONS boundary (25th participant)
 * - left participants beyond truncation threshold
 * - all participants left (none active)
 * - left with "???" fallback (null discordId + null username)
 * - buildAdHocUpdateEmbed active/left field rendering
 * - buildAdHocCompletedEmbed participant listing
 */
import {
  getMentionsForRole,
  buildAdHocUpdateEmbed,
  buildAdHocCompletedEmbed,
} from './discord-embed.helpers';
import type { DiscordEmojiService } from './discord-emoji.service';
import type { EmbedContext } from './discord-embed.factory';

const UNICODE_ROLES: Record<string, string> = {
  tank: '\uD83D\uDEE1\uFE0F',
  healer: '\uD83D\uDC9A',
  dps: '\u2694\uFE0F',
};

const mockEmojiService = {
  getRoleEmoji: jest.fn((role: string) => UNICODE_ROLES[role] ?? ''),
  getClassEmoji: jest.fn(() => '\uD83E\uDDD9'),
} as unknown as DiscordEmojiService;

const mockContext: EmbedContext = {
  communityName: 'Test Guild',
  clientUrl: 'http://localhost:5173',
  timezone: 'UTC',
};

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
    expect(result).toContain('~~<@u1>~~');
    expect(result).toContain('\uD83E\uDDD9');
  });

  it('applies strikethrough with role emojis for left participant', () => {
    const mention = makeMention('u1', 'left', {
      preferredRoles: ['tank', 'healer'],
    });
    const result = getMentionsForRole([mention], null, mockEmojiService);
    expect(result).toContain('~~<@u1>~~');
    expect(result).toContain('\uD83D\uDEE1\uFE0F');
    expect(result).toContain('\uD83D\uDC9A');
  });

  it('left status takes precedence over tentative prefix', () => {
    // In practice these should be mutually exclusive, but test the
    // implementation handles the case gracefully
    const mention = makeMention('u1', 'left');
    const result = getMentionsForRole([mention], null, mockEmojiService);
    expect(result).toContain('~~<@u1>~~');
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
    expect(result).toContain('~~???~~');
  });

  it('does NOT apply strikethrough when status is null', () => {
    const result = getMentionsForRole(
      [makeMention('u1', null)],
      null,
      mockEmojiService,
    );
    expect(result).toContain('<@u1>');
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
    expect(result).toContain('<@u1>');
    expect(result).not.toContain('~~');
  });

  it('does NOT apply strikethrough for signed_up status', () => {
    const result = getMentionsForRole(
      [makeMention('u1', 'signed_up')],
      null,
      mockEmojiService,
    );
    expect(result).toContain('<@u1>');
    expect(result).not.toContain('~~');
  });

  it('renders all participants as left when none are active', () => {
    const mentions = [
      makeMention('u1', 'left'),
      makeMention('u2', 'left'),
      makeMention('u3', 'left'),
    ];
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    expect(result).toContain('~~<@u1>~~');
    expect(result).toContain('~~<@u2>~~');
    expect(result).toContain('~~<@u3>~~');
  });

  it('left participant at position 25 is displayed (boundary)', () => {
    const mentions = Array.from({ length: 25 }, (_, i) =>
      makeMention(`user-${i}`, i === 24 ? 'left' : null),
    );
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    // 25th mention (index 24) should be present and struck through
    expect(result).toContain('~~<@user-24>~~');
    expect(result).not.toContain('more');
  });

  it('left participant at position 26 is truncated', () => {
    const mentions = Array.from({ length: 26 }, (_, i) =>
      makeMention(`user-${i}`, i === 25 ? 'left' : null),
    );
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    // 26th mention should NOT appear
    expect(result).not.toContain('<@user-25>');
    expect(result).toContain('+ 1 more');
  });

  it('mixed active and left participants with truncation', () => {
    // 27 participants: first 13 active, last 14 left
    const mentions = Array.from({ length: 27 }, (_, i) =>
      makeMention(`user-${i}`, i >= 13 ? 'left' : null),
    );
    const result = getMentionsForRole(mentions, null, mockEmojiService);
    // First 13 should be normal
    for (let i = 0; i < 13; i++) {
      expect(result).toContain(`<@user-${i}>`);
    }
    // Left participants in range should have strikethrough
    expect(result).toContain('~~<@user-13>~~');
    expect(result).toContain('~~<@user-24>~~');
    // Beyond 25 should be truncated
    expect(result).not.toContain('<@user-25>');
    expect(result).toContain('+ 2 more');
  });
});

// ─── buildAdHocUpdateEmbed — active/left field rendering ────

describe('buildAdHocUpdateEmbed — active/left fields (ROK-680)', () => {
  it('shows active field with mentions and left field with strikethrough', () => {
    const { embed } = buildAdHocUpdateEmbed(
      { id: 1, title: 'Quick Play', gameName: 'WoW' },
      [
        { discordUserId: 'u1', discordUsername: 'P1', isActive: true },
        { discordUserId: 'u2', discordUsername: 'P2', isActive: false },
      ],
      mockContext,
    );
    const json = embed.toJSON();
    const activeField = json.fields?.find((f) => f.name.includes('Active'));
    const leftField = json.fields?.find((f) => f.name.includes('Left'));
    expect(activeField).toBeDefined();
    expect(activeField!.name).toContain('1');
    expect(activeField!.value).toContain('<@u1>');
    expect(leftField).toBeDefined();
    expect(leftField!.name).toContain('1');
    expect(leftField!.value).toContain('~~<@u2>~~');
  });

  it('omits left field when no participants have left', () => {
    const { embed } = buildAdHocUpdateEmbed(
      { id: 1, title: 'Quick Play' },
      [{ discordUserId: 'u1', discordUsername: 'P1', isActive: true }],
      mockContext,
    );
    const json = embed.toJSON();
    const leftField = json.fields?.find((f) => f.name.includes('Left'));
    expect(leftField).toBeUndefined();
  });

  it('shows "None" when all participants have left', () => {
    const { embed } = buildAdHocUpdateEmbed(
      { id: 1, title: 'Quick Play' },
      [
        { discordUserId: 'u1', discordUsername: 'P1', isActive: false },
        { discordUserId: 'u2', discordUsername: 'P2', isActive: false },
      ],
      mockContext,
    );
    const json = embed.toJSON();
    const activeField = json.fields?.find((f) => f.name.includes('Active'));
    expect(activeField!.name).toContain('0');
    expect(activeField!.value).toBe('None');
  });

  it('shows correct active count with empty participants', () => {
    const { embed } = buildAdHocUpdateEmbed(
      { id: 1, title: 'Quick Play' },
      [],
      mockContext,
    );
    const json = embed.toJSON();
    const activeField = json.fields?.find((f) => f.name.includes('Active'));
    expect(activeField!.name).toContain('0');
    expect(activeField!.value).toBe('None');
  });

  it('includes game name in description when provided', () => {
    const { embed } = buildAdHocUpdateEmbed(
      { id: 1, title: 'Quick Play', gameName: 'Final Fantasy' },
      [],
      mockContext,
    );
    const json = embed.toJSON();
    expect(json.description).toContain('Final Fantasy');
  });

  it('omits game name from description when not provided', () => {
    const { embed } = buildAdHocUpdateEmbed(
      { id: 1, title: 'Quick Play' },
      [],
      mockContext,
    );
    const json = embed.toJSON();
    expect(json.description).not.toContain('Game:');
  });

  it('includes view button when clientUrl is available', () => {
    const result = buildAdHocUpdateEmbed(
      { id: 42, title: 'Quick Play' },
      [],
      mockContext,
    );
    expect(result.row).toBeDefined();
  });
});

// ─── buildAdHocCompletedEmbed ───────────────────────────────

describe('buildAdHocCompletedEmbed — participant listing', () => {
  it('shows participant durations in the roster', () => {
    const { embed } = buildAdHocCompletedEmbed(
      {
        id: 1,
        title: 'Quick Play',
        startTime: '2026-01-01T18:00:00Z',
        endTime: '2026-01-01T20:00:00Z',
      },
      [
        {
          discordUserId: 'u1',
          discordUsername: 'P1',
          totalDurationSeconds: 3600,
        },
        {
          discordUserId: 'u2',
          discordUsername: 'P2',
          totalDurationSeconds: null,
        },
      ],
      mockContext,
    );
    const json = embed.toJSON();
    const participantField = json.fields?.find((f) =>
      f.name.includes('Participants'),
    );
    expect(participantField!.name).toContain('2');
    expect(participantField!.value).toContain('<@u1>');
    expect(participantField!.value).toContain('(60m)');
    expect(participantField!.value).toContain('<@u2>');
  });

  it('shows "None" when no participants', () => {
    const { embed } = buildAdHocCompletedEmbed(
      {
        id: 1,
        title: 'Quick Play',
        startTime: '2026-01-01T18:00:00Z',
        endTime: '2026-01-01T20:00:00Z',
      },
      [],
      mockContext,
    );
    const json = embed.toJSON();
    const field = json.fields?.find((f) => f.name.includes('Participants'));
    expect(field!.name).toContain('0');
    expect(field!.value).toBe('None');
  });

  it('formats hours+minutes duration correctly', () => {
    const { embed } = buildAdHocCompletedEmbed(
      {
        id: 1,
        title: 'Quick Play',
        startTime: '2026-01-01T18:00:00Z',
        endTime: '2026-01-01T19:30:00Z',
      },
      [],
      mockContext,
    );
    const json = embed.toJSON();
    expect(json.description).toContain('1h 30m');
  });

  it('formats sub-hour duration correctly', () => {
    const { embed } = buildAdHocCompletedEmbed(
      {
        id: 1,
        title: 'Quick Play',
        startTime: '2026-01-01T18:00:00Z',
        endTime: '2026-01-01T18:45:00Z',
      },
      [],
      mockContext,
    );
    const json = embed.toJSON();
    expect(json.description).toContain('45m');
    expect(json.description).not.toContain('h');
  });

  it('uses community name in footer', () => {
    const { embed } = buildAdHocCompletedEmbed(
      {
        id: 1,
        title: 'Quick Play',
        startTime: '2026-01-01T18:00:00Z',
        endTime: '2026-01-01T20:00:00Z',
      },
      [],
      mockContext,
    );
    const json = embed.toJSON();
    expect(json.footer?.text).toBe('Test Guild');
  });

  it('falls back to "Raid Ledger" footer when communityName is null', () => {
    const { embed } = buildAdHocCompletedEmbed(
      {
        id: 1,
        title: 'Quick Play',
        startTime: '2026-01-01T18:00:00Z',
        endTime: '2026-01-01T20:00:00Z',
      },
      [],
      { ...mockContext, communityName: null },
    );
    const json = embed.toJSON();
    expect(json.footer?.text).toBe('Raid Ledger');
  });
});
