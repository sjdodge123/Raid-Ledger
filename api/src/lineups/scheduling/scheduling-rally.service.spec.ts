/**
 * Unit gate for `SchedulingRallyService` (ROK-1618).
 *
 * Everything that touches the database is mocked at the helper boundary, so
 * these cases pin ORDER and ARITHMETIC — the two things the integration spec
 * can only observe indirectly:
 *   - the permission refusal happens before the cooldown is armed;
 *   - the LEADING slot is resolved before the cooldown is armed, so a poll
 *     with no leader cannot burn the organiser's 6h window;
 *   - the cooldown is armed before the audience is ever read (D7);
 *   - the audience is the LEADING slot's non-answerers, not the cron's set;
 *   - a zero-member audience gives the cooldown key back (§3.6);
 *   - `pending === nudged + skipped` across dedup / suppression / throw.
 */
import { ForbiddenException, HttpException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SchedulingRallyService } from './scheduling-rally.service';
import { findMatchById } from '../lineups-match-query.helpers';
import { findLineupPollMeta } from './scheduling-query.helpers';
import {
  findLeadingFutureSlot,
  type LeadingSlot,
} from './scheduling-poll-expiry.helpers';
import {
  countPollMembers,
  findLeaderPendingMemberIds,
  sendRallyDm,
} from './scheduling-rally.helpers';
import {
  loadNudgePollById,
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
jest.mock('./scheduling-poll-expiry.helpers', () => ({
  findLeadingFutureSlot: jest.fn(),
}));
jest.mock('./scheduling-poll-nudge.helpers', () => ({
  loadNudgePollById: jest.fn(),
}));
jest.mock('./scheduling-rally.helpers', () => ({
  countPollMembers: jest.fn(),
  findLeaderPendingMemberIds: jest.fn(),
  sendRallyDm: jest.fn(),
  // Not mocked: the key formats are the dedup contract, so the spec asserts
  // against the REAL strings rather than a stub's invention.
  rallyCooldownKey: (matchId: number): string =>
    `sched-poll-rally-cooldown:${matchId}`,
  rallyMemberKey: (matchId: number, slotId: number, userId: number): string =>
    `sched-poll-rally:${matchId}:${slotId}:${userId}`,
}));

const mockFindMatchById = findMatchById as jest.MockedFunction<
  typeof findMatchById
>;
const mockFindLineupPollMeta = findLineupPollMeta as jest.MockedFunction<
  typeof findLineupPollMeta
>;
const mockFindLeadingFutureSlot = findLeadingFutureSlot as jest.MockedFunction<
  typeof findLeadingFutureSlot
>;
const mockFindLeaderPendingMemberIds =
  findLeaderPendingMemberIds as jest.MockedFunction<
    typeof findLeaderPendingMemberIds
  >;
const mockCountPollMembers = countPollMembers as jest.MockedFunction<
  typeof countPollMembers
>;
const mockLoadNudgePollById = loadNudgePollById as jest.MockedFunction<
  typeof loadNudgePollById
>;
const mockSendRallyDm = sendRallyDm as jest.MockedFunction<typeof sendRallyDm>;

const LINEUP_ID = 11;
const MATCH_ID = 42;
const SLOT_ID = 9;
const CREATOR_ID = 7;
const COOLDOWN_KEY = `sched-poll-rally-cooldown:${MATCH_ID}`;

const POLL: NudgePoll = {
  lineupId: LINEUP_ID,
  matchId: MATCH_ID,
  gameName: 'Deep Rock Galactic',
  hasFutureSlots: true,
  hadSlots: true,
  inDeadlineHandoff: false,
};

const LEADER: LeadingSlot = {
  slotId: SLOT_ID,
  proposedTime: '2026-10-01T19:00:00.000Z',
  voteCount: 3,
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
    mockFindLeaderPendingMemberIds.mockImplementation(() => {
      order.push('findLeaderPendingMemberIds');
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
    mockFindLeadingFutureSlot.mockImplementation(() => {
      order.push('findLeadingFutureSlot');
      return Promise.resolve(LEADER);
    });
    mockCountPollMembers.mockResolvedValue(4);
    mockLoadNudgePollById.mockImplementation(() => {
      order.push('loadNudgePollById');
      return Promise.resolve(POLL);
    });
    mockSendRallyDm.mockResolvedValue({ dispatched: true, created: true });
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
    expect(mockFindLeaderPendingMemberIds).not.toHaveBeenCalled();
  });

  it.each(['admin', 'operator'])(
    'lets an %s rally a poll they did not create',
    async (role) => {
      setAudience([501]);
      const res = await rally({ id: 99, role });
      expect(res).toMatchObject({ pending: 1, nudged: 1, skipped: 0 });
    },
  );

  // ── poll lifecycle (D8) ────────────────────────────────────────────

  it('400s when the poll is no longer accepting votes', async () => {
    setMatch({ status: 'scheduled' });

    await expect(rally()).rejects.toMatchObject({
      status: 400,
      message: 'This poll is no longer accepting votes',
    });
    expect(dedupService.checkAndMarkSent).not.toHaveBeenCalled();
  });

  // ── leading slot (the operator-rejected bug) ───────────────────────

  it('400s without burning the cooldown when no time is leading yet', async () => {
    mockFindLeadingFutureSlot.mockResolvedValue(null);

    await expect(rally()).rejects.toMatchObject({
      status: 400,
      message: 'No leading time yet — no time has more yes votes than no votes',
    });
    expect(dedupService.checkAndMarkSent).not.toHaveBeenCalled();
    expect(dedupService.releaseKey).not.toHaveBeenCalled();
    expect(mockFindLeaderPendingMemberIds).not.toHaveBeenCalled();
  });

  it('resolves the leader after the guards and before arming the cooldown', async () => {
    setAudience([501]);

    await rally();

    expect(order.indexOf('findMatchById')).toBeLessThan(
      order.indexOf('findLeadingFutureSlot'),
    );
    expect(order.indexOf('findLeadingFutureSlot')).toBeLessThan(
      order.indexOf('checkAndMarkSent'),
    );
  });

  it('asks for non-answerers on the LEADING slot, not on any future slot', async () => {
    setAudience([501]);

    await rally();

    expect(mockFindLeaderPendingMemberIds).toHaveBeenCalledWith(
      expect.anything(),
      MATCH_ID,
      SLOT_ID,
    );
  });

  it('hands the leader and the member count to every DM', async () => {
    setAudience([501]);
    mockCountPollMembers.mockResolvedValue(4);

    await rally();

    expect(mockSendRallyDm).toHaveBeenCalledWith(
      expect.anything(),
      POLL,
      LEADER,
      4,
      501,
    );
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
    expect(mockFindLeaderPendingMemberIds).not.toHaveBeenCalled();
    expect(mockSendRallyDm).not.toHaveBeenCalled();
  });

  it('never releases the key on a 429 — the window belongs to the other press', async () => {
    dedupService.checkAndMarkSent.mockResolvedValue(true);

    await expect(rally()).rejects.toBeInstanceOf(HttpException);

    expect(dedupService.releaseKey).not.toHaveBeenCalled();
  });

  it('arms the per-poll cooldown key BEFORE resolving or notifying anyone', async () => {
    setAudience([501]);

    const res = await rally();

    expect(dedupService.checkAndMarkSent).toHaveBeenCalledWith(
      COOLDOWN_KEY,
      POLL_RALLY_COOLDOWN_SECONDS,
    );
    expect(order.indexOf('checkAndMarkSent')).toBeLessThan(
      order.indexOf('findLeaderPendingMemberIds'),
    );
    expect(Date.parse(res.cooldownUntil)).toBeGreaterThan(Date.now());
  });

  // ── empty audience refund (§3.6) ───────────────────────────────────

  it('refunds the cooldown and reports pending 0 when nobody owes an answer', async () => {
    setAudience([]);

    const res = await rally();

    expect(res).toMatchObject({ pending: 0, nudged: 0, skipped: 0 });
    expect(dedupService.releaseKey).toHaveBeenCalledWith(COOLDOWN_KEY);
    expect(mockSendRallyDm).not.toHaveBeenCalled();
  });

  it('treats an audience of only the actor as empty (never self-nudges)', async () => {
    setAudience([CREATOR_ID]);

    const res = await rally();

    expect(res.pending).toBe(0);
    expect(mockSendRallyDm).not.toHaveBeenCalled();
    expect(dedupService.releaseKey).toHaveBeenCalled();
  });

  // ── counting (AC3) ─────────────────────────────────────────────────

  it('counts a dedup skip, a suppressed DM, a throw and a send so pending === nudged + skipped', async () => {
    setAudience([501, 502, 503, 504, CREATOR_ID]);
    mockSendRallyDm
      // 501 — the rally's own 6h key is already claimed for this slot.
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
    expect(mockSendRallyDm).toHaveBeenCalledTimes(4);
    // The cooldown stands — a rally that reached dispatch used its window.
    expect(dedupService.releaseKey).not.toHaveBeenCalledWith(COOLDOWN_KEY);
    // Only 503's dispatch threw, so only 503's slot-scoped 6h key is handed
    // back; a deduped (501) or preference-suppressed (502) member keeps theirs.
    expect(dedupService.releaseKey).toHaveBeenCalledTimes(1);
    expect(dedupService.releaseKey).toHaveBeenCalledWith(
      `sched-poll-rally:${MATCH_ID}:${SLOT_ID}:503`,
    );
  });

  it('keeps the rally alive when releasing a failed member key also throws', async () => {
    setAudience([501]);
    mockSendRallyDm.mockRejectedValueOnce(new Error('discord down'));
    dedupService.releaseKey.mockRejectedValue(new Error('redis down'));

    const res = await rally();

    expect(res).toMatchObject({ pending: 1, nudged: 0, skipped: 1 });
  });

  it('404s when the poll stopped being nudgeable after the guards passed', async () => {
    mockLoadNudgePollById.mockResolvedValue(null);

    await expect(rally()).rejects.toMatchObject({
      status: 404,
      message: 'Match not found',
    });
    // The organiser must not lose six hours to a poll nobody was DM'd about.
    expect(dedupService.releaseKey).toHaveBeenCalledWith(COOLDOWN_KEY);
  });

  it('releases the cooldown and rethrows when the audience query fails', async () => {
    const boom = new Error('connection terminated unexpectedly');
    mockFindLeaderPendingMemberIds.mockRejectedValue(boom);

    await expect(rally()).rejects.toBe(boom);

    expect(dedupService.releaseKey).toHaveBeenCalledWith(COOLDOWN_KEY);
    expect(mockSendRallyDm).not.toHaveBeenCalled();
  });

  it('rethrows the ORIGINAL error when giving the cooldown back also fails', async () => {
    const boom = new Error('connection terminated unexpectedly');
    mockFindLeaderPendingMemberIds.mockRejectedValue(boom);
    dedupService.releaseKey.mockRejectedValue(new Error('redis down'));

    await expect(rally()).rejects.toBe(boom);
  });

  it('404s a matchId that belongs to another lineup (ROK-1306)', async () => {
    setMatch({ lineupId: LINEUP_ID + 1 });

    await expect(rally()).rejects.toMatchObject({
      status: 404,
      message: 'Match not found in this lineup',
    });
  });
});
