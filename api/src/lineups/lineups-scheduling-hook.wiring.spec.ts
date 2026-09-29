/**
 * ROK-1473 — every flip site announces the scheduling phase.
 *
 * CONFIRMED FAILING on the branch base: `runMatchingAlgorithm`,
 * `runBandwagonJoin` and `runAdvanceMatch` write `status: 'scheduling'` (via
 * `buildMatchesForLineup` / `promoteMatch`) and return without telling the
 * Discord layer, so no poll card is ever posted for a community lineup.
 *
 * These pins hold the wiring, not the posting: the listener that turns the
 * event into an embed is pinned in
 * `scheduling/scheduling-poll-embed.service.initial-post.spec.ts`.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { LINEUP_MATCH_EVENTS } from './lineups-scheduling-hook.helpers';
import { runMatchingAlgorithm } from './lineups-lifecycle.helpers';
import {
  runBandwagonJoin,
  runAdvanceMatch,
} from './lineups-match-actions.helpers';
import { buildMatchesForLineup } from './lineups-matching.helpers';
import {
  executeBandwagonJoin,
  advanceMatch as advanceMatchHelper,
} from './lineups-bandwagon.helpers';
import { findLineupById } from './lineups-query.helpers';
import { assertUserCanParticipate } from './lineups-eligibility.helpers';

jest.mock('./lineups-matching.helpers', () => ({
  buildMatchesForLineup: jest.fn(),
}));
jest.mock('./lineups-bandwagon.helpers', () => ({
  executeBandwagonJoin: jest.fn(),
  advanceMatch: jest.fn(),
}));
jest.mock('./lineups-notify-hooks.helpers', () => ({
  fireSchedulingOpen: jest.fn(),
}));
jest.mock('./lineups-query.helpers', () => ({
  findLineupById: jest.fn().mockResolvedValue([{ id: 1, status: 'decided' }]),
}));
jest.mock('./lineups-eligibility.helpers', () => ({
  assertUserCanParticipate: jest.fn().mockResolvedValue(undefined),
}));

const LINEUP_ID = 1;
const MATCH_ID = 55;
const db = {} as never;

describe('scheduling-phase announcements (ROK-1473)', () => {
  let emit: jest.Mock;
  let events: EventEmitter2;
  let logger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    (findLineupById as jest.Mock).mockResolvedValue([
      { id: LINEUP_ID, status: 'decided' },
    ]);
    (assertUserCanParticipate as jest.Mock).mockResolvedValue(undefined);
    emit = jest.fn().mockReturnValue(true);
    events = { emit } as unknown as EventEmitter2;
    logger = new Logger('spec');
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  /** The dependency bundle `LineupsService` hands the match actions. */
  function matchActionDeps() {
    return {
      db,
      lineupNotifications: {} as never,
      logger,
      eventEmitter: events,
    };
  }

  /** Match ids announced as having entered scheduling, in emit order. */
  function announcedMatchIds(): number[] {
    return emit.mock.calls
      .filter(([name]) => name === LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING)
      .map(([, payload]) => (payload as { matchId: number }).matchId);
  }

  /** Orphaned-card payloads emitted after the matching pass (TDB:571). */
  function orphanedCardEmits(): unknown[] {
    return emit.mock.calls
      .filter(([name]) => name === LINEUP_MATCH_EVENTS.POLL_CARDS_ORPHANED)
      .map(([, payload]) => payload);
  }

  /** What `buildMatchesForLineup` resolves with. */
  function built(
    schedulingMatchIds: number[],
    orphanedCards: { channelId: string; messageId: string }[] = [],
  ) {
    return { schedulingMatchIds, orphanedCards };
  }

  describe('runMatchingAlgorithm (voting → decided, tiebreaker resolve)', () => {
    it('announces every match the pass moved into scheduling', async () => {
      (buildMatchesForLineup as jest.Mock).mockResolvedValue(built([11, 12]));

      await runMatchingAlgorithm(db, LINEUP_ID, logger, events);

      expect(announcedMatchIds()).toEqual([11, 12]);
    });

    it('stays silent when no match cleared the threshold', async () => {
      (buildMatchesForLineup as jest.Mock).mockResolvedValue(built([]));

      await runMatchingAlgorithm(db, LINEUP_ID, logger, events);

      expect(announcedMatchIds()).toEqual([]);
    });

    it('stays silent when the matching pass failed', async () => {
      (buildMatchesForLineup as jest.Mock).mockRejectedValue(
        new Error('matching blew up'),
      );

      await expect(
        runMatchingAlgorithm(db, LINEUP_ID, logger, events),
      ).resolves.toBeUndefined();
      expect(announcedMatchIds()).toEqual([]);
      expect(orphanedCardEmits()).toEqual([]);
    });

    it('hands the cards a re-decide wiped to the Discord layer (TDB:571)', async () => {
      const card = { channelId: 'chan-1', messageId: 'msg-1' };
      (buildMatchesForLineup as jest.Mock).mockResolvedValue(
        built([11], [card]),
      );

      await runMatchingAlgorithm(db, LINEUP_ID, logger, events);

      expect(orphanedCardEmits()).toEqual([{ cards: [card] }]);
      expect(announcedMatchIds()).toEqual([11]);
    });

    it('emits no orphan event when the wipe removed no card', async () => {
      (buildMatchesForLineup as jest.Mock).mockResolvedValue(built([11]));

      await runMatchingAlgorithm(db, LINEUP_ID, logger, events);

      expect(orphanedCardEmits()).toEqual([]);
    });
  });

  describe('runBandwagonJoin (threshold reached by a late joiner)', () => {
    it('announces the promoted match', async () => {
      (executeBandwagonJoin as jest.Mock).mockResolvedValue({
        matchId: MATCH_ID,
        promoted: true,
        newMemberCount: 4,
      });

      await runBandwagonJoin(matchActionDeps(), LINEUP_ID, MATCH_ID, 9);

      expect(announcedMatchIds()).toEqual([MATCH_ID]);
    });

    it('stays silent when the join did not promote the match', async () => {
      (executeBandwagonJoin as jest.Mock).mockResolvedValue({
        matchId: MATCH_ID,
        promoted: false,
        newMemberCount: 2,
      });

      await runBandwagonJoin(matchActionDeps(), LINEUP_ID, MATCH_ID, 9);

      expect(announcedMatchIds()).toEqual([]);
    });
  });

  describe('runAdvanceMatch (operator promotion)', () => {
    it('announces the promoted match', async () => {
      (advanceMatchHelper as jest.Mock).mockResolvedValue({ promoted: true });

      await runAdvanceMatch(matchActionDeps(), LINEUP_ID, MATCH_ID);

      expect(announcedMatchIds()).toEqual([MATCH_ID]);
    });
  });
});
