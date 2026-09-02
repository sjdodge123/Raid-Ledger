/**
 * DiscordEmbedFactory — buildSchedulingPollEmbed tests (ROK-1014).
 *
 * Tests for the scheduling poll embed: posted to a game's Discord channel
 * when a standalone scheduling poll is created, and updated on votes/suggestions.
 *
 * ROK-1461 (slice C): the two pins below were REWRITTEN, deliberately — the
 * "Vote Now" BUTTON became a masked `Vote now ↗` link on the last description
 * line, and the voter count left the footer for the state-carrying author
 * line (`▸ POLL OPEN · 5 voters`). No case was deleted and no assertion was
 * weakened: each one still proves the same behaviour on its new surface.
 * See `planning-artifacts/specs/ROK-1461.md` AC2/AC7.
 */
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';

function createFactory() {
  const emojiService = {
    getRoleEmoji: jest.fn(() => ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService;
  return new DiscordEmbedFactory(emojiService);
}

const baseContext: EmbedContext = {
  communityName: 'Test Guild',
  clientUrl: 'http://localhost:5173',
};

/** Scheduling poll data matching the expected input shape. */
const basePollData = {
  matchId: 10,
  lineupId: 1,
  gameId: 3,
  status: 'open' as const,
  gameName: 'Elden Ring',
  gameCoverUrl: 'https://img.example.com/elden-ring.jpg',
  pollUrl: 'http://localhost:5173/community-lineup/1/schedule/10',
  slots: [
    {
      proposedTime: '2026-04-10T19:00:00Z',
      voteCount: 5,
      voterNames: ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve'],
    },
    {
      proposedTime: '2026-04-11T20:00:00Z',
      voteCount: 3,
      voterNames: ['Alice', 'Bob', 'Charlie'],
    },
    {
      proposedTime: '2026-04-12T18:00:00Z',
      voteCount: 1,
      voterNames: ['Alice'],
    },
  ],
  uniqueVoterCount: 5,
};

// ---------------------------------------------------------------------------
// AC4: buildSchedulingPollEmbed exists and returns an EmbedResult
// ---------------------------------------------------------------------------

describe('buildSchedulingPollEmbed — method exists (AC4)', () => {
  it('buildSchedulingPollEmbed is a function on DiscordEmbedFactory', () => {
    const factory = createFactory();
    expect(typeof factory.buildSchedulingPollEmbed).toBe('function');
  });

  it('returns an EmbedResult with embed, row, and content', () => {
    const factory = createFactory();
    const result = factory.buildSchedulingPollEmbed(basePollData, baseContext);

    expect(result).toHaveProperty('embed');
    expect(result.embed).toBeDefined();
    expect(result.embed.toJSON()).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC5: Embed shows game name, "Vote Now" link button, game cover thumbnail
// ---------------------------------------------------------------------------

describe('buildSchedulingPollEmbed — embed content (AC5)', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('sets the game name in the embed title or description', () => {
    const result = factory.buildSchedulingPollEmbed(basePollData, baseContext);
    const json = result.embed.toJSON();
    const hasGameName =
      json.title?.includes('Elden Ring') ||
      json.description?.includes('Elden Ring');
    expect(hasGameName).toBe(true);
  });

  it('sets game cover as thumbnail', () => {
    const result = factory.buildSchedulingPollEmbed(basePollData, baseContext);
    expect(result.embed.toJSON().thumbnail?.url).toBe(
      'https://img.example.com/elden-ring.jpg',
    );
  });

  it('ends the description with the masked vote link, not a button', () => {
    const result = factory.buildSchedulingPollEmbed(basePollData, baseContext);
    expect(result.row).toBeUndefined();
    const description = (result.embed.toJSON().description ?? '').trimEnd();
    expect(description).toContain('[Vote now \u2197](');
    expect(description.endsWith(`](${basePollData.pollUrl})`)).toBe(true);
    expect(description).toContain('/community-lineup/1/schedule/10');
  });
});

// ---------------------------------------------------------------------------
// AC6: Embed shows top 3 time slots with vote counts
// ---------------------------------------------------------------------------

describe('buildSchedulingPollEmbed — slot fields (AC6)', () => {
  it('includes top 3 time slots with vote counts in embed fields', () => {
    const factory = createFactory();
    const result = factory.buildSchedulingPollEmbed(basePollData, baseContext);
    const json = result.embed.toJSON();

    // Embed should have fields or description entries for top slots
    const hasSlotInfo =
      (json.fields && json.fields.length >= 1) ||
      (json.description && json.description.includes('vote'));
    expect(hasSlotInfo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC7: Footer shows unique voter count
// ---------------------------------------------------------------------------

describe('buildSchedulingPollEmbed — voter count author line (AC7)', () => {
  it('author line shows unique voter count', () => {
    const factory = createFactory();
    const result = factory.buildSchedulingPollEmbed(basePollData, baseContext);
    const author = result.embed.toJSON().author?.name ?? '';
    expect(author).toContain('5');
    expect(author.toLowerCase()).toContain('voter');
    // ROK-1461: the count left the footer, which is now community + label.
    expect(result.embed.toJSON().footer?.text).toBe(
      'Test Guild \u00B7 Scheduling Poll',
    );
  });

  it('author line shows 0 voters when no votes exist', () => {
    const factory = createFactory();
    const noVoteData = {
      ...basePollData,
      slots: [],
      uniqueVoterCount: 0,
    };
    const result = factory.buildSchedulingPollEmbed(noVoteData, baseContext);
    const author = result.embed.toJSON().author?.name ?? '';
    expect(author).toContain('0');
    expect(author.toLowerCase()).toContain('voter');
  });
});

// ---------------------------------------------------------------------------
// AC8/AC9: Embed updates reflect current state (structural — tested via same method)
// ---------------------------------------------------------------------------

describe('buildSchedulingPollEmbed — update scenarios (AC8, AC9)', () => {
  it('embed with reduced votes reflects updated voter count', () => {
    const factory = createFactory();
    const reducedData = {
      ...basePollData,
      slots: [
        {
          proposedTime: '2026-04-10T19:00:00Z',
          voteCount: 2,
          voterNames: ['Alice', 'Bob'],
        },
      ],
      uniqueVoterCount: 2,
    };
    const result = factory.buildSchedulingPollEmbed(reducedData, baseContext);
    // ROK-1461: the live count moved to the author line.
    const author = result.embed.toJSON().author?.name ?? '';
    expect(author).toContain('2');
  });

  it('embed with new suggested slot shows in fields', () => {
    const factory = createFactory();
    const withNewSlot = {
      ...basePollData,
      slots: [
        ...basePollData.slots,
        {
          proposedTime: '2026-04-13T21:00:00Z',
          voteCount: 1,
          voterNames: ['Frank'],
        },
      ],
      uniqueVoterCount: 6,
    };
    const result = factory.buildSchedulingPollEmbed(withNewSlot, baseContext);
    const author = result.embed.toJSON().author?.name ?? '';
    expect(author).toContain('6');
  });

  it('embed with "No times suggested yet" when slots array is empty', () => {
    const factory = createFactory();
    const emptyData = {
      ...basePollData,
      slots: [],
      uniqueVoterCount: 0,
    };
    const result = factory.buildSchedulingPollEmbed(emptyData, baseContext);
    const json = result.embed.toJSON();
    const text =
      (json.description ?? '') +
      (json.fields?.map((f) => f.value).join(' ') ?? '');
    expect(text.toLowerCase()).toContain('no times suggested');
  });
});

// ---------------------------------------------------------------------------
// AC14: Embed uses a color (structural — doesn't crash)
// ---------------------------------------------------------------------------

describe('buildSchedulingPollEmbed — color and structure (AC14)', () => {
  it('uses a defined embed color', () => {
    const factory = createFactory();
    const result = factory.buildSchedulingPollEmbed(basePollData, baseContext);
    const color = result.embed.toJSON().color;
    expect(color).toBeDefined();
    expect(typeof color).toBe('number');
  });
});
