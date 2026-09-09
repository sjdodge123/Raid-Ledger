/**
 * ROK-1494 round-2 fleet gate (AC7) — `viewForChange`'s dispatch.
 *
 * The gate's red: the spawn worked (event created, four `now` intents
 * converted, temp voice channel up) but the LFM message never STAYED on
 * PLAYING NOW. `viewForChange` branched on `payload.reason` alone, so the
 * ordinary `GROUP_CHANGED` / `LFM_REACHED` emits that queued behind the
 * spawn's `playing` emit each re-read the now-EMPTY live group — the spawn had
 * just converted every intent — and painted an open render over the session's
 * author line, stamping `last_member_count = 0`. `TERMINAL_STATE.playing` is
 * null, so the row stayed `open` and nothing ever restored it.
 *
 * These live in their own spec rather than `lfm-embed.service.spec.ts` because
 * that file is at 736/750 counted lines, and because the defect is entirely in
 * the view DISPATCH: the service's AC4 block already pins that a `playing` view
 * stamps its head-count and never closes the row.
 *
 * This spec mocks `lfm-embed.db-helpers` and nothing else — the same single
 * data-access surface the service spec replaces.
 */
import { buildLfmEmbed, type LfmGroupView } from './lfm-embed.helpers';
import { sessionView, viewForChange } from './lfm-embed.views';
import * as store from './lfm-embed.db-helpers';
import type { LfmGameRow, LfmLiveGroup } from './lfm-embed.db-helpers';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { EmbedContext } from '../services/discord-embed.factory';

jest.mock('./lfm-embed.db-helpers');

const GAME_ID = 42;
const EVENT_ID = 900;
const VOICE_URL = 'https://discord.com/channels/guild-1/voice-1';
const LAST_MEMBER_COUNT = 3;

/** No real handle is ever dereferenced — every read is mocked. */
const db = {} as LfgDb;

const logger = { warn: jest.fn<void, [string]>() };

const context: EmbedContext = {
  communityName: 'Deep Rock',
  clientUrl: 'https://raid.example',
  timezone: 'UTC',
};

/** A games row wide enough for the badge columns, as the service spec builds it. */
const game = {
  id: GAME_ID,
  name: 'Deep Rock Galactic',
  slug: 'deep-rock-galactic',
  coverUrl: null,
  cooptimusOnlineMax: 4,
} as LfmGameRow;

/** The EMPTY live group the spawn leaves behind — every intent is converted. */
const emptyGroup: LfmLiveGroup = {
  members: [],
  soonestExpiresAt: null,
  viabilityThreshold: 4,
  nowCount: 0,
  soonestNowExpiresAt: null,
};

beforeEach(() => {
  jest.resetAllMocks();
  const s = jest.mocked(store);
  s.readLiveGroup.mockResolvedValue(emptyGroup);
  s.readConvertedGroup.mockResolvedValue([]);
  s.readPlayingSession.mockResolvedValue({
    names: ['Bosco', 'Karl', 'Doretta'],
    count: 3,
    voiceChannelUrl: VOICE_URL,
  });
  // The game HAS an open LFG-born session for every case below.
  s.readOpenLfgNowEventId.mockResolvedValue(EVENT_ID);
});

/** The author line the change would actually render in Discord. */
function authorLine(view: LfmGroupView): string | undefined {
  return buildLfmEmbed(view, context).embed.data.author?.name;
}

describe('a live session outranks the live read (AC7)', () => {
  it.each(['joined', 'withdrawn', 'bumped'] as const)(
    'renders PLAYING NOW for a later %s change',
    async (reason) => {
      const view = await viewForChange(
        db,
        game,
        LAST_MEMBER_COUNT,
        { gameId: GAME_ID, reason },
        logger,
      );

      expect(view?.state).toBe('playing');
      // The head-count comes off the SESSION read, not the empty live group.
      expect(view?.memberCount).toBe(3);
      expect(authorLine(view as LfmGroupView)).toBe(
        '▸ PLAYING NOW · 3 in voice',
      );
    },
  );

  it('never stamps the empty live group over the session', async () => {
    const view = await viewForChange(
      db,
      game,
      LAST_MEMBER_COUNT,
      { gameId: GAME_ID, reason: 'joined' },
      logger,
    );

    // `persist` stamps `view.memberCount`; a 0 here is exactly the
    // `last_member_count = 0` the fleet found on the open row.
    expect(view?.memberCount).not.toBe(0);
    expect(jest.mocked(store).readPlayingSession).toHaveBeenCalledWith(
      db,
      GAME_ID,
      EVENT_ID,
    );
  });

  it('takes the session read without needing an eventId on the payload', async () => {
    const view = await viewForChange(
      db,
      game,
      LAST_MEMBER_COUNT,
      { gameId: GAME_ID, reason: 'joined' },
      logger,
    );

    expect(view?.playingEventId).toBe(EVENT_ID);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('a terminal reason still ends the group (AC7 guard)', () => {
  it('renders SCHEDULED for a converted change even mid-session', async () => {
    const view = await viewForChange(
      db,
      game,
      LAST_MEMBER_COUNT,
      { gameId: GAME_ID, reason: 'converted', eventId: EVENT_ID },
      logger,
    );

    // Were the session allowed to win here the row could never close, and the
    // partial unique index would wedge the game forever (AC9's failure class).
    expect(view?.state).toBe('scheduled');
    expect(jest.mocked(store).readPlayingSession).not.toHaveBeenCalled();
  });

  it('renders EXPIRED for an expired change below the floor', async () => {
    const view = await viewForChange(
      db,
      game,
      LAST_MEMBER_COUNT,
      { gameId: GAME_ID, reason: 'expired' },
      logger,
    );

    expect(view?.state).toBe('expired');
    expect(view?.memberCount).toBe(LAST_MEMBER_COUNT);
  });

  it('still honours an explicit playing payload', async () => {
    const view = await viewForChange(
      db,
      game,
      LAST_MEMBER_COUNT,
      { gameId: GAME_ID, reason: 'playing', eventId: EVENT_ID },
      logger,
    );

    expect(view?.state).toBe('playing');
    expect(jest.mocked(store).readLiveGroup).not.toHaveBeenCalled();
  });
});

describe('sessionView — the shared "which view now" answer', () => {
  it('returns null when the game has no open session', async () => {
    jest.mocked(store).readOpenLfgNowEventId.mockResolvedValue(null);

    expect(await sessionView(db, game)).toBeNull();
  });

  it('falls through to the live read when there is no session', async () => {
    jest.mocked(store).readOpenLfgNowEventId.mockResolvedValue(null);

    const view = await viewForChange(
      db,
      game,
      LAST_MEMBER_COUNT,
      { gameId: GAME_ID, reason: 'joined' },
      logger,
    );

    expect(view?.state).toBe('open');
    expect(view?.memberCount).toBe(0);
  });
});
