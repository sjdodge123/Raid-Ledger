/**
 * Fixtures for the `LfmEmbedService` unit specs — the in-memory
 * `lfg_group_messages` table, the mocked collaborators and the module wiring.
 *
 * Split out of `lfm-embed.service.spec.ts` (ROK-1505) once that file reached
 * 736 of its 750 counted lines, so sibling specs (`lfm-embed.reconcile.spec.ts`,
 * `lfm-embed.hand-raised.spec.ts`) share ONE fake table rather than three
 * copies that drift. Each spec still declares
 * `jest.mock('./lfm-embed.db-helpers')` itself — the mock is per test file and
 * hoisted above this import, which is what makes `store` here the mocked one.
 */
import { Test } from '@nestjs/testing';
import type { EmbedBuilder } from 'discord.js';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { LfgBoardService } from '../lfg-board/lfg-board.service';
import { LfmEmbedService } from './lfm-embed.service';
import * as store from './lfm-embed.db-helpers';
import type {
  LfmGameRow,
  LfmLiveGroup,
  LfmMessageRow,
} from './lfm-embed.db-helpers';

export const GAME_ID = 42;
export const EVENT_ID = 900;
export const MATCH_ID = 501;
export const LINEUP_ID = 77;
export const CLIENT_URL = 'https://raid.example';
export const EXPIRES = '2026-09-17T23:30:00.000Z';

let rows: LfmMessageRow[] = [];

export const client = {
  isConnected: jest.fn<boolean, []>(),
  getGuildId: jest.fn<string | null, []>(),
  getGuild: jest.fn(),
  sendEmbed: jest.fn<
    Promise<{ id: string }>,
    [string, EmbedBuilder, undefined, string]
  >(),
  editEmbed: jest.fn<Promise<{ id: string }>, [string, string, EmbedBuilder]>(),
};

export const FORUM_ID = 'forum-1';
export const BOARD_THREAD = 'thread-9';

/** The forum surface adapter. Never the event consumer — see `lfg-board.service.ts`. */
export const board = {
  resolveForum: jest.fn(),
  postThread: jest.fn(),
  editThread: jest.fn(),
};

export const settings = {
  get: jest.fn(),
  getBranding: jest.fn(),
  getClientUrl: jest.fn(),
  getDefaultTimezone: jest.fn(),
  getDiscordBotDefaultChannel: jest.fn(),
};

export const bindings = { getChannelForGame: jest.fn() };

/** A games row wide enough for the badge columns; overrides are type-checked. */
export function gameRow(overrides: Partial<LfmGameRow> = {}): LfmGameRow {
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
export function member(name: string): LfgMemberDto {
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

export function live(names: string[]): LfmLiveGroup {
  return {
    members: names.map(member),
    soonestExpiresAt: EXPIRES,
    nowCount: 0,
    soonestNowExpiresAt: null,
    viabilityThreshold: 4,
  };
}

/** Seed a row the service will find as the game's live message. */
export function seedOpenRow(
  overrides: Partial<LfmMessageRow> = {},
): LfmMessageRow {
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
export function openRow(gameId = GAME_ID): LfmMessageRow | null {
  return rows.find((r) => r.gameId === gameId && r.state === 'open') ?? null;
}

export function rowById(id: string): LfmMessageRow {
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

/** Every row the fake table holds, open or closed. */
export function allRows(): LfmMessageRow[] {
  return rows;
}

/**
 * Reset every mock and the fake table, then compile a fresh service. Call it
 * from each spec's `beforeEach`.
 */
export async function createService(): Promise<LfmEmbedService> {
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
    ],
  }).compile();
  return module.get(LfmEmbedService);
}

/** The embed payload the Nth `editEmbed` call rendered. */
export function edited(index = 0) {
  return client.editEmbed.mock.calls[index][2].data;
}

/** The embed payload the Nth `sendEmbed` call rendered. */
export function sent(index = 0) {
  return client.sendEmbed.mock.calls[index][1].data;
}
