/**
 * ROK-1454 D8/D9 — the LFM embed consumer.
 *
 * The high-risk claims pinned here, and why each one needs its own assertion:
 *
 *  - **the converted read is NOT the live read.** D6 says the three terminal
 *    reasons use three deliberately different strategies. `converted` asserts
 *    `readLiveGroup` was never called, because a live read on a converted group
 *    returns an empty roster — the exact defect that got round 1 rejected.
 *  - **no `sendEmbed` on any closing path** (AC5). Asserted separately for all
 *    three terminal reasons: a closing path that posts a second message is the
 *    "one message per group" invariant breaking in the most visible way.
 *  - **the D9 wedge** (AC9). `insertLfmMessage` here MODELS the partial unique
 *    index by throwing on a second `open` row for a game, so the reconcile test
 *    fails the way production would: the game can never post again.
 *  - **`3 -> 2` is not terminal** (E12). The fixture is deliberately a
 *    withdrawal that leaves two members, so a `reason === 'withdrawn' ⇒ close`
 *    shortcut would be caught.

 *
 * Fixtures live in `lfm-embed.service.spec-helpers.ts` (ROK-1505 split — this
 * file was at 736/750). The D9 restart-reconcile block moved to
 * `lfm-embed.reconcile.spec.ts`.
 */
import * as store from './lfm-embed.db-helpers';
import type { LfmEmbedService } from './lfm-embed.service';
import {
  allRows,
  CLIENT_URL,
  client,
  createService,
  edited,
  EVENT_ID,
  GAME_ID,
  LINEUP_ID,
  live,
  MATCH_ID,
  member,
  openRow,
  rowById,
  seedOpenRow,
  sent,
  settings,
} from './lfm-embed.service.spec-helpers';

jest.mock('./lfm-embed.db-helpers');

let service: LfmEmbedService;

beforeEach(async () => {
  service = await createService();
});

describe('LFM_REACHED — the first post (D8a)', () => {
  it('posts one message and records the row it will be edited from', async () => {
    await service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
    });

    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
    expect(client.sendEmbed.mock.calls[0][0]).toBe('chan-default');
    expect(client.sendEmbed.mock.calls[0][3]).toBe(
      '🔎 Deep Rock Galactic · 2 looking for a group',
    );
    expect(sent().author?.name).toBe(
      '◌ NEEDS PLAYERS · 2 looking · needs 2 more',
    );
    expect(openRow()).toMatchObject({
      guildId: 'guild-1',
      channelId: 'chan-default',
      messageId: 'msg-new',
      lastMemberCount: 2,
      threadId: null,
      postKind: 'text',
    });
  });

  it('E1 — a disconnected bot writes nothing and throws nothing', async () => {
    client.isConnected.mockReturnValue(false);

    await expect(
      service.onLfmReached({
        gameId: GAME_ID,
        activeCount: 2,
        urgency: 'week',
        ttlMinutes: null,
      }),
    ).resolves.toBeUndefined();
    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(jest.mocked(store).loadLfmGame).not.toHaveBeenCalled();
    expect(allRows()).toHaveLength(0);
  });

  it('edits rather than posting when an open row already exists', async () => {
    seedOpenRow();

    await service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
    });

    expect(client.editEmbed).toHaveBeenCalledWith(
      'chan-1',
      'msg-1',
      expect.anything(),
    );
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });

  it('skips without posting when no channel resolves', async () => {
    settings.getDiscordBotDefaultChannel.mockResolvedValue(null);

    await expect(
      service.onLfmReached({
        gameId: GAME_ID,
        activeCount: 2,
        urgency: 'week',
        ttlMinutes: null,
      }),
    ).resolves.toBeUndefined();
    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(allRows()).toHaveLength(0);
  });

  it('never throws into the emitter when Discord rejects the post', async () => {
    client.sendEmbed.mockRejectedValue(new Error('Missing Permissions'));

    await expect(
      service.onLfmReached({
        gameId: GAME_ID,
        activeCount: 2,
        urgency: 'week',
        ttlMinutes: null,
      }),
    ).resolves.toBeUndefined();
    expect(allRows()).toHaveLength(0);
  });
});

describe('GROUP_CHANGED — the in-place edits (D8b)', () => {
  it('E4 — returns silently when the game has no open row', async () => {
    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });

    expect(client.editEmbed).not.toHaveBeenCalled();
    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(jest.mocked(store).readLiveGroup).not.toHaveBeenCalled();
  });

  it('joined — re-reads the roster and edits the same message', async () => {
    seedOpenRow();
    jest
      .mocked(store)
      .readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl', 'Doretta']));

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });

    expect(client.editEmbed.mock.calls[0][1]).toBe('msg-1');
    expect(edited().author?.name).toBe(
      '◌ NEEDS PLAYERS · 3 looking · needs 1 more',
    );
    expect(edited().description).toContain('Doretta');
    expect(openRow()).toMatchObject({ state: 'open', lastMemberCount: 3 });
  });

  it('E12 — a withdrawal that leaves two is NOT terminal', async () => {
    seedOpenRow({ lastMemberCount: 3 });
    jest.mocked(store).readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl']));

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'withdrawn' });

    expect(edited().author?.name).toBe(
      '◌ NEEDS PLAYERS · 2 looking · needs 2 more',
    );
    expect(openRow()).toMatchObject({ state: 'open', lastMemberCount: 2 });
    expect(jest.mocked(store).closeLfmMessage).not.toHaveBeenCalled();
  });
});

describe('GROUP_CHANGED — the terminal edits (D6 / AC5)', () => {
  it('withdrawn below two closes the group from the LIVE read (D6b)', async () => {
    seedOpenRow({ lastMemberCount: 2 });
    jest.mocked(store).readLiveGroup.mockResolvedValue(live(['Bosco']));

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'withdrawn' });

    expect(edited().author?.name).toBe('■ CLOSED · 1 still looking');
    expect(rowById('row-1')).toMatchObject({
      state: 'closed',
      lastMemberCount: 1,
      threadId: null,
      postKind: 'text',
    });
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });

  it('converted — renders SCHEDULED from provenance, never from the live read', async () => {
    seedOpenRow();
    jest
      .mocked(store)
      .readConvertedGroup.mockResolvedValue(
        ['Bosco', 'Karl', 'Doretta'].map(member),
      );

    await service.onGroupChanged({
      gameId: GAME_ID,
      reason: 'converted',
      eventId: EVENT_ID,
    });

    expect(jest.mocked(store).readConvertedGroup).toHaveBeenCalledWith(
      expect.anything(),
      GAME_ID,
      { eventId: EVENT_ID },
    );
    expect(jest.mocked(store).readLiveGroup).not.toHaveBeenCalled();
    expect(edited().author?.name).toBe('■ SCHEDULED · 3 players');
    expect(edited().description).toContain(`${CLIENT_URL}/events/${EVENT_ID}`);
    // AC3 at the tier where the roster really comes from user rows: no raw
    // mention anywhere in the rendered payload.
    expect(JSON.stringify(edited())).not.toContain('<@');
    expect(rowById('row-1')).toMatchObject({
      state: 'converted',
      lastMemberCount: 3,
      threadId: null,
      postKind: 'text',
    });
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });

  it('converted into a poll links the MATCH id, not the poll id', async () => {
    seedOpenRow();
    jest.mocked(store).readConvertedGroup.mockResolvedValue([member('Bosco')]);

    await service.onGroupChanged({
      gameId: GAME_ID,
      reason: 'converted',
      pollId: MATCH_ID,
    });

    expect(jest.mocked(store).resolvePollTarget).toHaveBeenCalledWith(
      expect.anything(),
      MATCH_ID,
    );
    expect(edited().description).toContain(
      `${CLIENT_URL}/community-lineup/${LINEUP_ID}/schedule/${MATCH_ID}`,
    );
  });

  it('expired — renders from last_member_count with no roster (D6c)', async () => {
    seedOpenRow({ lastMemberCount: 4 });
    // Every hand expired: the live re-read sees nobody.
    jest.mocked(store).readLiveGroup.mockResolvedValue(live([]));

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'expired' });

    expect(edited().author?.name).toBe('■ EXPIRED · 4 were looking');
    expect(edited().description).toBe('Nobody scheduled it.');
    expect(jest.mocked(store).readLiveGroup).toHaveBeenCalledTimes(1);
    expect(jest.mocked(store).readConvertedGroup).not.toHaveBeenCalled();
    expect(rowById('row-1')).toMatchObject({
      state: 'expired',
      lastMemberCount: 4,
      threadId: null,
      postKind: 'text',
    });
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });
});

describe('E3 — the Discord message was deleted by a human', () => {
  it('E3 — a human-deleted message on an OPEN group is replaced', async () => {
    seedOpenRow();
    client.editEmbed.mockRejectedValue(new Error('Unknown Message'));

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });

    expect(jest.mocked(store).deleteLfmMessage).toHaveBeenCalled();
    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
    expect(openRow()?.messageId).toBe('msg-new');
  });

  it('E3 — a human-deleted message on a TERMINAL edit just closes the row', async () => {
    seedOpenRow({ lastMemberCount: 4 });
    // The group really is over — the expiry re-read sees nobody.
    jest.mocked(store).readLiveGroup.mockResolvedValue(live([]));
    client.editEmbed.mockRejectedValue(new Error('Unknown Message'));

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'expired' });

    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(rowById('row-1')).toMatchObject({ state: 'expired' });
  });
});

describe('ROK-1494 review — a restart must not close a LIVE session', () => {
  const VOICE_URL = 'https://discord.com/channels/guild-1/voice-1';

  /**
   * The restart state exactly: the spawn converted every intent, so the live
   * read reports an EMPTY group and `latestConversionTarget` now finds the
   * spawn's own event. Without the session check the reconcile reads that as
   * "converted while we were down" and closes the row — after which every
   * later PARTICIPANT_JOINED hits `editForChange`'s `if (!row) return` and the
   * head-count is frozen for the rest of the session (the D3 failure).
   */
  function wireRestartDuringSession(): void {
    const s = jest.mocked(store);
    s.readLiveGroup.mockResolvedValue(live([]));
    s.latestConversionTarget.mockResolvedValue({ eventId: EVENT_ID });
    s.readOpenLfgNowEventId.mockResolvedValue(EVENT_ID);
    s.readPlayingSession.mockResolvedValue({
      names: ['Bosco', 'Karl', 'Doretta'],
      count: 3,
      voiceChannelUrl: VOICE_URL,
    });
  }

  it('re-renders PLAYING and leaves the row open', async () => {
    seedOpenRow();
    wireRestartDuringSession();

    await service.onConnected();

    expect(edited().author?.name).toBe('\u25b8 PLAYING NOW \u00b7 3 in voice');
    expect(jest.mocked(store).closeLfmMessage).not.toHaveBeenCalled();
    expect(rowById('row-1')).toMatchObject({
      state: 'open',
      lastMemberCount: 3,
    });
  });

  it('reads the session BEFORE deciding the group is over', async () => {
    seedOpenRow();
    wireRestartDuringSession();

    await service.onConnected();

    expect(jest.mocked(store).readOpenLfgNowEventId).toHaveBeenCalledWith(
      expect.anything(),
      GAME_ID,
    );
    expect(jest.mocked(store).readConvertedGroup).not.toHaveBeenCalled();
  });

  it('still closes a group that genuinely converted to a poll while down', async () => {
    seedOpenRow();
    const s = jest.mocked(store);
    s.readLiveGroup.mockResolvedValue(live([]));
    s.readOpenLfgNowEventId.mockResolvedValue(null);
    s.latestConversionTarget.mockResolvedValue({ pollId: MATCH_ID });
    s.readConvertedGroup.mockResolvedValue(['Bosco', 'Karl'].map(member));

    await service.onConnected();

    expect(edited().author?.name).toBe('\u25a0 SCHEDULED \u00b7 2 players');
    expect(rowById('row-1')).toMatchObject({ state: 'converted' });
  });
});

describe('review fix — an expired ROW is not a dead GROUP', () => {
  it('keeps the message OPEN when the live re-read still clears the floor', async () => {
    seedOpenRow({ lastMemberCount: 3 });
    // A deactivated holder's stale hand expired alone; two eligible members,
    // whose clocks the +1s refreshed, are still looking.
    jest.mocked(store).readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl']));

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'expired' });

    expect(edited().author?.name).toContain('NEEDS PLAYERS');
    expect(openRow()).toMatchObject({ state: 'open', lastMemberCount: 2 });
    expect(jest.mocked(store).closeLfmMessage).not.toHaveBeenCalled();
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });
});

describe('review fix — a refused edit must not wedge the game (AC9 class)', () => {
  it('closes the row when Discord refuses a TERMINAL render', async () => {
    seedOpenRow();
    jest
      .mocked(store)
      .readConvertedGroup.mockResolvedValue(['Bosco', 'Karl'].map(member));
    client.editEmbed.mockRejectedValueOnce(new Error('Missing Access'));

    await service.onGroupChanged({
      gameId: GAME_ID,
      reason: 'converted',
      eventId: EVENT_ID,
    });

    expect(rowById('row-1')).toMatchObject({ state: 'converted' });
    expect(openRow()).toBeNull();
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });

  it('leaves an OPEN render for the next event when Discord refuses it', async () => {
    seedOpenRow({ lastMemberCount: 2 });
    client.editEmbed.mockRejectedValueOnce(new Error('Missing Access'));

    await expect(
      service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' }),
    ).resolves.toBeUndefined();

    expect(openRow()).toMatchObject({ state: 'open', lastMemberCount: 2 });
    expect(jest.mocked(store).closeLfmMessage).not.toHaveBeenCalled();
  });
});

describe('review fix — E1: a group that reached LFM while the bot was down', () => {
  it('is posted on CONNECTED even though it has no row to reconcile', async () => {
    const s = jest.mocked(store);
    s.listUntrackedLfmGames.mockResolvedValue([GAME_ID]);
    s.readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl']));

    await service.onConnected();

    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
    expect(openRow()).toMatchObject({
      messageId: 'msg-new',
      lastMemberCount: 2,
      threadId: null,
      postKind: 'text',
    });
    expect(client.editEmbed).not.toHaveBeenCalled();
  });

  it('posts nothing when every live group already has its message', async () => {
    seedOpenRow();
    jest.mocked(store).listUntrackedLfmGames.mockResolvedValue([]);

    await service.onConnected();

    expect(client.sendEmbed).not.toHaveBeenCalled();
  });
});

describe('review fix — lifecycle events for ONE game are serialized', () => {
  it('a third hand arriving while the first post awaits Discord is applied after it, not dropped', async () => {
    let releasePost: ((m: { id: string }) => void) | undefined;
    client.sendEmbed.mockImplementationOnce(
      () =>
        new Promise<{ id: string }>((resolve) => {
          releasePost = resolve;
        }),
    );
    const s = jest.mocked(store);
    s.readLiveGroup
      .mockResolvedValueOnce(live(['Bosco', 'Karl']))
      .mockResolvedValue(live(['Bosco', 'Karl', 'Doretta']));

    const first = service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
    });
    const second = service.onGroupChanged({
      gameId: GAME_ID,
      reason: 'joined',
    });
    for (let i = 0; i < 200 && !releasePost; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(releasePost).toBeDefined();
    // Without the per-game chain the join has ALREADY run here, found no row
    // (E4) and returned — the 3-player edit is lost for good.
    expect(client.editEmbed).not.toHaveBeenCalled();
    releasePost!({ id: 'msg-new' });
    await Promise.all([first, second]);

    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
    expect(client.editEmbed).toHaveBeenCalledTimes(1);
    expect(openRow()).toMatchObject({
      messageId: 'msg-new',
      lastMemberCount: 3,
      threadId: null,
      postKind: 'text',
    });
  });
});

/**
 * ROK-1494 AC4 — the live session, and the one line that keeps it live.
 *
 * The load-bearing assertion is the SECOND render: `TERMINAL_STATE.playing`
 * being anything but null makes `persist` call `closeLfmMessage`, after which
 * `findOpenLfmMessage` returns nothing and `editForChange` early-returns
 * forever — so the head-count would freeze at whatever the first render saw.
 * Mutating that entry to `'converted'` must fail this block.
 */
describe('GROUP_CHANGED playing — the live session (ROK-1494 AC4)', () => {
  const VOICE_URL = 'https://discord.com/channels/guild-1/voice-1';

  /** One `playing` transition, as `LfgNowSpawnService` emits it (D4). */
  function playing(): Promise<void> {
    return service.onGroupChanged({
      gameId: GAME_ID,
      reason: 'playing',
      eventId: EVENT_ID,
    });
  }

  beforeEach(() => {
    jest.mocked(store).readPlayingSession.mockResolvedValue({
      names: ['Bosco', 'Karl', 'Doretta'],
      count: 3,
      voiceChannelUrl: VOICE_URL,
    });
  });

  it('renders PLAYING NOW with both links, from the session read only', async () => {
    seedOpenRow();

    await playing();

    expect(jest.mocked(store).readPlayingSession).toHaveBeenCalledWith(
      expect.anything(),
      GAME_ID,
      EVENT_ID,
    );
    // The intents have already converted, so the live read would report an
    // empty group — the same class of defect D6 was written against.
    expect(jest.mocked(store).readLiveGroup).not.toHaveBeenCalled();
    expect(edited().author?.name).toBe('▸ PLAYING NOW · 3 in voice');
    expect(edited().description).toContain(VOICE_URL);
    expect(edited().description).toContain(`${CLIENT_URL}/events/${EVENT_ID}`);
  });

  it('stamps the head-count and NEVER closes the row', async () => {
    seedOpenRow();

    await playing();

    expect(jest.mocked(store).closeLfmMessage).not.toHaveBeenCalled();
    expect(jest.mocked(store).recordLfmRender).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      3,
    );
    expect(rowById('row-1')).toMatchObject({
      state: 'open',
      lastMemberCount: 3,
    });
  });

  it('a later join edits the SAME message and moves the count', async () => {
    seedOpenRow();
    await playing();

    jest.mocked(store).readPlayingSession.mockResolvedValue({
      names: ['Bosco', 'Karl', 'Doretta', 'Missy'],
      count: 4,
      voiceChannelUrl: VOICE_URL,
    });
    await playing();

    // Named BEFORE `edited(1)` indexes into the calls: a closed row makes the
    // second edit never happen, and an index-out-of-range TypeError proves
    // nothing about the bug.
    expect(client.editEmbed).toHaveBeenCalledTimes(2);
    expect(edited(1).author?.name).toBe('▸ PLAYING NOW · 4 in voice');
    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(rowById('row-1')).toMatchObject({ state: 'open' });
  });
});
