/**
 * ROK-1528: aborting a PRIVATE lineup must not post to the public channel.
 *
 * The abort card was the last lifecycle notification that ignored
 * `visibility`, so a private lineup announced its own death in the default
 * channel — title, description and all. Operator ruling 2026-09-12: keep it
 * private; invitees learn about it through the same DM surface every other
 * private-lineup notification uses.
 */
import { notifyLineupAborted } from './lineup-notification-aborted.helpers';
import { postChannelEmbed } from './lineup-notification-dispatch.helpers';
import { findInviteeDiscordMembers } from './lineup-notification-targets.helpers';
import type { LineupInfo } from './lineup-notification.service';

jest.mock('./lineup-notification-dispatch.helpers', () => ({
  postChannelEmbed: jest.fn().mockResolvedValue(null),
  resolveEmbedCtx: jest.fn().mockResolvedValue({
    baseUrl: 'https://rl.test',
    lineupId: 42,
    communityName: 'Raid Ledger',
    phase: 'nominations',
    lineupTitle: 'Team Night',
    lineupDescription: null,
  }),
}));

jest.mock('./lineup-notification-targets.helpers', () => ({
  findInviteeDiscordMembers: jest.fn(),
}));

const mockPostChannelEmbed = postChannelEmbed as jest.Mock;
const mockFindInvitees = findInviteeDiscordMembers as jest.Mock;

const create = jest.fn().mockResolvedValue(undefined);
const checkAndMarkSent = jest.fn().mockResolvedValue(false);
/** Row the visibility probe reads when the caller supplies none. */
const limit = jest.fn().mockResolvedValue([{ visibility: 'private' }]);

/** Deps in the shape the abort orchestrator consumes. */
function makeDeps(): Parameters<typeof notifyLineupAborted>[0] {
  return {
    db: { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) },
    notificationService: { create },
    dedupService: { checkAndMarkSent },
    botClient: { sendEmbed: jest.fn() },
    settingsService: { get: jest.fn(), getClientUrl: jest.fn() },
  } as unknown as Parameters<typeof notifyLineupAborted>[0];
}

const lineup = (over: Partial<LineupInfo> = {}): LineupInfo => ({
  id: 42,
  title: 'Team Night',
  preAbortStatus: 'voting',
  ...over,
});

describe('notifyLineupAborted — visibility routing (ROK-1528)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkAndMarkSent.mockResolvedValue(false);
    limit.mockResolvedValue([{ visibility: 'private' }]);
    mockFindInvitees.mockResolvedValue([
      { id: 7, userId: 7, displayName: 'Ana', discordId: '7' },
      { id: 8, userId: 8, displayName: 'Bo', discordId: '8' },
    ]);
  });

  it('private: posts NOTHING to the channel and DMs the invitee audience', async () => {
    await notifyLineupAborted(
      makeDeps(),
      lineup({ visibility: 'private' }),
      'Not enough players',
      'Roknua',
    );

    expect(mockPostChannelEmbed).not.toHaveBeenCalled();
    expect(mockFindInvitees).toHaveBeenCalledWith(expect.anything(), 42);
    expect(create).toHaveBeenCalledTimes(2);
    const dm = create.mock.calls[0][0] as {
      userId: number;
      title: string;
      message: string;
    };
    expect(dm.userId).toBe(7);
    expect(dm.title).toContain('Team Night');
    expect(dm.message).toContain('Roknua');
    expect(dm.message).toContain('Not enough players');
  });

  it('private by DB row (no caller-supplied visibility): still stays private', async () => {
    await notifyLineupAborted(makeDeps(), lineup(), null, 'Roknua');

    expect(mockPostChannelEmbed).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('public: posts the channel embed and sends no DMs', async () => {
    await notifyLineupAborted(
      makeDeps(),
      lineup({ visibility: 'public' }),
      'Not enough players',
      'Roknua',
    );

    expect(mockPostChannelEmbed).toHaveBeenCalledTimes(1);
    expect(mockPostChannelEmbed).toHaveBeenCalledWith(
      expect.anything(),
      'lineup-aborted:42',
      expect.any(Function),
      expect.objectContaining({ lineupId: 42 }),
      undefined,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('missing lineup row: fails closed — no channel post', async () => {
    limit.mockResolvedValue([]);
    await notifyLineupAborted(makeDeps(), lineup(), null, 'Roknua');

    expect(mockPostChannelEmbed).not.toHaveBeenCalled();
  });
});
