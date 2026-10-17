/**
 * Tests for getLineupHeroCopy (ROK-1209).
 *
 * Pure-data registry — productionized from `web/src/dev/lineup-wireframes/hero-copy.ts`.
 * Each (page × persona × phaseState) maps to a tone + copy + optional CTA.
 *
 * The dev wireframe registry uses hard-coded sample text. The production
 * registry must use real DTO data interpolated from a context object. These
 * tests pin the contract: callers pass `ctx` with concrete payloads and the
 * registry returns interpolated strings.
 */
import { describe, expect, it } from 'vitest';
import { getLineupHeroCopy, type HeroCopyContext } from './lineup-hero-copy';
import { createMockLineupDetail, createMockEntry } from '../test/lineup-factories';

function buildCtx(overrides: Partial<HeroCopyContext> = {}): HeroCopyContext {
  return {
    pageId: 'lineup-detail',
    persona: 'invitee-not-acted',
    phaseState: 'plenty-of-time',
    lineup: createMockLineupDetail({
      status: 'building',
      maxVotesPerPlayer: 3,
      totalMembers: 12,
      totalVoters: 5,
    }),
    tiebreaker: null,
    myNominatedGameNames: [],
    myMatchCount: 0,
    myVotedSlotCount: 0,
    ...overrides,
  };
}

describe('getLineupHeroCopy — phase-state envelope precedence', () => {
  it("returns aborted tone + 'Back to Games' CTA when phaseState='aborted'", () => {
    const copy = getLineupHeroCopy(
      buildCtx({ phaseState: 'aborted' }),
    );
    expect(copy.tone).toBe('aborted');
    expect(copy.cta?.text).toMatch(/back to games/i);
  });

  it("returns waiting tone + auto-advance copy when phaseState='deadline-missed'", () => {
    const copy = getLineupHeroCopy(
      buildCtx({ phaseState: 'deadline-missed' }),
    );
    expect(copy.tone).toBe('waiting');
    expect(copy.headline).toMatch(/advanc/i);
  });
});

describe('getLineupHeroCopy — building phase', () => {
  it("invitee-not-acted gets emerald action tone with 'Nominate a game' CTA", () => {
    const copy = getLineupHeroCopy(
      buildCtx({
        pageId: 'building',
        persona: 'invitee-not-acted',
      }),
    );
    expect(copy.tone).toBe('action');
    expect(copy.cta?.text).toMatch(/nominate a game/i);
  });

  it('invitee-acted (1 nomination) interpolates the game name into headline', () => {
    const copy = getLineupHeroCopy(
      buildCtx({
        pageId: 'building',
        persona: 'invitee-acted',
        myNominatedGameNames: ['Hollowforge'],
      }),
    );
    expect(copy.tone).toBe('waiting');
    expect(copy.headline).toMatch(/Hollowforge/);
    expect(copy.secondary?.text).toMatch(/change/i);
  });

  it('invitee-acted (2+ nominations) uses the count form, not the single-name form', () => {
    const copy = getLineupHeroCopy(
      buildCtx({
        pageId: 'building',
        persona: 'invitee-acted',
        myNominatedGameNames: ['Hollowforge', 'Deep Rock'],
      }),
    );
    expect(copy.tone).toBe('waiting');
    expect(copy.headline).toMatch(/2 games/);
  });

  it("organizer who has nominated gets 'Advance to Voting' CTA", () => {
    const copy = getLineupHeroCopy(
      buildCtx({
        pageId: 'building',
        persona: 'organizer',
        myNominatedGameNames: ['Hollowforge'],
      }),
    );
    expect(copy.cta?.text).toMatch(/advance to voting/i);
  });

  // ROK-1253: organizer who hasn't nominated themselves is still an
  // expected voter; show the participation prompt before the advance CTA.
  it("organizer who hasn't nominated gets 'Nominate a game' CTA", () => {
    const copy = getLineupHeroCopy(
      buildCtx({
        pageId: 'building',
        persona: 'organizer',
        myNominatedGameNames: [],
      }),
    );
    expect(copy.tone).toBe('action');
    expect(copy.cta?.text).toMatch(/nominate a game/i);
    expect(copy.headline).toMatch(/nominate the games/i);
  });

  it('uninvited gets amber privacy tone with disabled-feeling CTA text', () => {
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'building', persona: 'uninvited' }),
    );
    expect(copy.tone).toBe('privacy');
    expect(copy.cta?.text).toMatch(/request invite/i);
  });
});

describe('getLineupHeroCopy — voting phase', () => {
  it("invitee-not-acted shows 'Cast your votes' with maxVotesPerPlayer interpolated", () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      maxVotesPerPlayer: 5,
    });
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'voting', persona: 'invitee-not-acted', lineup }),
    );
    expect(copy.tone).toBe('action');
    expect(copy.headline).toMatch(/up to 5/);
  });

  it('invitee-acted with totalMembers - totalVoters waiting count', () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      maxVotesPerPlayer: 3,
      totalMembers: 12,
      totalVoters: 5,
      myVotes: [42, 43, 44],
    });
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'voting', persona: 'invitee-acted', lineup }),
    );
    expect(copy.tone).toBe('waiting');
    // Either the headline or detail must reference 7 (12 - 5) waiters
    const haystack = `${copy.headline} ${copy.detail ?? ''}`;
    expect(haystack).toMatch(/7/);
  });

  // ROK-1253: organizer who has voted gets the operator-advance CTA only
  // when quorum is genuinely reached.
  it("organizer who hasn't voted gets 'Open voting' CTA (not 'Advance')", () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      maxVotesPerPlayer: 3,
      totalMembers: 3,
      totalVoters: 0,
      myVotes: [],
    });
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'voting', persona: 'organizer', lineup }),
    );
    expect(copy.tone).toBe('action');
    expect(copy.cta?.text).toMatch(/open voting/i);
    expect(copy.headline).toMatch(/cast your votes/i);
  });

  it('organizer who voted partially (below max) sees Sit-tight acknowledgment', () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      maxVotesPerPlayer: 3,
      totalMembers: 3,
      totalVoters: 1,
      myVotes: [42],
    });
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'voting', persona: 'organizer', lineup, myNominatedGameNames: ['Hollowforge'] }),
    );
    expect(copy.cta?.text).toMatch(/advance to decided/i);
    expect(copy.headline).not.toMatch(/quorum reached/i);
    expect(copy.headline).toMatch(/You voted for 1 game/);
    expect(copy.headline).toMatch(/Sit tight/);
    expect(copy.headline).toMatch(/2 of 3 still voting/);
  });

  it("organizer who maxed their votes sees 'You're all done' framing", () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      maxVotesPerPlayer: 3,
      totalMembers: 3,
      totalVoters: 1,
      myVotes: [42, 43, 44],
    });
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'voting', persona: 'organizer', lineup }),
    );
    expect(copy.cta?.text).toMatch(/advance to decided/i);
    expect(copy.headline).toMatch(/You're all done/);
    expect(copy.headline).toMatch(/2 of 3 still voting/);
  });

  it('organizer with 2 personal votes (below max) pluralizes correctly', () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      maxVotesPerPlayer: 3,
      totalMembers: 3,
      totalVoters: 1,
      myVotes: [42, 43],
    });
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'voting', persona: 'organizer', lineup }),
    );
    expect(copy.headline).toMatch(/You voted for 2 games/);
  });

  it("organizer with quorum met sees 'Quorum reached' headline", () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      maxVotesPerPlayer: 3,
      totalMembers: 3,
      totalVoters: 3,
      myVotes: [42, 43, 44],
    });
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'voting', persona: 'organizer', lineup }),
    );
    expect(copy.headline).toMatch(/quorum reached/i);
    expect(copy.cta?.text).toMatch(/advance to decided/i);
  });
});

describe('getLineupHeroCopy — decided phase', () => {
  it("invitee-acted gets 'Schedule {gameName}' CTA when decidedGameName is set", () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      decidedGameId: 42,
      decidedGameName: 'Hollowforge',
      entries: [createMockEntry({ gameId: 42, gameName: 'Hollowforge' })],
      myVotes: [42],
    });
    const copy = getLineupHeroCopy(
      buildCtx({
        pageId: 'decided',
        persona: 'invitee-acted',
        lineup,
        myMatchCount: 1,
      }),
    );
    expect(copy.tone).toBe('action');
    expect(copy.cta?.text).toMatch(/Schedule Hollowforge/i);
  });

  it("invitee-not-acted gets 'Join {decidedGameName}' CTA", () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      decidedGameId: 42,
      decidedGameName: 'Hollowforge',
    });
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'decided', persona: 'invitee-not-acted', lineup }),
    );
    expect(copy.cta?.text).toMatch(/Join Hollowforge/i);
  });

  it('invitee-acted with no matches shows waiting tone + no secondary', () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      decidedGameId: 42,
      decidedGameName: 'Hollowforge',
      myVotes: [42, 43],
    });
    const copy = getLineupHeroCopy(
      buildCtx({
        pageId: 'decided',
        persona: 'invitee-acted',
        lineup,
        myMatchCount: 0,
      }),
    );
    expect(copy.tone).toBe('waiting');
    expect(copy.headline).toMatch(/2/);
  });
});

describe('getLineupHeroCopy — tiebreaker phase', () => {
  it("invitee-acted (partial bracket) headline mentions vote progress", () => {
    const copy = getLineupHeroCopy(
      buildCtx({
        pageId: 'tiebreaker',
        persona: 'invitee-acted',
        tiebreaker: {
          id: 1,
          lineupId: 1,
          mode: 'bracket',
          status: 'active',
          tiedGameIds: [],
          originalVoteCount: 5,
          winnerGameId: null,
          roundDeadline: null,
          resolvedAt: null,
          currentRound: 1,
          totalRounds: 1,
          matchups: [
            {
              id: 1, round: 1, position: 1,
              gameA: { gameId: 10, gameName: 'A', gameCoverUrl: null, originalVoteCount: 5 },
              gameB: { gameId: 11, gameName: 'B', gameCoverUrl: null, originalVoteCount: 5 },
              isBye: false, winnerGameId: null,
              voteCountA: 1, voteCountB: 0,
              myVote: 10,
              isActive: true, isCompleted: false,
            },
            {
              id: 2, round: 1, position: 2,
              gameA: { gameId: 12, gameName: 'C', gameCoverUrl: null, originalVoteCount: 5 },
              gameB: { gameId: 13, gameName: 'D', gameCoverUrl: null, originalVoteCount: 5 },
              isBye: false, winnerGameId: null,
              voteCountA: 0, voteCountB: 0,
              myVote: null,
              isActive: true, isCompleted: false,
            },
          ],
          vetoStatus: null,
        },
      }),
    );
    // Either tone or headline references progress (1 of 2)
    const haystack = `${copy.headline} ${copy.detail ?? ''}`;
    expect(haystack).toMatch(/(1 of 2|2|matchups)/i);
  });

  it("organizer gets 'Force-resolve now' CTA on tiebreaker", () => {
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'tiebreaker', persona: 'organizer' }),
    );
    expect(copy.cta?.text).toMatch(/force.*resolve/i);
  });
});

describe('getLineupHeroCopy — standalone scheduling poll', () => {
  it("invitee-not-acted gets a 'Pick' CTA", () => {
    const copy = getLineupHeroCopy(
      buildCtx({ pageId: 'standalone-poll', persona: 'invitee-not-acted' }),
    );
    expect(copy.tone).toBe('action');
    expect(copy.cta?.text).toMatch(/pick/i);
  });

  it('invitee-acted with N slots picked shows waiting tone with N interpolated', () => {
    const copy = getLineupHeroCopy(
      buildCtx({
        pageId: 'standalone-poll',
        persona: 'invitee-acted',
        myVotedSlotCount: 3,
      }),
    );
    expect(copy.tone).toBe('waiting');
    expect(copy.headline).toMatch(/3/);
  });
});
