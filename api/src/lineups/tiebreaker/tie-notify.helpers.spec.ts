import type { Logger } from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import type * as schema from '../../drizzle/schema';
import {
  notifyTieDecided,
  notifyTieDetected,
  notifyTieExpired,
} from '../lineup-notification-tie.helpers';
import { countOwnersPerGame } from '../lineups-enrichment.helpers';
import { loadExpectedVoters } from '../quorum/quorum-voters.helpers';
import {
  announceTieDecided,
  announceTieDetected,
  announceTieExpired,
} from './tie-notify.helpers';

jest.mock('../lineup-notification-tie.helpers', () => ({
  notifyTieDecided: jest.fn(),
  notifyTieDetected: jest.fn(),
  notifyTieExpired: jest.fn(),
}));
jest.mock('../quorum/quorum-voters.helpers', () => ({
  loadExpectedVoters: jest.fn(),
}));
jest.mock('../lineups-enrichment.helpers', () => ({
  countOwnersPerGame: jest.fn(),
}));

type LineupRow = typeof schema.communityLineups.$inferSelect;

const TIE = { tiedGameIds: [7, 9], voteCount: 1 };
const DEPS = { marker: 'orchestration-deps' } as never;
const INFO = {
  id: 42,
  title: 'Friday',
  visibility: 'public',
  channelOverrideId: null,
  phaseDeadline: null,
};

function lineup(over: Partial<LineupRow> = {}): LineupRow {
  return {
    id: 42,
    title: 'Friday',
    visibility: 'public',
    channelOverrideId: null,
    phaseDeadline: null,
    tiePickGameId: null,
    tiePickBy: null,
    ...over,
  } as LineupRow;
}

describe('tie-notify helpers (ROK-1374 — the best-effort edges)', () => {
  let logger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = { warn: jest.fn() } as unknown as Logger;
  });

  it('detected: forwards the lineup info and the tie to the notifier', async () => {
    await announceTieDetected(DEPS, logger, lineup(), TIE);

    expect(notifyTieDetected).toHaveBeenCalledWith(DEPS, INFO, TIE);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('detected: a failing notifier is logged, never thrown into the job', async () => {
    jest.mocked(notifyTieDetected).mockRejectedValue(new Error('discord down'));

    await expect(
      announceTieDetected(DEPS, logger, lineup(), TIE),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('discord down'),
    );
  });

  it('decided: names the picked game, the picker, and ROSTER-scoped ownership', async () => {
    const db: MockDb = createDrizzleMock();
    db.limit
      .mockResolvedValueOnce([{ id: 9, name: 'Valheim' }])
      .mockResolvedValueOnce([{ username: 'roknua', displayName: 'Roknua' }]);
    jest.mocked(loadExpectedVoters).mockResolvedValue([1, 2, 3]);
    jest.mocked(countOwnersPerGame).mockResolvedValue(new Map([[9, 2]]));

    await announceTieDecided(
      DEPS,
      db as never,
      logger,
      lineup({ tiePickGameId: 9, tiePickBy: 5 }),
    );

    expect(countOwnersPerGame).toHaveBeenCalledWith(db, [9], [1, 2, 3]);
    expect(notifyTieDecided).toHaveBeenCalledWith(
      DEPS,
      INFO,
      { id: 9, name: 'Valheim' },
      'Roknua',
      { count: 2, rosterSize: 3 },
      // The picker's id rides along so they are not DM'd about their own pick.
      5,
    );
  });

  it('decided: with no pick on the row there is nothing to announce', async () => {
    const db = createDrizzleMock();

    await announceTieDecided(DEPS, db as never, logger, lineup());

    expect(notifyTieDecided).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('expired: forwards the lineup info and swallows a failure', async () => {
    jest.mocked(notifyTieExpired).mockRejectedValueOnce(new Error('boom'));

    await expect(
      announceTieExpired(DEPS, logger, lineup()),
    ).resolves.toBeUndefined();

    expect(notifyTieExpired).toHaveBeenCalledWith(DEPS, INFO);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
