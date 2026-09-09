/**
 * ROK-1494 AC7 — `LFM_REACHED` must not paint over a live session.
 *
 * The round-2 fix gave `viewForChange` and `reconcileView` a `sessionView`
 * precedence, but left the THIRD render path — `postOrHeal`, the `LFM_REACHED`
 * handler — on a bare `liveView`. A spawned group has converted every intent,
 * so that read returns an EMPTY group: the next `LFM_REACHED` for the game
 * (two more now-hands arrive and the count goes 1 -> 2 again) re-rendered
 * `◌ NEEDS PLAYERS · 0 looking` straight over `▸ PLAYING NOW`, stamped
 * `last_member_count = 0`, and left the row `open` — `TERMINAL_STATE.playing`
 * is null — so nothing ever restored it. Measured on the fleet:
 * `planning-artifacts/diag-ROK-1494-ac7.md` §A, the 00:59:07.751 render.
 *
 * Its own spec rather than `lfm-embed.service.spec.ts` for the reason that
 * file's sibling `lfm-embed.views.spec.ts` already gives: the service spec is
 * at 736/750 counted lines.
 *
 * MUTATION: change `currentView` back to `liveView` in
 * `LfmEmbedService.postOrHeal` and both cases fail on
 * `expect(received).toBe('▸ PLAYING NOW · 2 in voice')`.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { EmbedBuilder } from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { LfgBoardService } from '../lfg-board/lfg-board.service';
import { LfmEmbedService } from './lfm-embed.service';
import * as store from './lfm-embed.db-helpers';
import type { LfmGameRow, LfmMessageRow } from './lfm-embed.db-helpers';
import type { LfgLfmReachedPayload } from '../../lfg/lfg.constants';

jest.mock('./lfm-embed.db-helpers');

const GAME_ID = 42;
const EVENT_ID = 900;
const VOICE_URL = 'https://discord.com/channels/guild-1/voice-1';

/** The payload `LfgService.announcePost` emits for a now-hand pair (D7). */
const NOW_REACHED: LfgLfmReachedPayload = {
  gameId: GAME_ID,
  activeCount: 2,
  urgency: 'now',
  ttlMinutes: 60,
};

/** The session the spawn left behind: two players already in voice. */
const SESSION = {
  names: ['Bosco', 'Karl'],
  count: 2,
  voiceChannelUrl: VOICE_URL,
};

const game = {
  id: GAME_ID,
  name: 'Deep Rock Galactic',
  slug: 'deep-rock-galactic',
  coverUrl: null,
  cooptimusOnlineMax: 4,
} as LfmGameRow;

/** The row a spawned group's post already occupies. */
const openRow = {
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
} as LfmMessageRow;

const client = {
  isConnected: jest.fn<boolean, []>(),
  getGuildId: jest.fn<string | null, []>(),
  getGuild: jest.fn(),
  sendEmbed: jest.fn<Promise<{ id: string }>, unknown[]>(),
  editEmbed: jest.fn<Promise<{ id: string }>, [string, string, EmbedBuilder]>(),
};
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
/**
 * ROK-1483 added `EventEmitter2` as a constructor dependency of
 * `LfmEmbedService` (it announces THREAD_MIRROR bound events). This spec
 * predates that change on the branch, so the module failed to compile after
 * the merge with main. Nothing here asserts on it.
 */
const emitter = { emit: jest.fn() };

let service: LfmEmbedService;

beforeEach(async () => {
  jest.resetAllMocks();
  const s = jest.mocked(store);
  s.loadLfmGame.mockResolvedValue(game);
  // The spawn converted every intent, so the live read reports NOBODY. This is
  // the value the pre-fix `postOrHeal` rendered over the session with.
  s.readLiveGroup.mockResolvedValue({
    members: [],
    soonestExpiresAt: null,
    nowCount: 0,
    soonestNowExpiresAt: null,
    viabilityThreshold: 4,
  });
  s.readOpenLfgNowEventId.mockResolvedValue(EVENT_ID);
  s.readPlayingSession.mockResolvedValue(SESSION);
  s.findOpenLfmMessage.mockResolvedValue(openRow);
  s.insertLfmMessage.mockResolvedValue(undefined);
  s.recordLfmRender.mockResolvedValue(undefined);
  client.isConnected.mockReturnValue(true);
  client.getGuildId.mockReturnValue('guild-1');
  client.getGuild.mockReturnValue({ id: 'guild-1' });
  client.editEmbed.mockResolvedValue({ id: 'msg-1' });
  client.sendEmbed.mockResolvedValue({ id: 'msg-new' });
  settings.get.mockResolvedValue(null);
  settings.getBranding.mockResolvedValue({ communityName: 'Deep Rock' });
  settings.getClientUrl.mockResolvedValue('https://raid.example');
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

describe('LFM_REACHED on a game whose session is already live (AC7)', () => {
  it('edits the existing post back to PLAYING NOW, never to the empty group', async () => {
    await service.onLfmReached(NOW_REACHED);

    expect(client.editEmbed).toHaveBeenCalledTimes(1);
    expect(client.editEmbed.mock.calls[0][2].data.author?.name).toBe(
      '▸ PLAYING NOW · 2 in voice',
    );
    // The head-count that gets stamped is the SESSION's, not zero: a `0` here
    // is the row state that made the post unrecoverable on the fleet.
    expect(jest.mocked(store).recordLfmRender).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      2,
    );
  });

  it('posts a first message in the PLAYING state when no row exists yet', async () => {
    jest.mocked(store).findOpenLfmMessage.mockResolvedValue(null);

    await service.onLfmReached(NOW_REACHED);

    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
    const embed = client.sendEmbed.mock.calls[0][1] as EmbedBuilder;
    expect(embed.data.author?.name).toBe('▸ PLAYING NOW · 2 in voice');
  });
});
