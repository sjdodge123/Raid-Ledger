/**
 * Unit gate for `SchedulingRallyService` (ROK-1618).
 *
 * Everything that touches the database is mocked at the helper boundary, so
 * these cases pin ORDER and ARITHMETIC — the two things the integration spec
 * can only observe indirectly:
 *   - the permission refusal happens before the cooldown is armed;
 *   - the cooldown is armed before the audience is ever read (D7);
 *   - a zero-member audience gives the cooldown key back (§3.6);
 *   - `pending === nudged + skipped` across dedup / suppression / throw.
 */
import { ForbiddenException, HttpException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SchedulingRallyService } from './scheduling-rally.service';
import { findMatchById } from '../lineups-match-query.helpers';
import { findLineupPollMeta } from './scheduling-query.helpers';
import {
  findPendingMemberIds,
  loadNudgePollById,
  sendPollNudge,
  type NudgePoll,
} from './scheduling-poll-nudge.helpers';
import { POLL_RALLY_COOLDOWN_SECONDS } from '../lineup-notification.constants';
import type { NotificationService } from '../../notifications/notification.service';
import type { NotificationDedupService } from '../../notifications/notification-dedup.service';

jest.mock('../lineups-match-query.helpers', () => ({
  findMatchById: jest.fn(),
}));
jest.mock('./scheduling-query.helpers', () => ({
  findLineupPollMeta: jest.fn(),
}));
jest.mock('./scheduling-poll-nudge.helpers', () => ({
  findPendingMemberIds: jest.fn(),
  loadNudgePollById: jest.fn(),
  sendPollNudge: jest.fn(),
}));

const mockFindMatchById = findMatchById as jest.MockedFunction<
  typeof findMatchById
>;
const mockFindLineupPollMeta = findLineupPollMeta as jest.MockedFunction<
  typeof findLineupPollMeta
>;
const mockFindPendingMemberIds = findPendingMemberIds as jest.MockedFunction<
  typeof findPendingMemberIds
>;
const mockLoadNudgePollById = loadNudgePollById as jest.MockedFunction<
  typeof loadNudgePollById
>;
const mockSendPollNudge = sendPollNudge as jest.MockedFunction<
  typeof sendPollNudge
>;

const LINEUP_ID = 11;
const MATCH_ID = 42;
const CREATOR_ID = 7;

const POLL: NudgePoll = {
  lineupId: LINEUP_ID,
  matchId: MATCH_ID,
  gameName: 'Deep Rock Galactic',
  hasFutureSlots: true,
  hadSlots: true,
  inDeadlineHandoff: false,
};

describe('SchedulingRallyService (ROK-1618)', () => {
  let service: SchedulingRallyService;
  let notificationService: { create: jest.Mock };
  let dedupService: { checkAndMarkSent: jest.Mock; releaseKey: jest.Mock };
  /** Every helper/dedup call in the order it happened. */
  let order: string[];

  function setMatch(overrides: Record<string, unknown> = {}): void {
    mockFindMatchById.mockImplementation((() => {
      order.push('findMatchById');
      return Promise.resolve([
        {
          id: MATCH_ID,
          lineupId: LINEUP_ID,
          status: 'scheduling',
          linkedEventId: null,
          includeSchedulingPhase: true,
          ...overrides,
        },
      ]);
    }) as unknown as typeof findMatchById);
  }

  function setLineup(overrides: Record<string, unknown> = {}): void {
    mockFindLineupPollMeta.mockImplementation((() => {
      order.push('findLineupPollMeta');
      return Promise.resolve([
        {
          id: LINEUP_ID,
          status: 'decided',
          visibility: 'public',
          createdBy: CREATOR_ID,
          phaseDeadline: null,
          includeSchedulingPhase: true,
          phaseDurationOverride: null,
          ...overrides,
        },
      ]);
    }) as unknown as typeof findLineupPollMeta);
  }

  function setAudience(userIds: number[]): void {
    mockFindPendingMemberIds.mockImplementation(() => {
      order.push('findPendingMemberIds');
      return Promise.resolve(userIds);
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    order = [];
    notificationService = { create: jest.fn() };
    dedupService = {
      checkAndMarkSent: jest.fn().mockImplementation(() => {
        order.push('checkAndMarkSent');
        return Promise.resolve(false);
      }),
      releaseKey: jest.fn().mockImplementation(() => {
        order.push('releaseKey');
        return Promise.resolve();
      }),
    };
    service = new SchedulingRallyService(
      {} as PostgresJsDatabase<never>,
      notificationService as unknown as NotificationService,
      dedupService as unknown as NotificationDedupService,
    );
    setMatch();
    setLineup();
    setAudience([]);
    mockLoadNudgePollById.mockImplementation(() => {
      order.push('loadNudgePollById');
      return Promise.resolve(POLL);
    });
    mockSendPollNudge.mockResolvedValue({ dispatched: true, created: true });
  });

  function rally(caller = { id: CREATOR_ID, role: 'member' }) {
    return service.rallyNonVoters(LINEUP_ID, MATCH_ID, caller);
  }

  // ── permission (AC4) ───────────────────────────────────────────────

  it('refuses a plain member with the organiser message, arming no cooldown', async () => {
    await expect(rally({ id: 99, role: 'member' })).rejects.toThrow(
      new ForbiddenException(
        'Only the poll creator or an operator can rally voters',
      ),
    );
    expect(dedupService.checkAndMarkSent).not.toHaveBeenCalled();
    expect(mockFindPendingMemberIds).not.toHaveBeenCalled();
  });

  it.each(['admin', 'operator'])('lets an %s rally a poll they did not create', async (role) => {
    setAudience([501]);
    const res = await rally({ id: 99, role });
    expect(res).toMatchObject({ pending: 1, nudged: 1, skipped: 0 });
  });

  // ── poll lifecycle (D8) ────────────────────────────────────────────

  it('400s when the poll is no longer accepting votes', async () => {
    setMatch({ status: 'scheduled' });

    await expect(rally()).rejects.toMatchObject({
      status: 400,
      message: 'This poll is no longer accepting votes',
    });
    expect(dedupService.checkAndMarkSent).not.toHaveBeenCalled();
  });

  // ── cooldown (D3/D7) ───────────────────────────────────────────────

  it('429s inside the cooldown window without reading the audience', async () => {
    dedupService.checkAndMarkSent.mockResolvedValue(true);

    const err = await rally().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).message).toBe(
      'You rallied this poll recently — try again later',
    );
    expect(mockFindPendingMemberIds).not.toHaveBeenCalled();
    expect(mockSendPollNudge).not.toHaveBeenCalled();
  });

  it('arms the per-poll cooldown key BEFORE resolving or notifying anyone', async () => {
    setAudience([501]);

    const res = await rally();

    expect(dedupService.checkAndMarkSent).toHaveBeenCalledWith(
      `sched-poll-rally-cooldown:${MATCH_ID}`,
      POLL_RALLY_COOLDOWN_SECONDS,
    );
    expect(order.indexOf('checkAndMarkSent')).toBeLessThan(
      order.indexOf('findPendingMemberIds'),
    );
    expect(Date.parse(res.cooldownUntil)).toBeGreaterThan(Date.now());
  });

  // ── empty audience refund (§3.6) ───────────────────────────────────

  it('refunds the cooldown and reports pending 0 when nobody owes a vote', async () => {
    setAudience([]);

    const res = await rally();

    expect(res).toMatchObject({ pending: 0, nudged: 0, skipped: 0 });
    expect(dedupService.releaseKey).toHaveBeenCalledWith(
      `sched-poll-rally-cooldown:${MATCH_ID}`,
    );
    expect(mockSendPollNudge).not.toHaveBeenCalled();
  });

  it('treats an audience of only the actor as empty (never self-nudges)', async () => {
    setAudience([CREATOR_ID]);

    const res = await rally();

    expect(res.pending).toBe(0);
    expect(mockSendPollNudge).not.toHaveBeenCalled();
    expect(dedupService.releaseKey).toHaveBeenCalled();
  });

  // ── counting (AC3) ─────────────────────────────────────────────────

  it('counts a dedup skip, a suppressed DM, a throw and a send so pending === nudged + skipped', async () => {
    setAudience([501, 502, 503, 504, CREATOR_ID]);
    mockSendPollNudge
      // 501 — shared 24h key already claimed by the cron.
      .mockResolvedValueOnce({ dispatched: false, created: false })
      // 502 — preferences suppressed the DM.
      .mockResolvedValueOnce({ dispatched: true, created: false })
      // 503 — dispatch blew up; must not fail the whole rally.
      .mockRejectedValueOnce(new Error('discord down'))
      // 504 — a real send.
      .mockResolvedValueOnce({ dispatched: true, created: true });

    const res = await rally();

    expect(res.pending).toBe(4);
    expect(res.nudged).toBe(1);
    expect(res.skipped).toBe(3);
    expect(res.pending).toBe(res.nudged + res.skipped);
    expect(mockSendPollNudge).toHaveBeenCalledTimes(4);
    expect(dedupService.releaseKey).not.toHaveBeenCalled();
  });

  it('404s when the poll stopped being nudgeable after the guards passed', async () => {
    mockLoadNudgePollById.mockResolvedValue(null);

    await expect(rally()).rejects.toMatchObject({
      status: 404,
      message: 'Match not found',
    });
  });

  it('404s a matchId that belongs to another lineup (ROK-1306)', async () => {
    setMatch({ lineupId: LINEUP_ID + 1 });

    await expect(rally()).rejects.toMatchObject({
      status: 404,
      message: 'Match not found in this lineup',
    });
  });
});
