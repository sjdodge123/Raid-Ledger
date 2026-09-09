/**
 * ROK-1471 — the forum surface is dispatched, not subscribed.
 *
 * Relocated verbatim out of `lfm-embed.service.spec.ts`: merging main pushed
 * that file to 753 counted lines against the 750-line ESLint cap for specs.
 * Nothing here was rewritten — the assertions and the reasoning above them are
 * the originals, moved with their harness.
 *
 * The harness below is duplicated rather than shared, the same way
 * `lfm-embed.session.spec.ts` duplicates it: a shared spec-helpers module is
 * already being introduced on a sibling branch (ROK-1505) and a competing
 * extraction here would collide at merge time.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { EmbedBuilder } from 'discord.js';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { LfgBoardService } from '../lfg-board/lfg-board.service';
import { THREAD_MIRROR_EVENTS } from '../thread-mirror/thread-mirror.constants';
import { LfmEmbedService } from './lfm-embed.service';
import * as store from './lfm-embed.db-helpers';
import type {
  LfmGameRow,
  LfmLiveGroup,
  LfmMessageRow,
} from './lfm-embed.db-helpers';

jest.mock('./lfm-embed.db-helpers');

const GAME_ID = 42;
const LINEUP_ID = 77;
const CLIENT_URL = 'https://raid.example';
const EXPIRES = '2026-09-17T23:30:00.000Z';

let rows: LfmMessageRow[] = [];

const client = {
  isConnected: jest.fn<boolean, []>(),
  getGuildId: jest.fn<string | null, []>(),
  getGuild: jest.fn(),
  sendEmbed: jest.fn<
    Promise<{ id: string }>,
    [string, EmbedBuilder, undefined, string]
  >(),
  editEmbed: jest.fn<Promise<{ id: string }>, [string, string, EmbedBuilder]>(),
};

const FORUM_ID = 'forum-1';
const BOARD_THREAD = 'thread-9';

/** The forum surface adapter. Never the event consumer — see `lfg-board.service.ts`. */
const board = {
  resolveForum: jest.fn(),
  postThread: jest.fn(),
  editThread: jest.fn(),
};

const settings = {
  get: jest.fn(),
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
    urgency: 'week',
    avatarUrl: null,
    expiresAt: EXPIRES,
    joinedAt: '2026-09-01T10:00:00.000Z',
  };
}

function live(names: string[]): LfmLiveGroup {
  return {
    members: names.map(member),
    soonestExpiresAt: EXPIRES,
    nowCount: 0,
    soonestNowExpiresAt: null,
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
      threadId: input.threadId ?? null,
      postKind: input.postKind ?? 'text',
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
    // Closing must not re-home a row: `post_kind` is pinned at post time (E4).
    Object.assign(rowById(id), {
      state,
      lastMemberCount: n,
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
  // ROK-1494 — no live session unless a test says so. The module is
  // auto-mocked, so an unwired read would resolve `undefined` and every
  // reconcile would take the playing branch.
  s.readOpenLfgNowEventId.mockResolvedValue(null);
  s.listUntrackedLfmGames.mockResolvedValue([]);
  s.resolvePollTarget.mockImplementation((_db, matchId) =>
    Promise.resolve({ kind: 'poll', lineupId: LINEUP_ID, matchId }),
  );
}

/** The ROK-1471 adapter's defaults: board OFF unless a test enables it. */
function wireBoard(): void {
  board.resolveForum.mockResolvedValue({ id: FORUM_ID });
  board.postThread.mockResolvedValue({
    threadId: BOARD_THREAD,
    starterMessageId: 'starter-9',
  });
  board.editThread.mockResolvedValue(undefined);
  settings.get.mockResolvedValue(null);
}

let service: LfmEmbedService;
const emitter = { emit: jest.fn() };

beforeEach(async () => {
  jest.resetAllMocks();
  rows = [];
  wireStore();
  client.isConnected.mockReturnValue(true);
  client.getGuildId.mockReturnValue('guild-1');
  client.getGuild.mockReturnValue({ id: 'guild-1' });
  wireBoard();
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
      { provide: LfgBoardService, useValue: board },
      { provide: SettingsService, useValue: settings },
      { provide: EventEmitter2, useValue: emitter },
    ],
  }).compile();
  service = module.get(LfmEmbedService);
});

describe('ROK-1471 — the forum surface is dispatched, not subscribed', () => {
  /** Flip the master toggle on. The surface helper reads it through `get`. */
  function enableBoard(): void {
    settings.get.mockResolvedValue('true');
  }

  it('posts through the board adapter and tracks the THREAD as the channel', async () => {
    enableBoard();

    await service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
    });

    expect(board.postThread).toHaveBeenCalledWith(
      FORUM_ID,
      expect.objectContaining({ state: 'open', memberCount: 2 }),
      expect.objectContaining({ clientUrl: CLIENT_URL }),
    );
    expect(client.sendEmbed).not.toHaveBeenCalled();
    // ROK-1483 D4: the mirror learns about the thread from this event and
    // nothing else. Without it a group's conversation is never backfilled and
    // the panel is permanently empty until the bot next reconnects.
    expect(emitter.emit).toHaveBeenCalledWith(THREAD_MIRROR_EVENTS.BOUND, {
      threadId: BOARD_THREAD,
      guildId: 'guild-1',
      surfaceKind: 'lfg-group',
      surfaceId: String(GAME_ID),
    });
    // ...and AFTER the row is written, never before: the mirror's listener
    // resolves the surface FROM `lfg_group_messages`, so a BOUND that lands
    // first resolves nothing and backfills nothing.
    expect(emitter.emit.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(store).insertLfmMessage.mock.invocationCallOrder[0],
    );
    // `channel_id` MUST be the thread: a button interaction inside a forum post
    // carries the thread as its `channelId`, and `findLfmMessageByIds` matches
    // on that. Storing the forum id makes the +1 silently unresolvable.
    expect(openRow()).toMatchObject({
      postKind: 'forum',
      channelId: BOARD_THREAD,
      threadId: BOARD_THREAD,
      messageId: 'starter-9',
    });
  });

  it('falls back to the text board when the forum post could not be made (E2)', async () => {
    enableBoard();
    board.postThread.mockResolvedValue(null);

    await service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
    });

    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
    expect(openRow()).toMatchObject({
      postKind: 'text',
      channelId: 'chan-default',
    });
    // No thread was created, so nothing may be bound: a BOUND here would send
    // the mirror walking a thread id that does not exist.
    expect(emitter.emit).not.toHaveBeenCalledWith(
      THREAD_MIRROR_EVENTS.BOUND,
      expect.anything(),
    );
  });

  it('edits a forum row through the adapter and never through editEmbed', async () => {
    const row = seedOpenRow({ postKind: 'forum', threadId: BOARD_THREAD });
    enableBoard();

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });

    expect(board.editThread).toHaveBeenCalledTimes(1);
    expect(client.editEmbed).not.toHaveBeenCalled();
    expect(row.lastMemberCount).toBe(2);
  });

  it('keeps a text row on text even while the board is enabled (E4/E5)', async () => {
    seedOpenRow({ postKind: 'text' });
    enableBoard();

    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });

    expect(client.editEmbed).toHaveBeenCalledTimes(1);
    expect(board.editThread).not.toHaveBeenCalled();
  });
});
