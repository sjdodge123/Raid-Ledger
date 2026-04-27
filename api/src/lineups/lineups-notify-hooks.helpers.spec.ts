/**
 * ROK-1115 — hook-level dispatcher tests for visibility load-through.
 *
 * The four hook helpers in `lineups-notify-hooks.helpers.ts` that fire
 * channel-bound lifecycle notifications must load `visibility` from the
 * `community_lineups` row before calling the service method, mirroring
 * the existing `fireVotingOpen` pattern (line 69-91).
 *
 * Hooks under test:
 *   - fireNominationMilestone
 *   - fireDecidedNotifications
 *   - fireSchedulingOpen
 *   - fireEventCreated
 *
 * For match-based hooks (`fireSchedulingOpen`, `fireEventCreated`), the
 * helper must additionally JOIN the parent lineup's `visibility`.
 */
import type { Logger } from '@nestjs/common';
import {
  fireNominationMilestone,
  fireDecidedNotifications,
  fireSchedulingOpen,
  fireEventCreated,
} from './lineups-notify-hooks.helpers';
import type { LineupNotificationService } from './lineup-notification.service';

// `checkNominationMilestone` and `getEntryDetails` are called by
// fireNominationMilestone. We mock the module so the hook never touches
// the real DB.
jest.mock('./lineups-milestone.helpers', () => ({
  checkNominationMilestone: jest
    .fn()
    .mockResolvedValue({ threshold: 50, entryCount: 5 }),
  getEntryDetails: jest.fn().mockResolvedValue([]),
}));

const LINEUP_ID = 77;
const MATCH_ID = 901;
const PRIVATE_VISIBILITY = 'private' as const;

function makeLogger(): Logger {
  return {
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as Logger;
}

function makeServiceMock(): jest.Mocked<LineupNotificationService> {
  return {
    notifyNominationMilestone: jest.fn().mockResolvedValue(undefined),
    notifyMatchesFound: jest.fn().mockResolvedValue(undefined),
    notifySchedulingOpen: jest.fn().mockResolvedValue(undefined),
    notifyEventCreated: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<LineupNotificationService>;
}

/**
 * Build a Drizzle-shaped mock that supports the chained .select().from()
 * .where().limit() pattern used by both `loadLineupForHook` and
 * `loadSingleMatch`. Each call to `select()` returns a fresh chain seeded
 * with the next response from `responses`.
 */
/**
 * Build a thenable that resolves to `rows` AND also exposes `.limit()` /
 * `.innerJoin()` / `.where()` chains that resolve to the same rows.
 * Drizzle's query builder returns `this`-like objects from each chain method
 * AND those objects are awaitable; replicating both lets the helper await
 * either `.where()` directly or `.where().limit()`.
 */
function buildThenableChain(rows: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  chain.limit = jest.fn().mockResolvedValue(rows);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.innerJoin = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  return chain;
}

function makeMockDb(responses: unknown[][]) {
  const queue = [...responses];
  return {
    select: jest.fn().mockImplementation(() => {
      const rows = queue.shift() ?? [];
      return buildThenableChain(rows);
    }),
    execute: jest.fn().mockResolvedValue([]),
  };
}

/** Wait for the fire-and-forget chain to drain microtasks. */
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await Promise.resolve();
}

describe('lineups-notify-hooks (ROK-1115 visibility load-through)', () => {
  describe('fireNominationMilestone', () => {
    it('loads visibility from the lineup row and passes it to notifyNominationMilestone', async () => {
      const svc = makeServiceMock();
      const logger = makeLogger();
      // findNominatedGames is not used by milestone path, but the hook must
      // fetch visibility before invoking the service method.
      const db = makeMockDb([
        [{ id: LINEUP_ID, title: 'Test', visibility: PRIVATE_VISIBILITY }],
      ]);

      // `db` is typed as a Drizzle instance in production; cast for the test.
      fireNominationMilestone(svc, logger, db as never, LINEUP_ID);
      await flushPromises();

      expect(svc.notifyNominationMilestone).toHaveBeenCalledTimes(1);
      const args = svc.notifyNominationMilestone.mock.calls[0] as unknown[];
      // The 4th argument (after lineupId, threshold, entries) MUST contain
      // a `visibility: 'private'` lineup info object.
      const lineupArg = args[3] as { visibility?: string } | undefined;
      expect(lineupArg).toEqual(
        expect.objectContaining({ visibility: PRIVATE_VISIBILITY }),
      );
    });
  });

  describe('fireDecidedNotifications', () => {
    it('loads visibility from the lineup row and passes it to notifyMatchesFound', async () => {
      const svc = makeServiceMock();
      const logger = makeLogger();
      // Expect TWO db.select calls: one for visibility, one for matches.
      const db = makeMockDb([
        // visibility lookup
        [{ id: LINEUP_ID, title: 'Test', visibility: PRIVATE_VISIBILITY }],
        // matches lookup
        [
          {
            id: MATCH_ID,
            lineupId: LINEUP_ID,
            gameId: 1,
            gameName: 'Game',
            status: 'suggested',
            thresholdMet: true,
            voteCount: 5,
          },
        ],
      ]);

      fireDecidedNotifications(svc, logger, db as never, LINEUP_ID);
      await flushPromises();

      expect(svc.notifyMatchesFound).toHaveBeenCalledTimes(1);
      const args = svc.notifyMatchesFound.mock.calls[0] as unknown[];
      const lineupArg = args[2] as { visibility?: string } | undefined;
      expect(lineupArg).toEqual(
        expect.objectContaining({ visibility: PRIVATE_VISIBILITY }),
      );
    });
  });

  describe('fireSchedulingOpen', () => {
    it('loads parent lineup visibility and passes it to notifySchedulingOpen', async () => {
      const svc = makeServiceMock();
      const logger = makeLogger();
      // Match row first, lineup visibility lookup second (or vice versa).
      // We seed both queues with the data the helper should be reading.
      const db = makeMockDb([
        // match lookup
        [
          {
            id: MATCH_ID,
            lineupId: LINEUP_ID,
            gameId: 1,
            gameName: 'Game',
            status: 'scheduling',
            thresholdMet: true,
            voteCount: 5,
          },
        ],
        // visibility lookup for the parent lineup
        [{ id: LINEUP_ID, visibility: PRIVATE_VISIBILITY }],
      ]);

      fireSchedulingOpen(svc, logger, db as never, MATCH_ID);
      await flushPromises();

      expect(svc.notifySchedulingOpen).toHaveBeenCalledTimes(1);
      const args = svc.notifySchedulingOpen.mock.calls[0] as unknown[];
      const lineupArg = args[1] as { visibility?: string } | undefined;
      expect(lineupArg).toEqual(
        expect.objectContaining({ visibility: PRIVATE_VISIBILITY }),
      );
    });
  });

  describe('fireEventCreated', () => {
    it('loads parent lineup visibility and passes it to notifyEventCreated', async () => {
      const svc = makeServiceMock();
      const logger = makeLogger();
      const eventDate = new Date('2026-04-25T18:00:00Z');
      const db = makeMockDb([
        // match lookup
        [
          {
            id: MATCH_ID,
            lineupId: LINEUP_ID,
            gameId: 1,
            gameName: 'Game',
            status: 'scheduled',
            thresholdMet: true,
            voteCount: 5,
          },
        ],
        // visibility lookup
        [{ id: LINEUP_ID, visibility: PRIVATE_VISIBILITY }],
      ]);

      fireEventCreated(svc, logger, db as never, MATCH_ID, eventDate, 200);
      await flushPromises();

      expect(svc.notifyEventCreated).toHaveBeenCalledTimes(1);
      const args = svc.notifyEventCreated.mock.calls[0];
      // Event-created signature is (match, eventDate, eventId, lineupInfo?).
      // Visibility must be present somewhere in the call args.
      const allArgs = JSON.stringify(args);
      expect(allArgs).toContain(PRIVATE_VISIBILITY);
    });
  });
});
