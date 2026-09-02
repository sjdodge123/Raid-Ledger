/**
 * Adversarial tests for DiscordEmbedFactory.getMentionsForRole — ROK-373
 * Covers the roster cap with the "+N more" suffix.
 *
 * ROK-1460 moved the roster from `<@id>` mentions to bold display names and
 * lowered the cap from 25 to `ROSTER_NAME_CAP` (6) PER SECTION. Every boundary
 * pin below is the same signal re-anchored on the new cap and the new shape.
 */
import { ROSTER_NAME_CAP } from '../embeds/embed-roster.helpers';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';

const UNICODE_FALLBACK: Record<string, string> = {
  tank: '\uD83D\uDEE1\uFE0F',
  healer: '\uD83D\uDC9A',
  dps: '\u2694\uFE0F',
};

const mockEmojiService = {
  getRoleEmoji: (role: string) => UNICODE_FALLBACK[role] ?? '',
  getClassEmoji: () => '',
} as unknown as DiscordEmojiService;

type SignupMention = {
  discordId?: string | null;
  username?: string | null;
  role: string | null;
  preferredRoles: string[] | null;
  status?: string | null;
};

function makeMention(
  index: number,
  role: string | null = 'dps',
): SignupMention {
  return {
    discordId: `discord-user-${index}`,
    username: `user-${index}`,
    role,
    preferredRoles: role ? [role] : null,
    status: 'signed_up',
  };
}

function buildEventWithMentions(
  mentions: SignupMention[],
  role: string = 'dps',
): string {
  const factory = new DiscordEmbedFactory(mockEmojiService);
  const slotConfig =
    role === 'dps' || role === 'tank' || role === 'healer'
      ? { type: 'mmo', tank: 2, healer: 4, dps: 30 }
      : null;
  const event: EmbedEventData = {
    id: 1,
    title: 'Test Event',
    startTime: '2026-02-20T20:00:00.000Z',
    endTime: '2026-02-20T23:00:00.000Z',
    signupCount: mentions.length,
    maxAttendees: null,
    slotConfig,
    roleCounts: { [role]: mentions.length },
    signupMentions: mentions,
  };
  const context: EmbedContext = {
    communityName: 'Test Guild',
    clientUrl: 'http://localhost:5173',
  };
  const { embed } = factory.buildEventEmbed(event, context);
  return embed.toJSON().description ?? '';
}

function buildEventWithAllMentions(mentions: SignupMention[]): string {
  const factory = new DiscordEmbedFactory(mockEmojiService);
  const event: EmbedEventData = {
    id: 1,
    title: 'Test Event',
    startTime: '2026-02-20T20:00:00.000Z',
    endTime: '2026-02-20T23:00:00.000Z',
    signupCount: mentions.length,
    maxAttendees: 50,
    slotConfig: null,
    roleCounts: null,
    signupMentions: mentions,
  };
  const context: EmbedContext = {
    communityName: 'Test Guild',
    clientUrl: 'http://localhost:5173',
  };
  const { embed } = factory.buildEventEmbed(event, context);
  return embed.toJSON().description ?? '';
}

describe('roster list — fewer than the cap (no truncation)', () => {
  it('should list all names when count is 1', () => {
    const mentions = [makeMention(0, 'dps')];
    const description = buildEventWithMentions(mentions, 'dps');
    expect(description).toContain('**user-0**');
    expect(description).not.toContain('<@');
    expect(description).not.toContain('more');
  });

  it('should list all names when count is 3', () => {
    const mentions = Array.from({ length: 3 }, (_, i) => makeMention(i, 'dps'));
    const description = buildEventWithMentions(mentions, 'dps');
    for (let i = 0; i < 3; i++) {
      expect(description).toContain(`**user-${i}**`);
    }
    expect(description).not.toContain('more');
  });

  it('should list all names when count is one below the cap', () => {
    const count = ROSTER_NAME_CAP - 1;
    const mentions = Array.from({ length: count }, (_, i) =>
      makeMention(i, 'dps'),
    );
    const description = buildEventWithMentions(mentions, 'dps');
    for (let i = 0; i < count; i++) {
      expect(description).toContain(`**user-${i}**`);
    }
    expect(description).not.toContain('more');
  });
});

describe('roster list — exactly at the cap (boundary)', () => {
  it('should list every name with no overflow suffix at exactly the cap', () => {
    const mentions = Array.from({ length: ROSTER_NAME_CAP }, (_, i) =>
      makeMention(i, 'dps'),
    );
    const description = buildEventWithMentions(mentions, 'dps');
    for (let i = 0; i < ROSTER_NAME_CAP; i++) {
      expect(description).toContain(`**user-${i}**`);
    }
    expect(description).not.toContain('more');
  });
});

describe('roster list — truncation with suffix', () => {
  it('should cap and append "+1 more" when one over the cap', () => {
    const mentions = Array.from({ length: ROSTER_NAME_CAP + 1 }, (_, i) =>
      makeMention(i, 'dps'),
    );
    const description = buildEventWithMentions(mentions, 'dps');
    for (let i = 0; i < ROSTER_NAME_CAP; i++) {
      expect(description).toContain(`**user-${i}**`);
    }
    expect(description).not.toContain(`**user-${ROSTER_NAME_CAP}**`);
    expect(description).toContain('+1 more');
  });

  it('should cap and append "+24 more" when 30 signups', () => {
    const mentions = Array.from({ length: 30 }, (_, i) =>
      makeMention(i, 'dps'),
    );
    const description = buildEventWithMentions(mentions, 'dps');
    for (let i = 0; i < ROSTER_NAME_CAP; i++) {
      expect(description).toContain(`**user-${i}**`);
    }
    for (let i = ROSTER_NAME_CAP; i < 30; i++) {
      expect(description).not.toContain(`**user-${i}**`);
    }
    expect(description).toContain('+24 more');
  });

  it('should cap and append "+94 more" when 100 signups', () => {
    const mentions = Array.from({ length: 100 }, (_, i) =>
      makeMention(i, 'tank'),
    );
    const description = buildEventWithMentions(mentions, 'tank');
    expect(description).toContain('+94 more');
  });

  it('suffix format is exactly "+N more" (no space after the plus)', () => {
    const mentions = Array.from({ length: 27 }, (_, i) =>
      makeMention(i, 'healer'),
    );
    const description = buildEventWithMentions(mentions, 'healer');
    expect(description).toMatch(/\+21 more/);
    expect(description).not.toMatch(/\+ 21 more/);
  });
});

describe('roster list — role=null (all signups)', () => {
  it('should show "+21 more" when 27 total signups with no role filter', () => {
    const mentions = Array.from({ length: 27 }, (_, i) => ({
      ...makeMention(i, null),
      role: null,
      preferredRoles: null,
    }));
    const description = buildEventWithAllMentions(mentions);
    expect(description).toContain('+21 more');
  });

  it('should list them all with no suffix at exactly the cap (role=null)', () => {
    const mentions = Array.from({ length: ROSTER_NAME_CAP }, (_, i) => ({
      ...makeMention(i, null),
      role: null,
      preferredRoles: null,
    }));
    const description = buildEventWithAllMentions(mentions);
    expect(description).not.toContain('more');
  });
});

describe('roster list — username fallback', () => {
  it('should use username as label when discordId is null', () => {
    const mention: SignupMention = {
      discordId: null,
      username: 'anonymous-user',
      role: 'dps',
      preferredRoles: ['dps'],
      status: 'signed_up',
    };
    const description = buildEventWithMentions([mention], 'dps');
    expect(description).toContain('**anonymous-user**');
    expect(description).not.toContain('<@null>');
    expect(description).not.toContain('<@');
  });

  it('should use "???" when both discordId and username are null', () => {
    const mention: SignupMention = {
      discordId: null,
      username: null,
      role: 'dps',
      preferredRoles: ['dps'],
      status: 'signed_up',
    };
    const description = buildEventWithMentions([mention], 'dps');
    expect(description).toContain('**???**');
    // The discordId must never leak in as digits.
    expect(description).not.toContain('<@');
  });
});

describe('roster list — tentative prefix and role emoji', () => {
  it('should prefix tentative players with hourglass', () => {
    const mention: SignupMention = {
      discordId: 'discord-tent-1',
      username: 'tentative-user',
      role: 'dps',
      preferredRoles: ['dps'],
      status: 'tentative',
    };
    const description = buildEventWithMentions([mention], 'dps');
    expect(description).toContain('\u23F3');
    expect(description).toContain('**tentative-user**');
  });

  it('should NOT prefix non-tentative players with hourglass', () => {
    const mention: SignupMention = {
      discordId: 'discord-signed-1',
      username: 'signed-user',
      role: 'dps',
      preferredRoles: ['dps'],
      status: 'signed_up',
    };
    const description = buildEventWithMentions([mention], 'dps');
    expect(description).not.toContain('\u23F3');
  });

  it('should show role emojis for preferred roles', () => {
    const mention: SignupMention = {
      discordId: 'discord-flex-1',
      username: 'flex-user',
      role: 'tank',
      preferredRoles: ['tank', 'healer'],
      status: 'signed_up',
    };
    const description = buildEventWithMentions([mention], 'tank');
    expect(description).toContain('\uD83D\uDEE1\uFE0F');
    expect(description).toContain('\uD83D\uDC9A');
  });
});
