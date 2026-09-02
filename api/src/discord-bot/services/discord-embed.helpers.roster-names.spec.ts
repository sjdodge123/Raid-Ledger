/**
 * ROK-1460 (slice B) — TDD pins for the mention-free roster line.
 *
 * Spec `planning-artifacts/specs/ROK-1460.md` §Roster (operator decision D8):
 * keep every existing signal — per-role sections with `(count/max)`, class and
 * role emoji, ⏳ tentative, ⏰ running late, ~~left~~ — and drop ONLY the
 * `<@id>` mentions. Identity is `displayName ?? username ?? '???'`, rendered as
 * a bold name. Each section caps at `ROSTER_NAME_CAP` (6) with `+N more`.
 */
import { buildRosterLine } from './discord-embed.helpers';
import type { EmbedEventData } from './discord-embed.factory';
import type { DiscordEmojiService } from './discord-emoji.service';

const HOURGLASS = '⏳';
const ALARM = '⏰';

type Mention = NonNullable<EmbedEventData['signupMentions']>[number] & {
  displayName?: string | null;
};

function createEmojiService(): DiscordEmojiService {
  return {
    getRoleEmoji: jest.fn((role: string) => `[${role}]`),
    getClassEmoji: jest.fn((cls: string) => `{${cls}}`),
  } as unknown as DiscordEmojiService;
}

function mention(overrides: Partial<Mention> = {}): Mention {
  return {
    discordId: '100',
    username: 'fallback',
    role: null,
    preferredRoles: null,
    status: 'signed_up',
    ...overrides,
  };
}

function flatEvent(mentions: Mention[]): EmbedEventData {
  return {
    id: 1,
    title: 'Friday Deep Dive',
    startTime: '2026-02-20T20:00:00.000Z',
    endTime: '2026-02-20T22:00:00.000Z',
    signupCount: mentions.length,
    maxAttendees: 8,
    slotConfig: null,
    signupMentions: mentions,
  };
}

function mmoEvent(
  mentions: Mention[],
  slots: { tank?: number; healer?: number; dps?: number } = {
    tank: 2,
    healer: 2,
    dps: 8,
  },
  roleCounts: Record<string, number> = {},
): EmbedEventData {
  return {
    ...flatEvent(mentions),
    slotConfig: { type: 'mmo', ...slots },
    roleCounts,
  };
}

function render(event: EmbedEventData): string {
  return buildRosterLine(event, createEmojiService()) ?? '';
}

describe('buildRosterLine — non-MMO roster renders names, not mentions (AC6)', () => {
  it('renders the display name in bold', () => {
    const line = render(
      flatEvent([mention({ displayName: 'Ana', username: 'ana_raw' })]),
    );
    expect(line).toContain('**Ana**');
  });

  it('prefers displayName over username', () => {
    const line = render(
      flatEvent([mention({ displayName: 'Ana', username: 'ana_raw' })]),
    );
    expect(line).toContain('**Ana**');
    expect(line).not.toContain('ana_raw');
  });

  it('falls back to username when there is no display name', () => {
    const line = render(
      flatEvent([mention({ displayName: null, username: 'Bo' })]),
    );
    expect(line).toContain('**Bo**');
  });

  // ROK-1460 fix 9 — an unlinked Discord signup has no users row (username is
  // null) but event_signups stores its discord_username. The old `<@id>` roster
  // rendered a real name for these people; falling through to `???` would be a
  // regression the mention-free roster introduced.
  it('falls back to the stored Discord username for an unlinked signup', () => {
    const line = render(
      flatEvent([
        mention({
          discordId: '123456789012345678',
          username: null,
          displayName: null,
          discordUsername: 'raider',
        }),
      ]),
    );
    expect(line).toContain('**raider**');
    expect(line).not.toContain('**???**');
    expect(line).not.toContain('123456789012345678');
  });

  it('prefers the account username over the stored Discord username', () => {
    const line = render(
      flatEvent([mention({ username: 'Bo', discordUsername: 'bo_raw' })]),
    );
    expect(line).toContain('**Bo**');
    expect(line).not.toContain('bo_raw');
  });

  it('renders ??? for a signup that only has a Discord id — never digits', () => {
    const line = render(
      flatEvent([mention({ discordId: '123456789012345678', username: null })]),
    );
    expect(line).toContain('**???**');
    expect(line).not.toContain('123456789012345678');
  });

  it('emits no mention token anywhere in the roster', () => {
    const line = render(
      flatEvent([
        mention({ discordId: '111', displayName: 'Ana' }),
        mention({ discordId: '222', username: 'Bo' }),
        mention({ discordId: '333', username: null }),
      ]),
    );
    expect(line).not.toContain('<@');
  });

  it('drops the "── ROSTER: n/max ──" header — the author line carries the count', () => {
    const line = render(flatEvent([mention({ displayName: 'Ana' })]));
    expect(line).not.toContain('ROSTER:');
  });
});

describe('buildRosterLine — status and emoji markers survive (AC6)', () => {
  it('keeps the tentative hourglass in front of the bold name', () => {
    const line = render(
      flatEvent([mention({ displayName: 'Bo', status: 'tentative' })]),
    );
    expect(line).toContain(HOURGLASS);
    expect(line).toContain('**Bo**');
  });

  it('keeps the running-late alarm and never strikes it through', () => {
    const line = render(
      flatEvent([mention({ displayName: 'Dee', runningLate: true })]),
    );
    expect(line).toContain(ALARM);
    expect(line).toContain('**Dee**');
    expect(line).not.toContain('~~**Dee**~~');
  });

  it('strikes through a signup that left', () => {
    const line = render(
      flatEvent([mention({ displayName: 'Cy', status: 'left' })]),
    );
    expect(line).toContain('~~**Cy**~~');
  });

  it('keeps the class emoji', () => {
    const line = render(
      flatEvent([mention({ displayName: 'Ana', className: 'Rogue' })]),
    );
    expect(line).toContain('{Rogue}');
  });

  it('keeps the preferred-role emoji', () => {
    const line = render(
      flatEvent([
        mention({ displayName: 'Ana', preferredRoles: ['tank', 'dps'] }),
      ]),
    );
    expect(line).toContain('[tank]');
    expect(line).toContain('[dps]');
  });
});

describe('buildRosterLine — MMO sections (AC6)', () => {
  const roster = [
    mention({ discordId: '1', displayName: 'Ana', role: 'tank' }),
    mention({ discordId: '2', displayName: 'Bo', role: 'healer' }),
    mention({ discordId: '3', displayName: 'Cy', role: 'dps' }),
  ];

  it('keeps the section headers with their (count/max) pair', () => {
    const line = render(
      mmoEvent(
        roster,
        { tank: 2, healer: 2, dps: 8 },
        {
          tank: 1,
          healer: 1,
          dps: 1,
        },
      ),
    );
    expect(line).toContain('**Tanks** (1/2)');
    expect(line).toContain('**Healers** (1/2)');
    expect(line).toContain('**DPS** (1/8)');
  });

  it('files each bold name under its own section', () => {
    const line = render(mmoEvent(roster));
    const tankIdx = line.indexOf('**Tanks**');
    const healerIdx = line.indexOf('**Healers**');
    expect(line.slice(tankIdx, healerIdx)).toContain('**Ana**');
    expect(line.slice(tankIdx, healerIdx)).not.toContain('**Bo**');
  });

  it('emits no mention token in an MMO roster', () => {
    expect(render(mmoEvent(roster))).not.toContain('<@');
  });

  it('caps a section at six names and reports the overflow', () => {
    const seven = ['Ana', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus'].map(
      (displayName, i) =>
        mention({ discordId: String(i), displayName, role: 'dps' }),
    );
    const line = render(mmoEvent(seven, { dps: 8 }, { dps: 7 }));
    expect(line).toContain('+1 more');
    expect(line).not.toContain('**Gus**');
  });

  it('renders an em-dash for an empty section', () => {
    const line = render(
      mmoEvent([mention({ displayName: 'Ana', role: 'tank' })], {
        tank: 1,
        healer: 1,
      }),
    );
    expect(line).toContain('—');
  });
});
