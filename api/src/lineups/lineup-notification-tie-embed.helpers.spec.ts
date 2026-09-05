/**
 * ROK-1374 (Lane B) — the three tie-lifecycle channel embeds.
 *
 * D6 is a GRAMMAR constraint, not a preference: a channel embed renders the
 * same bytes for every viewer (ROK-1449). These specs pin that — no `<@`
 * mention, no "you own", no per-viewer text — alongside the author line and
 * the chrome colour each state owns.
 */
import { colorForState } from '../discord-bot/embeds/embed-chrome.helpers';
import {
  buildTieDecidedEmbed,
  buildTieDetectedEmbed,
  buildTieExpiredEmbed,
} from './lineup-notification-tie-embed.helpers';
import type { EmbedContext } from './lineup-notification-embed.helpers';

const ctx: EmbedContext = {
  baseUrl: 'https://raid.example.net',
  lineupId: 42,
  communityName: 'Gamer Night',
  phase: 'voting',
  lineupTitle: 'Friday Co-op',
};

const TIED = [
  { id: 7, name: 'Deep Rock Galactic' },
  { id: 9, name: 'Valheim' },
];

/** Every assertion below reads the built embed through these two accessors. */
function read(embed: { data: Record<string, unknown> }): {
  author: string;
  description: string;
  color: number;
} {
  const data = embed.data as {
    author?: { name: string };
    description?: string;
    color?: number;
  };
  return {
    author: data.author?.name ?? '',
    description: data.description ?? '',
    color: data.color ?? -1,
  };
}

describe('buildTieDetectedEmbed', () => {
  it('announces the tie in the author line with both game names', () => {
    const { author } = read(buildTieDetectedEmbed(ctx, TIED, 6).embed);
    expect(author).toBe('◌ TIED · Deep Rock Galactic / Valheim');
  });

  it('describes the roster fit and links out to the lineup page', () => {
    const { description } = read(buildTieDetectedEmbed(ctx, TIED, 6).embed);
    expect(description).toContain(
      'Both fit your group of 6 — open the lineup to compare and pick.',
    );
    expect(description).toContain(
      '[Open lineup ↗](https://raid.example.net/community-lineup/42)',
    );
  });

  it('renders in the needs_you (amber) chrome state', () => {
    const { color } = read(buildTieDetectedEmbed(ctx, TIED, 6).embed);
    expect(color).toBe(colorForState('needs_you'));
  });

  it('carries no mention token and no per-viewer ownership copy (AC9)', () => {
    const { author, description } = read(
      buildTieDetectedEmbed(ctx, TIED, 6).embed,
    );
    expect(`${author}\n${description}`).not.toContain('<@');
    expect(`${author}\n${description}`.toLowerCase()).not.toContain('you own');
  });
});

describe('buildTieDecidedEmbed', () => {
  const decided = () =>
    buildTieDecidedEmbed(ctx, TIED[0], 'Roknua', {
      count: 6,
      rosterSize: 6,
    }).embed;

  it('names the winning game in the author line', () => {
    expect(read(decided()).author).toBe('■ DECIDED · Deep Rock Galactic');
  });

  it('credits the picker and the roster-scoped ownership aggregate', () => {
    expect(read(decided()).description).toContain(
      'Tied on votes · picked by Roknua — 6/6 already own it',
    );
  });

  it('renders in the done chrome state', () => {
    expect(read(decided()).color).toBe(colorForState('done'));
  });

  it('neutralises a mention smuggled in through the picker name (AC9)', () => {
    const embed = buildTieDecidedEmbed(ctx, TIED[0], '<@123456789>', {
      count: 1,
      rosterSize: 4,
    }).embed;
    expect(read(embed).description).not.toContain('<@');
  });
});

describe('buildTieExpiredEmbed', () => {
  it('marks the lineup undecided in the author line', () => {
    const { author } = read(buildTieExpiredEmbed(ctx, TIED).embed);
    expect(author).toBe('■ EXPIRED · undecided');
  });

  it('says nobody picked and still names what was tied', () => {
    const { description } = read(buildTieExpiredEmbed(ctx, TIED).embed);
    expect(description).toContain(
      'Nobody picked — the lineup closed without a decision.',
    );
    expect(description).toContain('Deep Rock Galactic / Valheim');
  });

  it('renders in the done chrome state', () => {
    const { color } = read(buildTieExpiredEmbed(ctx, TIED).embed);
    expect(color).toBe(colorForState('done'));
  });

  it('carries no mention token and no per-viewer ownership copy (AC9)', () => {
    const { author, description } = read(buildTieExpiredEmbed(ctx, TIED).embed);
    expect(`${author}\n${description}`).not.toContain('<@');
    expect(`${author}\n${description}`.toLowerCase()).not.toContain('you own');
  });
});
