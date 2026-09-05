/**
 * ROK-1374 (A2a) — the reversible GAME pick.
 *
 * The pick is a GAME, not a mode (LEAD CORRECTION 2026-09-05): picking claims
 * the SAME grace window a ready quorum claims, and the grace job then runs the
 * ordinary `voting → decided` transition with the picked game. Nothing here
 * chooses a winner on its own — operator answer Q2.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

jest.mock('../lineups-auto-advance.helpers', () => ({
  ...jest.requireActual('../lineups-auto-advance.helpers'),
  claimGraceWindow: jest.fn(),
}));

import { claimGraceWindow } from '../lineups-auto-advance.helpers';
import {
  assertCanPickTiebreaker,
  pickTieGame,
  undoTiePick,
  type TiePickDeps,
} from './tie-pick.helpers';

const CREATOR = { id: 11, role: 'member' as const };
const OPERATOR = { id: 22, role: 'operator' as const };
const ADMIN = { id: 33, role: 'admin' as const };
const VOTER = { id: 44, role: 'member' as const };

/** A voting lineup with an armed tie hold on games 7 and 9. */
function heldLineup(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    status: 'voting',
    createdBy: CREATOR.id,
    activeTiebreakerId: null,
    pendingAdvanceAt: null,
    phaseDeadline: null,
    tieDetectedAt: new Date('2026-09-01T00:00:00Z'),
    tieGameIds: [7, 9],
    tieVoteCount: 3,
    tieExpiresAt: new Date('2026-09-08T00:00:00Z'),
    tieExpiredAt: null,
    tiePickGameId: null,
    tiePickAt: null,
    tiePickBy: null,
    tieAnnounceChannelId: null,
    tieAnnounceMessageId: null,
    ...overrides,
  } as never;
}

describe('ROK-1374 tie pick', () => {
  let db: MockDb;
  let deps: TiePickDeps;
  let phaseQueue: {
    scheduleGraceAdvance: jest.Mock;
    cancelGraceAdvance: jest.Mock;
  };
  let gateway: { emitGraceScheduled: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDrizzleMock();
    // `readTieHold` re-reads the row through `.limit(1)`.
    db.limit.mockResolvedValue([heldLineup({ tiePickGameId: 7 })]);
    // The undo's conditional UPDATE reports the row it cleared.
    db.returning.mockResolvedValue([{ id: 42 }]);
    (claimGraceWindow as jest.Mock).mockResolvedValue(
      new Date('2026-09-01T00:05:00Z'),
    );
    phaseQueue = {
      scheduleGraceAdvance: jest.fn(),
      cancelGraceAdvance: jest.fn(),
    };
    gateway = { emitGraceScheduled: jest.fn() };
    deps = {
      db: db as never,
      // No stored value → the helper falls back to the 5min ROK-1253 default.
      settings: { get: jest.fn().mockResolvedValue(null) } as never,
      phaseQueue: phaseQueue as never,
      lineupsGateway: gateway as never,
      logger: new Logger('test'),
    };
  });

  // D15: "creator" is a ROW fact, so it cannot be expressed by @Roles().
  describe('assertCanPickTiebreaker', () => {
    it.each([
      ['the lineup creator on role member', CREATOR],
      ['an operator', OPERATOR],
      ['an admin', ADMIN],
    ])('allows %s', (_label, user) => {
      expect(() => assertCanPickTiebreaker(heldLineup(), user)).not.toThrow();
    });

    it('rejects a plain roster voter with 403', () => {
      expect(() => assertCanPickTiebreaker(heldLineup(), VOTER)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('pickTieGame', () => {
    it('rejects a voter who is neither creator nor operator', async () => {
      await expect(pickTieGame(deps, heldLineup(), VOTER, 7)).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.set).not.toHaveBeenCalled();
    });

    it('400s NO_TIE_HOLD when the lineup is not on a tie hold', async () => {
      const lineup = heldLineup({ tieDetectedAt: null, tieGameIds: null });
      await expect(pickTieGame(deps, lineup, CREATOR, 7)).rejects.toThrow(
        new BadRequestException('NO_TIE_HOLD'),
      );
    });

    it('400s when the chosen game is not one of the tied games', async () => {
      await expect(pickTieGame(deps, heldLineup(), CREATOR, 8)).rejects.toThrow(
        new BadRequestException('GAME_NOT_TIED'),
      );
    });

    it('409s when a tiebreaker mode is already running', async () => {
      const lineup = heldLineup({ activeTiebreakerId: 5 });
      await expect(pickTieGame(deps, lineup, CREATOR, 7)).rejects.toThrow(
        ConflictException,
      );
    });

    it('409s TIE_HOLD_EXPIRED on a hold the sweep already expired (D13)', async () => {
      const lineup = heldLineup({
        status: 'archived',
        tieExpiredAt: new Date('2026-09-09T00:00:00Z'),
      });
      await expect(pickTieGame(deps, lineup, CREATOR, 7)).rejects.toThrow(
        new ConflictException('TIE_HOLD_EXPIRED'),
      );
      expect(db.set).not.toHaveBeenCalled();
      expect(claimGraceWindow).not.toHaveBeenCalled();
    });

    it('409s TIE_PICK_FINAL when the row moved on between the read and the write', async () => {
      // The CAS matched nothing: the grace advance or the sweep got there first.
      db.returning.mockResolvedValue([]);
      await expect(pickTieGame(deps, heldLineup(), CREATOR, 7)).rejects.toThrow(
        new ConflictException('TIE_PICK_FINAL'),
      );
      expect(claimGraceWindow).not.toHaveBeenCalled();
    });

    it('409s TIE_PICK_FINAL once the lineup has left voting', async () => {
      const lineup = heldLineup({ status: 'decided' });
      await expect(pickTieGame(deps, lineup, CREATOR, 7)).rejects.toThrow(
        new ConflictException('TIE_PICK_FINAL'),
      );
      expect(db.set).not.toHaveBeenCalled();
    });

    it('stamps the pick and claims the grace window like a ready quorum', async () => {
      const result = await pickTieGame(deps, heldLineup(), CREATOR, 7);

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ tiePickGameId: 7, tiePickBy: CREATOR.id }),
      );
      expect(claimGraceWindow).toHaveBeenCalledWith(db, 42, 'voting', 300_000);
      expect(phaseQueue.scheduleGraceAdvance).toHaveBeenCalledWith(42, 300_000);
      expect(gateway.emitGraceScheduled).toHaveBeenCalledWith(
        42,
        new Date('2026-09-01T00:05:00Z'),
      );
      expect(result?.pickGameId).toBe(7);
    });

    it('re-pick with a claim already pending overwrites the game, keeps the claim', async () => {
      (claimGraceWindow as jest.Mock).mockResolvedValue(null);

      await pickTieGame(deps, heldLineup({ tiePickGameId: 9 }), CREATOR, 7);

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ tiePickGameId: 7 }),
      );
      expect(phaseQueue.scheduleGraceAdvance).not.toHaveBeenCalled();
      expect(gateway.emitGraceScheduled).not.toHaveBeenCalled();
    });
  });

  describe('undoTiePick', () => {
    it('clears the three pick columns, releases the claim and cancels the job', async () => {
      db.limit.mockResolvedValue([heldLineup()]);
      const lineup = heldLineup({
        tiePickGameId: 7,
        tiePickAt: new Date(),
        tiePickBy: CREATOR.id,
        pendingAdvanceAt: new Date(),
      });

      const result = await undoTiePick(deps, lineup, CREATOR);

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          tiePickGameId: null,
          tiePickAt: null,
          tiePickBy: null,
          pendingAdvanceAt: null,
        }),
      );
      expect(phaseQueue.cancelGraceAdvance).toHaveBeenCalledWith(42);
      expect(result?.pickGameId).toBeNull();
      // The clear is a CAS on `status = 'voting' AND tie_pick_game_id IS NOT
      // NULL` — the write, not the earlier read, decides whether undo wins.
      const text = new PgDialect().sqlToQuery(db.where.mock.calls[0][0]).sql;
      expect(text).toContain('"status" = $');
      expect(text).toContain('"tie_pick_game_id" is not null');
    });

    it('409s TIE_PICK_FINAL when the grace job landed between the read and the clear', async () => {
      const lineup = heldLineup({
        tiePickGameId: 7,
        tiePickAt: new Date(),
        tiePickBy: CREATOR.id,
        pendingAdvanceAt: new Date(),
      });
      // The conditional UPDATE matched nothing: the row is no longer `voting`.
      db.returning.mockResolvedValue([]);

      await expect(undoTiePick(deps, lineup, CREATOR)).rejects.toThrow(
        new ConflictException('TIE_PICK_FINAL'),
      );
      expect(phaseQueue.cancelGraceAdvance).not.toHaveBeenCalled();
    });

    it('400s NO_PICK when nothing has been picked', async () => {
      await expect(undoTiePick(deps, heldLineup(), CREATOR)).rejects.toThrow(
        new BadRequestException('NO_PICK'),
      );
      expect(phaseQueue.cancelGraceAdvance).not.toHaveBeenCalled();
    });

    it('409s TIE_PICK_FINAL once the advance has fired and the lineup is decided', async () => {
      const lineup = heldLineup({
        status: 'decided',
        tiePickGameId: 7,
        tiePickAt: new Date(),
        tiePickBy: CREATOR.id,
      });

      await expect(undoTiePick(deps, lineup, CREATOR)).rejects.toThrow(
        new ConflictException('TIE_PICK_FINAL'),
      );
      expect(db.set).not.toHaveBeenCalled();
    });

    it('rejects a plain roster voter with 403', async () => {
      const lineup = heldLineup({ tiePickGameId: 7, tiePickAt: new Date() });
      await expect(undoTiePick(deps, lineup, VOTER)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
