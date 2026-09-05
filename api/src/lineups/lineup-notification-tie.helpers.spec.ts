/**
 * ROK-1374 (Lane B) — the tie notification orchestrators.
 *
 * Each of the three lifecycle events fans out DMs to the expected-voter roster
 * (the same set `loadExpectedVoters` gates quorum on, so a private tie still
 * reaches its invitees) and then announces or re-renders the ONE channel
 * message. The channel side is `tie-announce.helpers`; these specs pin the
 * recipients, the notification type, and which announce call each event makes.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { loadExpectedVoters } from './quorum/quorum-voters.helpers';
import { findDiscordMembersByUserIds } from './lineup-notification-targets.helpers';
import { findGamesByIds } from './lineups-query.helpers';
import { announceTie, editTieAnnounce } from './tiebreaker/tie-announce.helpers';
import {
  notifyTieDecided,
  notifyTieDetected,
  notifyTieExpired,
} from './lineup-notification-tie.helpers';

jest.mock('./quorum/quorum-voters.helpers', () => ({
  loadExpectedVoters: jest.fn(),
}));
jest.mock('./lineup-notification-targets.helpers', () => ({
  findDiscordMembersByUserIds: jest.fn(),
}));
jest.mock('./lineups-query.helpers', () => ({ findGamesByIds: jest.fn() }));
jest.mock('./tiebreaker/tie-announce.helpers', () => ({
  announceTie: jest.fn(),
  editTieAnnounce: jest.fn(),
}));

const mockVoters = loadExpectedVoters as jest.MockedFunction<
  typeof loadExpectedVoters
>;
const mockMembers = findDiscordMembersByUserIds as jest.MockedFunction<
  typeof findDiscordMembersByUserIds
>;
const mockGames = findGamesByIds as jest.MockedFunction<typeof findGamesByIds>;
const mockAnnounce = announceTie as jest.MockedFunction<typeof announceTie>;
const mockEdit = editTieAnnounce as jest.MockedFunction<typeof editTieAnnounce>;

const TIED = [
  { id: 7, name: 'Deep Rock Galactic' },
  { id: 9, name: 'Valheim' },
];

const LINEUP = { id: 42, title: 'Friday Co-op' };

function makeDeps(db: MockDb) {
  const notificationService = { create: jest.fn().mockResolvedValue(undefined) };
  const dedupService = {
    checkAndMarkSent: jest.fn().mockResolvedValue(false),
  };
  const settingsService = {
    getClientUrl: jest.fn().mockResolvedValue('https://raid.example.net'),
  };
  return {
    deps: {
      db: db as never,
      notificationService: notificationService as never,
      dedupService: dedupService as never,
      botClient: {} as never,
      settingsService: settingsService as never,
    },
    notificationService,
    dedupService,
  };
}

describe('lineup tie notifications', () => {
  let db: MockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDrizzleMock();
    db.limit.mockResolvedValue([
      { id: 42, visibility: 'public', tieGameIds: [7, 9], tieVoteCount: 3 },
    ]);
    mockVoters.mockResolvedValue([1, 2, 3]);
    mockMembers.mockResolvedValue([
      { id: 1, userId: 1, displayName: 'Ana', discordId: 'd1' },
      { id: 2, userId: 2, displayName: 'Bo', discordId: 'd2' },
    ] as never);
    mockGames.mockResolvedValue(TIED);
  });

  it('DMs every Discord-linked expected voter exactly once', async () => {
    const { deps, notificationService } = makeDeps(db);
    await notifyTieDetected(deps, LINEUP, { tiedGameIds: [7, 9], voteCount: 3 });
    expect(notificationService.create).toHaveBeenCalledTimes(2);
    expect(
      notificationService.create.mock.calls.map((c) => c[0].userId),
    ).toEqual([1, 2]);
  });

  it('sends the DM as a community_lineup notification carrying the link', async () => {
    const { deps, notificationService } = makeDeps(db);
    await notifyTieDetected(deps, LINEUP, { tiedGameIds: [7, 9], voteCount: 3 });
    const dm = notificationService.create.mock.calls[0][0];
    expect(dm.type).toBe('community_lineup');
    expect(dm.message).toContain(
      'https://raid.example.net/community-lineup/42',
    );
  });

  it('skips a recipient the dedup service already marked (E3)', async () => {
    const { deps, notificationService, dedupService } = makeDeps(db);
    dedupService.checkAndMarkSent.mockResolvedValue(true);
    await notifyTieDetected(deps, LINEUP, { tiedGameIds: [7, 9], voteCount: 3 });
    expect(notificationService.create).not.toHaveBeenCalled();
  });

  it('announces the tie with the roster-scoped size', async () => {
    const { deps } = makeDeps(db);
    await notifyTieDetected(deps, LINEUP, { tiedGameIds: [7, 9], voteCount: 3 });
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce.mock.calls[0][2]).toEqual({
      tiedGames: TIED,
      rosterSize: 3,
    });
  });

  it('EDITS the existing message when the tie is decided — never posts', async () => {
    const { deps } = makeDeps(db);
    await notifyTieDecided(deps, LINEUP, TIED[0], 'Roknua', {
      count: 2,
      rosterSize: 3,
    });
    expect(mockEdit).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it('names the picked game in the decided DM', async () => {
    const { deps, notificationService } = makeDeps(db);
    await notifyTieDecided(deps, LINEUP, TIED[0], 'Roknua', {
      count: 2,
      rosterSize: 3,
    });
    expect(notificationService.create.mock.calls[0][0].message).toContain(
      'Deep Rock Galactic',
    );
  });

  it('does not DM the picker about their own pick', async () => {
    const { deps, notificationService } = makeDeps(db);
    await notifyTieDecided(
      deps,
      LINEUP,
      TIED[0],
      'Ana',
      { count: 2, rosterSize: 3 },
      1,
    );
    expect(
      notificationService.create.mock.calls.map((c) => c[0].userId),
    ).toEqual([2]);
  });

  it('EDITS the existing message on expiry and says nothing was picked', async () => {
    const { deps, notificationService } = makeDeps(db);
    await notifyTieExpired(deps, LINEUP);
    expect(mockEdit).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).not.toHaveBeenCalled();
    expect(notificationService.create.mock.calls[0][0].message).toContain(
      'Nobody picked',
    );
  });

  it('does nothing when the lineup row vanished', async () => {
    db.limit.mockResolvedValue([]);
    const { deps, notificationService } = makeDeps(db);
    await notifyTieExpired(deps, LINEUP);
    expect(notificationService.create).not.toHaveBeenCalled();
    expect(mockEdit).not.toHaveBeenCalled();
  });
});
