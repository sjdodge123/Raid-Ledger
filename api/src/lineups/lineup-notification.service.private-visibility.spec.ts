/**
 * ROK-1115 — private-visibility gating for lineup lifecycle notifications.
 *
 * Private Community Lineups must suppress channel embeds and instead DM
 * invitees + creator. This spec covers the four lifecycle methods that
 * currently leak to the bound Discord channel even when visibility='private':
 *   - notifyNominationMilestone
 *   - notifyMatchesFound        (decided-phase tier embed)
 *   - notifySchedulingOpen
 *   - notifyEventCreated
 *
 * The pattern to mirror is `notifyLineupCreated` / `notifyVotingOpen`, which
 * already short-circuit via `routeLineupCreatedIfPrivate` and
 * `routeVotingOpenIfPrivate`.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LineupNotificationService } from './lineup-notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';

// ── Shared mocks (mirror lineup-notification.service.spec.ts) ──────────────

function makeMockDb() {
  return {
    execute: jest.fn().mockResolvedValue([]),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ embedMessageId: null }]),
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

function makeMockNotificationService() {
  return { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
}

function makeMockDedupService() {
  return { checkAndMarkSent: jest.fn().mockResolvedValue(false) };
}

function makeMockBotClient() {
  return {
    sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    editEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    isConnected: jest.fn().mockReturnValue(true),
  };
}

function makeMockSettingsService() {
  return {
    get: jest.fn().mockResolvedValue('chan-lineup'),
    getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    getDiscordBotDefaultChannel: jest.fn().mockResolvedValue('chan-default'),
  };
}

async function createTestModule() {
  const mockDb = makeMockDb();
  const mockNotificationService = makeMockNotificationService();
  const mockDedupService = makeMockDedupService();
  const mockBotClient = makeMockBotClient();
  const mockSettingsService = makeMockSettingsService();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LineupNotificationService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: NotificationDedupService, useValue: mockDedupService },
      { provide: DiscordBotClientService, useValue: mockBotClient },
      { provide: SettingsService, useValue: mockSettingsService },
    ],
  }).compile();

  return {
    service: module.get<LineupNotificationService>(LineupNotificationService),
    mockDb,
    mockNotificationService,
    mockDedupService,
    mockBotClient,
    mockSettingsService,
  };
}

// ── Call wrappers (cast away TDD signature gap) ───────────────────────────
//
// The current service signatures don't accept a `LineupInfo` (or visibility
// override) for these four methods — that's the bug being fixed in ROK-1115.
// We cast through `unknown` so the spec compiles; the dev's job is to widen
// the signatures to accept the lineup/visibility parameter and gate channel
// dispatch on it. Once the gate exists, these tests pass without changes.
type AnyArgs = unknown[];
function callMilestone(
  service: LineupNotificationService,
  ...args: AnyArgs
): Promise<void> {
  return (
    service.notifyNominationMilestone as unknown as (
      ...a: AnyArgs
    ) => Promise<void>
  )(...args);
}
function callMatchesFound(
  service: LineupNotificationService,
  ...args: AnyArgs
): Promise<void> {
  return (
    service.notifyMatchesFound as unknown as (...a: AnyArgs) => Promise<void>
  )(...args);
}
function callSchedulingOpen(
  service: LineupNotificationService,
  ...args: AnyArgs
): Promise<void> {
  return (
    service.notifySchedulingOpen as unknown as (...a: AnyArgs) => Promise<void>
  )(...args);
}
function callEventCreated(
  service: LineupNotificationService,
  ...args: AnyArgs
): Promise<void> {
  return (
    service.notifyEventCreated as unknown as (...a: AnyArgs) => Promise<void>
  )(...args);
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const LINEUP_ID = 42;
const MATCH_ID = 100;
const GAME_NAME = 'Elden Ring';
const GAME_ID = 5;

function makeMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: MATCH_ID,
    lineupId: LINEUP_ID,
    gameId: GAME_ID,
    gameName: GAME_NAME,
    status: 'suggested',
    thresholdMet: true,
    voteCount: 5,
    ...overrides,
  };
}

function makeMember(id: number, displayName = `Player${id}`) {
  return { id, userId: id, displayName, discordId: `discord-${id}` };
}

const milestoneEntry = (name: string, id = 1) => ({
  gameId: id,
  gameName: name,
  nominatorName: 'User',
  coverUrl: null,
});

// ── Drizzle SQL inspection helpers ────────────────────────────────────────
//
// `findInviteeDiscordMembers` queries `community_lineup_invitees` via
// `db.execute(sql\`SELECT ... FROM users ... WHERE u.id IN (SELECT user_id
// FROM community_lineup_invitees ...)\`)`. We assert that one of the
// `mockDb.execute.mock.calls` invocations contains that table name in its
// SQL text — that is the marker that the private-routing helper actually
// loaded invitees (vs the existing match-member fan-outs which JOIN
// `community_lineup_match_members`).
function executeContainsSql(mockDbExecute: jest.Mock, needle: string): boolean {
  for (const [arg] of mockDbExecute.mock.calls) {
    const sqlText = extractSqlText(arg);
    if (sqlText.includes(needle)) return true;
  }
  return false;
}

function extractSqlText(sqlArg: unknown): string {
  if (!sqlArg) return '';
  if (typeof sqlArg === 'string') return sqlArg;
  // Drizzle SQL objects have a `queryChunks` array; toString yields the SQL.
  const obj = sqlArg as { toString?: () => string };
  const stringified =
    typeof obj.toString === 'function' ? obj.toString() : '[object Object]';
  if (stringified !== '[object Object]') return stringified;
  try {
    return JSON.stringify(sqlArg);
  } catch {
    return '';
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('LineupNotificationService — private-visibility gating (ROK-1115)', () => {
  let service: LineupNotificationService;
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockNotificationService: ReturnType<typeof makeMockNotificationService>;
  let mockDedupService: ReturnType<typeof makeMockDedupService>;
  let mockBotClient: ReturnType<typeof makeMockBotClient>;

  beforeEach(async () => {
    const ctx = await createTestModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    mockNotificationService = ctx.mockNotificationService;
    mockDedupService = ctx.mockDedupService;
    mockBotClient = ctx.mockBotClient;
  });

  // ── AC-1: notifyNominationMilestone ──────────────────────────────────────

  describe('notifyNominationMilestone', () => {
    it('does not post the milestone channel embed when lineup is private', async () => {
      const invitees = [makeMember(11), makeMember(12)];
      mockDb.execute.mockResolvedValue(invitees);

      await callMilestone(service, LINEUP_ID, 50, [milestoneEntry('Game A')], {
        visibility: 'private',
      });

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('DMs each invitee + creator with a community_lineup notification', async () => {
      const invitees = [makeMember(11), makeMember(12)];
      mockDb.execute.mockResolvedValue(invitees);

      await callMilestone(service, LINEUP_ID, 50, [milestoneEntry('Game A')], {
        visibility: 'private',
      });

      // The invitee SQL probe must run (proves we routed via the private path,
      // not the existing match-member fan-out which queries a different table).
      expect(
        executeContainsSql(mockDb.execute, 'community_lineup_invitees'),
      ).toBe(true);

      const calls = mockNotificationService.create.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(invitees.length);
      for (const [arg] of calls) {
        expect(arg).toEqual(
          expect.objectContaining({ type: 'community_lineup' }),
        );
      }
    });

    it('still posts the milestone channel embed when visibility is public', async () => {
      await callMilestone(service, LINEUP_ID, 50, [milestoneEntry('Game A')], {
        visibility: 'public',
      });

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('uses a per-invitee dedup key so retries are suppressed', async () => {
      mockDb.execute.mockResolvedValue([makeMember(11)]);

      await callMilestone(service, LINEUP_ID, 50, [milestoneEntry('Game A')], {
        visibility: 'private',
      });

      // Some lineup-* dedup key keyed on lineupId + invitee userId must be checked.
      const dedupKeys = mockDedupService.checkAndMarkSent.mock.calls.map(
        ([k]) => String(k),
      );
      expect(
        dedupKeys.some(
          (k) => k.includes(String(LINEUP_ID)) && k.includes(':11'),
        ),
      ).toBe(true);
    });
  });

  // ── AC-2: notifyMatchesFound (decided-phase tier embed) ──────────────────

  describe('notifyMatchesFound', () => {
    it('does not post the decided-phase tier embed when private', async () => {
      const invitees = [makeMember(11), makeMember(12)];
      mockDb.execute.mockResolvedValue(invitees);

      await callMatchesFound(
        service,
        LINEUP_ID,
        [makeMatch({ thresholdMet: true })],
        { visibility: 'private' },
      );

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('DMs invitees + creator with a community_lineup notification', async () => {
      const invitees = [makeMember(11), makeMember(12)];
      mockDb.execute.mockResolvedValue(invitees);

      await callMatchesFound(
        service,
        LINEUP_ID,
        [makeMatch({ thresholdMet: true })],
        { visibility: 'private' },
      );

      // Invitee SQL probe must run.
      expect(
        executeContainsSql(mockDb.execute, 'community_lineup_invitees'),
      ).toBe(true);

      const inviteeCalls = mockNotificationService.create.mock.calls.filter(
        ([arg]) => invitees.some((m) => m.userId === arg?.userId),
      );
      expect(inviteeCalls.length).toBeGreaterThanOrEqual(invitees.length);
    });

    it('still posts the channel embed when visibility is public', async () => {
      await callMatchesFound(
        service,
        LINEUP_ID,
        [makeMatch({ thresholdMet: true })],
        { visibility: 'public' },
      );

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-3: notifySchedulingOpen ───────────────────────────────────────────

  describe('notifySchedulingOpen', () => {
    it('does not post the per-match scheduling embed when private', async () => {
      const invitees = [makeMember(11), makeMember(12)];
      mockDb.execute.mockResolvedValue(invitees);

      await callSchedulingOpen(service, makeMatch({ status: 'scheduling' }), {
        visibility: 'private',
      });

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('DMs invitees + creator when private', async () => {
      const invitees = [makeMember(11), makeMember(12)];
      mockDb.execute.mockResolvedValue(invitees);

      await callSchedulingOpen(service, makeMatch({ status: 'scheduling' }), {
        visibility: 'private',
      });

      // Invitee SQL probe must run.
      expect(
        executeContainsSql(mockDb.execute, 'community_lineup_invitees'),
      ).toBe(true);

      const inviteeCalls = mockNotificationService.create.mock.calls.filter(
        ([arg]) => invitees.some((m) => m.userId === arg?.userId),
      );
      expect(inviteeCalls.length).toBeGreaterThanOrEqual(invitees.length);
    });

    it('still posts the per-match channel embed when visibility is public', async () => {
      await callSchedulingOpen(service, makeMatch({ status: 'scheduling' }), {
        visibility: 'public',
      });

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-4: notifyEventCreated ─────────────────────────────────────────────

  describe('notifyEventCreated', () => {
    const eventDate = new Date('2026-04-20T18:00:00Z');

    it('does not post the event-created channel embed when private', async () => {
      const invitees = [makeMember(11), makeMember(12)];
      mockDb.execute.mockResolvedValue(invitees);

      await callEventCreated(
        service,
        makeMatch({ status: 'scheduled', linkedEventId: 200 }),
        eventDate,
        200,
        { visibility: 'private' },
      );

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('DMs invitees + creator when private', async () => {
      const invitees = [makeMember(11), makeMember(12)];
      mockDb.execute.mockResolvedValue(invitees);

      await callEventCreated(
        service,
        makeMatch({ status: 'scheduled', linkedEventId: 200 }),
        eventDate,
        200,
        { visibility: 'private' },
      );

      // Invitee SQL probe must run.
      expect(
        executeContainsSql(mockDb.execute, 'community_lineup_invitees'),
      ).toBe(true);

      const inviteeCalls = mockNotificationService.create.mock.calls.filter(
        ([arg]) => invitees.some((m) => m.userId === arg?.userId),
      );
      expect(inviteeCalls.length).toBeGreaterThanOrEqual(invitees.length);
    });

    it('still posts the channel embed when visibility is public', async () => {
      await callEventCreated(
        service,
        makeMatch({ status: 'scheduled', linkedEventId: 200 }),
        eventDate,
        200,
        { visibility: 'public' },
      );

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });
  });

  // ── ROK-1134: fail-closed when underlying lineup row is missing ──────────
  //
  // When the orchestrator is called without a caller-provided visibility AND
  // the DB lookup returns no row (race against a hard delete or broken FK),
  // `resolveLineupVisibility` must NOT default to 'public'. It must return
  // null, and every `route*IfPrivate` must treat that null as "private path
  // taken" so the channel embed (and DM fan-out) is suppressed.

  describe('fail-closed when lineup row is missing (ROK-1134)', () => {
    /** Override the visibility-probe chain to simulate a missing row. */
    function mockMissingLineupRow(
      db: ReturnType<typeof makeMockDb>,
    ): void {
      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
    }

    it('notifyNominationMilestone — does not post channel embed when lineup row is missing', async () => {
      mockMissingLineupRow(mockDb);

      // No `visibility` passed → resolveLineupVisibility falls through to DB,
      // which now returns [] (no row).
      await callMilestone(service, LINEUP_ID, 50, [milestoneEntry('Game A')]);

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('notifyMatchesFound — does not post channel embed when lineup row is missing', async () => {
      mockMissingLineupRow(mockDb);

      await callMatchesFound(service, LINEUP_ID, [
        makeMatch({ thresholdMet: true }),
      ]);

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('notifySchedulingOpen — does not post channel embed when lineup row is missing', async () => {
      mockMissingLineupRow(mockDb);

      await callSchedulingOpen(service, makeMatch({ status: 'scheduling' }));

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('notifyEventCreated — does not post channel embed when lineup row is missing', async () => {
      mockMissingLineupRow(mockDb);
      const eventDate = new Date('2026-04-20T18:00:00Z');

      await callEventCreated(
        service,
        makeMatch({ status: 'scheduled', linkedEventId: 200 }),
        eventDate,
        200,
      );

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });
});
