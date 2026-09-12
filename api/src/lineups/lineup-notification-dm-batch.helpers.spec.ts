/**
 * Fan-out batching contract for the lineup DM helpers (ROK-1101 TD-3).
 *
 * The DM fan-out helpers used to iterate serially with a bare `await`, so a
 * single rejected DM aborted every remaining recipient. `LineupSteamNudgeService`
 * already fanned out in `Promise.allSettled` batches of 10; these tests pin the
 * same contract onto the lineup fan-out helpers.
 */
import { fanOutVotingDMs } from './lineup-notification-dm-batch.helpers';
import { findDiscordLinkedMembers } from './lineup-notification-targets.helpers';
import { sendVotingDM } from './lineup-notification-dm.helpers';

jest.mock('./lineup-notification-targets.helpers');
jest.mock('./lineup-notification-dm.helpers');

/** Mirrors the shared fan-out batch size (nudge-service parity). */
const BATCH_SIZE = 10;

const mockFindMembers = jest.mocked(findDiscordLinkedMembers);
const mockSendVotingDM = jest.mocked(sendVotingDM);

type Member = Awaited<ReturnType<typeof findDiscordLinkedMembers>>[number];

function members(count: number): Member[] {
  return Array.from({ length: count }, (_, i) => ({
    userId: i + 1,
    displayName: `User ${i + 1}`,
    discordId: `discord-${i + 1}`,
  })) as unknown as Member[];
}

const db = {} as never;
const notificationService = {} as never;
const dedupService = {} as never;
const lineup = { id: 7, title: 'Test Lineup' } as never;

describe('lineup DM fan-out batching (ROK-1101 TD-3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('delivers to the remaining recipients when one DM rejects', async () => {
    mockFindMembers.mockResolvedValue(members(3));
    mockSendVotingDM.mockImplementation((_ns, _ds, _l, member) =>
      member.userId === 2
        ? Promise.reject(new Error('discord 50007: cannot send DM'))
        : Promise.resolve(),
    );

    await fanOutVotingDMs(db, notificationService, dedupService, lineup, []);

    expect(mockSendVotingDM).toHaveBeenCalledTimes(3);
    const reached = mockSendVotingDM.mock.calls.map((c) => c[3].userId);
    expect(reached).toEqual([1, 2, 3]);
  });

  it('fans out concurrently in batches instead of one at a time', async () => {
    const total = BATCH_SIZE * 2 + 5;
    mockFindMembers.mockResolvedValue(members(total));

    let inFlight = 0;
    let maxInFlight = 0;
    mockSendVotingDM.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    await fanOutVotingDMs(db, notificationService, dedupService, lineup, []);

    expect(mockSendVotingDM).toHaveBeenCalledTimes(total);
    expect(maxInFlight).toBe(BATCH_SIZE);
  });
});
