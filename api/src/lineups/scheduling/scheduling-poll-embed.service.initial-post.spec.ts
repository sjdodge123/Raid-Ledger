/**
 * ROK-1473 — a community lineup's own scheduling poll posts its Discord card.
 *
 * CONFIRMED FAILING on the branch base: `SchedulingService` only ever called
 * `fireUpdateEmbed`, and `firePostInitialEmbed` had exactly one caller
 * (`standalone-poll.service`). `updateEmbed` returns early on a NULL
 * `embed_message_id`, so a lineup-phase poll had no card and every later
 * re-render was a no-op. The service had no listener at all — the
 * `onMatchEnteredScheduling` cases below did not exist.
 *
 * The card must land in the LINEUP's channel (per-lineup override → admin
 * lineup channel → default announcement channel), not the game channel a
 * standalone poll uses.
 */
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
jest.mock('./scheduling-query.helpers', () => ({
  ...jest.requireActual('./scheduling-query.helpers'),
  findScheduleSlots: jest.fn().mockResolvedValue([]),
  findScheduleVotes: jest.fn().mockResolvedValue([]),
}));

const MATCH_ID = 10;
const LINEUP_ID = 1;
const GAME_ID = 3;
const CLIENT_URL = 'http://localhost:5173';
const LINEUP_CHANNEL = 'lineup-chan';
const OVERRIDE_CHANNEL = 'override-chan';

/** Resolves the queued microtasks a fire-and-forget call leaves behind. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Row shape the initial-post path loads for the match. */
function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MATCH_ID,
    lineupId: LINEUP_ID,
    gameId: GAME_ID,
    status: 'scheduling',
    embedMessageId: null as string | null,
    embedChannelId: null as string | null,
    channelOverrideId: null as string | null,
    ...overrides,
  };
}

/** A guild whose only channel is the override, fully postable by the bot. */
function guildWithPostableOverride() {
  return {
    channels: {
      cache: new Map([
        [
          OVERRIDE_CHANNEL,
          {
            isTextBased: () => true,
            isDMBased: () => false,
            permissionsFor: () => ({ has: () => true }),
          },
        ],
      ]),
    },
    members: { me: {} },
  };
}

describe('SchedulingPollEmbedService.onMatchEnteredScheduling (ROK-1473)', () => {
  let mockDb: MockDb;
  let sendEmbed: jest.Mock;
  let buildSchedulingPollEmbed: jest.Mock;
  let resolveChannelForEvent: jest.Mock;
  let settingsGet: jest.Mock;
  let getDiscordBotDefaultChannel: jest.Mock;
  let getGuild: jest.Mock;
  let service: SchedulingPollEmbedService;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    sendEmbed = jest.fn().mockResolvedValue({ id: 'msg-77' });
    buildSchedulingPollEmbed = jest
      .fn()
      .mockReturnValue({ embed: { toJSON: () => ({}) } });
    resolveChannelForEvent = jest.fn().mockResolvedValue('game-chan');
    settingsGet = jest.fn().mockResolvedValue(LINEUP_CHANNEL);
    getDiscordBotDefaultChannel = jest.fn().mockResolvedValue('default-chan');
    getGuild = jest.fn().mockReturnValue(null);

    service = new SchedulingPollEmbedService(
      mockDb as never,
      { buildSchedulingPollEmbed } as never,
      {
        sendEmbed,
        editEmbed: jest.fn().mockResolvedValue(undefined),
        getGuild,
      } as never,
      { resolveChannelForEvent } as never,
      {
        get: settingsGet,
        getDiscordBotDefaultChannel,
        getClientUrl: jest.fn().mockResolvedValue(CLIENT_URL),
        getBranding: jest.fn().mockResolvedValue({ communityName: 'RL' }),
        getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
      } as never,
      { checkAndMarkSent: jest.fn().mockResolvedValue(false) } as never,
    );
  });

  /**
   * Queue the reads the initial-post path makes, in order: the match row,
   * the lineup's visibility, the postable re-read, then the game row.
   */
  function queueRows(
    match: Record<string, unknown> = matchRow(),
    opts: {
      visibility?: 'public' | 'private' | null;
      /** Rows the conditional claim UPDATE returns ([] = someone else won). */
      claim?: { id: number }[];
    } = {},
  ): void {
    const visibility =
      opts.visibility === undefined ? 'public' : opts.visibility;
    mockDb.limit
      .mockResolvedValueOnce([match])
      .mockResolvedValueOnce(visibility === null ? [] : [{ visibility }])
      .mockResolvedValueOnce([{ name: 'Elden Ring', coverUrl: null }]);
    mockDb.returning.mockResolvedValueOnce(opts.claim ?? [{ id: MATCH_ID }]);
  }

  it('posts exactly one poll card into the lineup channel', async () => {
    queueRows();

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(sendEmbed).toHaveBeenCalledTimes(1);
    expect(sendEmbed.mock.calls[0][0]).toBe(LINEUP_CHANNEL);
    const data = buildSchedulingPollEmbed.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      matchId: MATCH_ID,
      lineupId: LINEUP_ID,
      status: 'open',
      pollUrl: `${CLIENT_URL}/community-lineup/${LINEUP_ID}/schedule/${MATCH_ID}`,
    });
  });

  it('honours the per-lineup channel override when the bot may post there', async () => {
    getGuild.mockReturnValue(guildWithPostableOverride());
    queueRows(matchRow({ channelOverrideId: OVERRIDE_CHANNEL }));

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(sendEmbed.mock.calls[0][0]).toBe(OVERRIDE_CHANNEL);
  });

  it('stores the Discord message reference on the match row', async () => {
    queueRows();

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(mockDb.set).toHaveBeenCalledWith({
      embedMessageId: 'msg-77',
      embedChannelId: LINEUP_CHANNEL,
    });
  });

  it('never uses the game-channel resolution the standalone wizard uses', async () => {
    queueRows();

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(resolveChannelForEvent).not.toHaveBeenCalled();
  });

  it('does not post again when the match already has a card', async () => {
    queueRows(matchRow({ embedMessageId: 'msg-77', embedChannelId: 'c' }));

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(sendEmbed).not.toHaveBeenCalled();
  });

  it('sends nothing when another poster already claimed the slot', async () => {
    // The conditional claim UPDATE matched no row: a concurrent delivery
    // (retry, re-entry) got there first and its card is already going out.
    queueRows(matchRow(), { claim: [] });

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(sendEmbed).not.toHaveBeenCalled();
  });

  it('claims the slot on the resolved channel before sending', async () => {
    queueRows();

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(mockDb.set).toHaveBeenNthCalledWith(1, {
      embedChannelId: LINEUP_CHANNEL,
    });
  });

  it('posts nothing when no lineup channel is configured', async () => {
    settingsGet.mockResolvedValue(null);
    getDiscordBotDefaultChannel.mockResolvedValue(null);
    queueRows();

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(sendEmbed).not.toHaveBeenCalled();
  });

  // ── Private lineups keep their poll out of the public channel ─────────

  it('posts no channel card for a private lineup', async () => {
    queueRows(matchRow(), { visibility: 'private' });

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(sendEmbed).not.toHaveBeenCalled();
    expect(mockDb.set).not.toHaveBeenCalled();
  });

  it('fails closed when the lineup row vanished (visibility unknown)', async () => {
    queueRows(matchRow(), { visibility: null });

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(sendEmbed).not.toHaveBeenCalled();
  });

  // ── Stale event: the match no longer wants a card ─────────────────────

  it('posts nothing when the claim finds no scheduling match', async () => {
    // The claim predicate covers both stale cases: a re-decide deleted the
    // match, or a lock-in/archive moved it out of `scheduling`.
    queueRows(matchRow(), { claim: [] });

    service.onMatchEnteredScheduling({ matchId: MATCH_ID });
    await flush();

    expect(sendEmbed).not.toHaveBeenCalled();
    expect(mockDb.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ embedMessageId: expect.anything() }),
    );
  });

  it('never lets a Discord failure escape the listener, and drops the claim', async () => {
    sendEmbed.mockRejectedValue(new Error('discord down'));
    queueRows();

    expect(() =>
      service.onMatchEnteredScheduling({ matchId: MATCH_ID }),
    ).not.toThrow();
    await expect(flush()).resolves.toBeUndefined();
    // No message reference stored, and the claim is released for a retry.
    expect(mockDb.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ embedMessageId: expect.anything() }),
    );
    expect(mockDb.set).toHaveBeenLastCalledWith({ embedChannelId: null });
  });
});
