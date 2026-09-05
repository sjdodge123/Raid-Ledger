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
 */
import { Test } from '@nestjs/testing';
import type { EmbedBuilder } from 'discord.js';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { LfmEmbedService } from './lfm-embed.service';
import * as store from './lfm-embed.db-helpers';
import type {
  LfmGameRow,
  LfmLiveGroup,
  LfmMessageRow,
} from './lfm-embed.db-helpers';

jest.mock('./lfm-embed.db-helpers');

const GAME_ID = 42;
const EVENT_ID = 900;
const MATCH_ID = 501;
const LINEUP_ID = 77;
const CLIENT_URL = 'https://raid.example';
const EXPIRES = '2026-09-17T23:30:00.000Z';

let rows: LfmMessageRow[] = [];

const client = {
  isConnected: jest.fn<boolean, []>(),
  getGuildId: jest.fn<string | null, []>(),
  sendEmbed: jest.fn<
    Promise<{ id: string }>,
    [string, EmbedBuilder, undefined, string]
  >(),
  editEmbed: jest.fn<Promise<{ id: string }>, [string, string, EmbedBuilder]>(),
};

const settings = {
  getBranding: jest.fn(),
  getClientUrl: jest.fn(),
  getDefaultTimezone: jest.fn(),
  getDiscordBotDefaultChannel: jest.fn(),
};

const bindings = { getChannelForGame: jest.fn() };

/** A games row wide enough for the badge columns; overrides are type-checked. */
function gameRow(overrides: Partial<LfmGameRow> = {}): LfmGameRow {
  return {
    id: GAME_ID,
    name: 'Deep Rock Galactic',
    slug: 'deep-rock-galactic',
    coverUrl: null,
    cooptimusOnlineMax: 4,
    cooptimusCouchMax: null,
    cooptimusComboCoop: null,
    isFreeToPlay: false,
    itadCurrentPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    itadLowestPrice: null,
    itadPriceUpdatedAt: null,
    ...overrides,
  } as LfmGameRow;
}

/** One roster entry. `displayName` is what the description must render. */
function member(name: string): LfgMemberDto {
  return {
    userId: name.length,
    username: name.toLowerCase(),
    displayName: name,
    avatarUrl: null,
    expiresAt: EXPIRES,
    joinedAt: '2026-09-01T10:00:00.000Z',
  };
}

function live(names: string[]): LfmLiveGroup {
  return {
    members: names.map(member),
    soonestExpiresAt: EXPIRES,
    viabilityThreshold: 4,
  };
}

/** Seed a row the service will find as the game's live message. */
function seedOpenRow(overrides: Partial<LfmMessageRow> = {}): LfmMessageRow {
  const row: LfmMessageRow = {
    id: 'row-1',
    gameId: GAME_ID,
    guildId: 'guild-1',
    channelId: 'chan-1',
    messageId: 'msg-1',
    state: 'open',
    lastMemberCount: 2,
    threadId: null,
    postKind: 'text',
    postedAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    closedAt: null,
    ...overrides,
  };
  rows.push(row);
  return row;
}

/** The game's live row as the fake table holds it right now. */
function openRow(gameId = GAME_ID): LfmMessageRow | null {
  return rows.find((r) => r.gameId === gameId && r.state === 'open') ?? null;
}

function rowById(id: string): LfmMessageRow {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no fake lfg_group_messages row ${id}`);
  return row;
}

/**
 * Wire the mocked data-access module to an in-memory table that ENFORCES the
 * partial unique index. Without that throw the D9 wedge test cannot fail.
 */
function wireStore(): void {
  const s = jest.mocked(store);
  s.findOpenLfmMessage.mockImplementation((_db, gameId) =>
    Promise.resolve(openRow(gameId)),
  );
  s.listOpenLfmMessages.mockImplementation(() =>
    Promise.resolve(rows.filter((r) => r.state === 'open')),
  );
  s.insertLfmMessage.mockImplementation((_db, input) => {
    if (openRow(input.gameId)) {
      return Promise.reject(
        new Error(
          'duplicate key value violates unique constraint "uq_lfg_group_messages_game_open"',
        ),
      );
    }
    rows.push({
      ...input,
      threadId: null,
      postKind: 'text',
      id: `row-${String(rows.length + 1)}`,
      state: 'open',
      postedAt: new Date(),
      updatedAt: new Date(),
      closedAt: null,
    });
    return Promise.resolve();
  });
  s.recordLfmRender.mockImplementation((_db, id, n) => {
    rowById(id).lastMemberCount = n;
    return Promise.resolve();
  });
  s.closeLfmMessage.mockImplementation((_db, id, state, n) => {
    Object.assign(rowById(id), {
      state,
      lastMemberCount: n,
      threadId: null,
      postKind: 'text',
      closedAt: new Date(),
    });
    return Promise.resolve();
  });
  s.deleteLfmMessage.mockImplementation((_db, id) => {
    rows = rows.filter((r) => r.id !== id);
    return Promise.resolve();
  });
  s.loadLfmGame.mockResolvedValue(gameRow());
  s.readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl']));
  s.readConvertedGroup.mockResolvedValue([]);
  s.latestConversionTarget.mockResolvedValue(null);
  s.listUntrackedLfmGames.mockResolvedValue([]);
  s.resolvePollTarget.mockImplementation((_db, matchId) =>
    Promise.resolve({ kind: 'poll', lineupId: LINEUP_ID, matchId }),
  );
}

let service: LfmEmbedService;

beforeEach(async () => {
  jest.resetAllMocks();
  rows = [];
  wireStore();
  client.isConnected.mockReturnValue(true);
  client.getGuildId.mockReturnValue('guild-1');
  client.sendEmbed.mockResolvedValue({ id: 'msg-new' });
  client.editEmbed.mockResolvedValue({ id: 'msg-1' });
  settings.getBranding.mockResolvedValue({ communityName: 'Deep Rock' });
  settings.getClientUrl.mockResolvedValue(CLIENT_URL);
  settings.getDefaultTimezone.mockResolvedValue('UTC');
  settings.getDiscordBotDefaultChannel.mockResolvedValue('chan-default');
  bindings.getChannelForGame.mockResolvedValue(null);

  const module = await Test.createTestingModule({
    providers: [
      LfmEmbedService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: DiscordBotClientService, useValue: client },
      { provide: ChannelBindingsService, useValue: bindings },
      { provide: SettingsService, useValue: settings },
    ],
  }).compile();
  service = module.get(LfmEmbedService);
});

/** The embed payload the Nth `editEmbed` call rendered. */
function edited(index = 0) {
  return client.editEmbed.mock.calls[index][2].data;
}

/** The embed payload the Nth `sendEmbed` call rendered. */
function sent(index = 0) {
  return client.sendEmbed.mock.calls[index][1].data;
}

describe('LFM_REACHED — the first post (D8a)', () => {
  it('posts one message and records the row it will be edited from', async () => {
    await service.onLfmReached({ gameId: GAME_ID, activeCount: 2 });

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
      service.onLfmReached({ gameId: GAME_ID, activeCount: 2 }),
    ).resolves.toBeUndefined();
    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(jest.mocked(store).loadLfmGame).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('edits rather than posting when an open row already exists', async () => {
    seedOpenRow();

    await service.onLfmReached({ gameId: GAME_ID, activeCount: 2 });

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
      service.onLfmReached({ gameId: GAME_ID, activeCount: 2 }),
    ).resolves.toBeUndefined();
    expect(client.sendEmbed).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('never throws into the emitter when Discord rejects the post', async () => {
    client.sendEmbed.mockRejectedValue(new Error('Missing Permissions'));

    await expect(
      service.onLfmReached({ gameId: GAME_ID, activeCount: 2 }),
    ).resolves.toBeUndefined();
    expect(rows).toHaveLength(0);
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

describe('restart reconcile on CONNECTED (D9)', () => {
  it('heals an edit missed while the bot was down', async () => {
    seedOpenRow();
    jest
      .mocked(store)
      .readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl', 'Doretta']));

    await service.onConnected();

    expect(client.editEmbed.mock.calls[0][1]).toBe('msg-1');
    expect(openRow()).toMatchObject({ state: 'open', lastMemberCount: 3 });
  });

  it('closes a group that converted while the bot was down', async () => {
    seedOpenRow();
    const s = jest.mocked(store);
    s.readLiveGroup.mockResolvedValue(live(['Bosco']));
    s.latestConversionTarget.mockResolvedValue({ eventId: EVENT_ID });
    s.readConvertedGroup.mockResolvedValue(
      ['Bosco', 'Karl', 'Doretta'].map(member),
    );

    await service.onConnected();

    expect(edited().author?.name).toBe('■ SCHEDULED · 3 players');
    expect(rowById('row-1')).toMatchObject({ state: 'converted' });
  });

  it('closes a group that simply died while the bot was down', async () => {
    seedOpenRow({ lastMemberCount: 2 });
    jest.mocked(store).readLiveGroup.mockResolvedValue(live([]));

    await service.onConnected();

    expect(edited().author?.name).toBe('■ EXPIRED · 2 were looking');
    expect(rowById('row-1')).toMatchObject({ state: 'expired' });
  });

  it('AC9 wedge — after reconcile the game can post a NEW message again', async () => {
    seedOpenRow({ lastMemberCount: 2 });
    const s = jest.mocked(store);
    s.readLiveGroup.mockResolvedValue(live([]));

    await service.onConnected();
    s.readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl']));
    await service.onLfmReached({ gameId: GAME_ID, activeCount: 2 });

    // Without the reconcile the stale `open` row survives, `onLfmReached`
    // edits it instead of posting, and the partial unique index means this
    // game can NEVER post an LFM message again.
    expect(openRow()?.messageId).toBe('msg-new');
    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
  });

  it('one bad row does not abort the rest of the reconcile', async () => {
    seedOpenRow();
    seedOpenRow({ id: 'row-2', gameId: 43, messageId: 'msg-2' });
    client.editEmbed
      .mockRejectedValueOnce(new Error('Missing Access'))
      .mockResolvedValue({ id: 'msg-2' });

    await expect(service.onConnected()).resolves.toBeUndefined();
    expect(client.editEmbed).toHaveBeenCalledTimes(2);
  });

  it('DISCONNECTED drops nothing — the state lives in the table', () => {
    seedOpenRow();

    service.onDisconnected();

    expect(openRow()).toMatchObject({ messageId: 'msg-1' });
    expect(jest.mocked(store).closeLfmMessage).not.toHaveBeenCalled();
    expect(jest.mocked(store).deleteLfmMessage).not.toHaveBeenCalled();
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

    const first = service.onLfmReached({ gameId: GAME_ID, activeCount: 2 });
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
