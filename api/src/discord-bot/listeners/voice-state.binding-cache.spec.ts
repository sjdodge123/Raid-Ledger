/**
 * A binding write evicts the voice listener's 60 s binding cache entry.
 *
 * Before this, only a bot connect/disconnect cleared the cache, so a join
 * inside the TTL was dispatched against a binding that had just been deleted
 * (and a binding created inside it was ignored). The real
 * ChannelBindingsService and EventEmitterModule are wired so the test covers
 * the emit, the subscription and the eviction together.
 */
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { VoiceStateListener } from './voice-state.listener';
import type { ResolvedBinding } from './voice-state.helpers';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { CHANNEL_BINDING_EVENTS } from '../services/channel-binding-events';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { DepartureGraceService } from '../services/departure-grace.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { GameActivityService } from '../services/game-activity.service';
import { UsersService } from '../../users/users.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { ChannelPresenceEmbedService } from '../services/channel-presence-embed.service';

const CH = 'vc-1';
const UNUSED = [
  AdHocEventService,
  VoiceAttendanceService,
  DepartureGraceService,
  PresenceGameDetectorService,
  GameActivityService,
  UsersService,
  AdHocEventsGateway,
  ChannelPresenceEmbedService,
];

/** A stored game-voice-monitor row on `channelId`, as the DB query returns it. */
function row(id: string, channelId = CH) {
  return {
    id,
    guildId: 'g-1',
    channelId,
    channelType: 'voice',
    bindingPurpose: 'game-voice-monitor',
    gameId: 1,
    recurrenceGroupId: null,
    config: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    gameName: 'Game A',
  };
}

type Resolver = { resolveAllBindings(ch: string): Promise<ResolvedBinding[]> };

async function setup() {
  const deleted = jest.fn();
  const db = { delete: () => ({ where: () => ({ returning: deleted }) }) };
  const module: TestingModule = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    providers: [
      VoiceStateListener,
      ChannelBindingsService,
      { provide: DrizzleAsyncProvider, useValue: db },
      {
        provide: DiscordBotClientService,
        useValue: { getGuildId: () => 'g-1', getClient: () => null },
      },
      ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  await module.init();
  const bindings = module.get(ChannelBindingsService);
  const stored = jest.spyOn(bindings, 'getBindingsWithGameNames');
  const listener = module.get<VoiceStateListener, Resolver>(VoiceStateListener);
  const resolve = async (ch = CH) =>
    (await listener.resolveAllBindings(ch)).map((b) => b.bindingId);
  return { module, bindings, stored, deleted, resolve };
}

describe('VoiceStateListener binding cache — evicted on a binding write', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.module.close();
  });

  it('a binding deleted by unbindById is no longer served inside the TTL', async () => {
    ctx.stored.mockResolvedValue([row('b-old')]);
    expect(await ctx.resolve()).toEqual(['b-old']);

    ctx.stored.mockResolvedValue([row('b-new')]);
    ctx.deleted.mockResolvedValue([row('b-old')]);
    await ctx.bindings.unbindById('b-old');

    expect(await ctx.resolve()).toEqual(['b-new']);
  });

  it("a write on another channel leaves this channel's entry cached", async () => {
    ctx.stored.mockResolvedValue([row('b-1')]);
    await ctx.resolve();

    ctx.module
      .get(EventEmitter2)
      .emit(CHANNEL_BINDING_EVENTS.CHANGED, { channelId: 'vc-other' });

    expect(await ctx.resolve()).toEqual(['b-1']);
    expect(ctx.stored).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceStateListener binding cache — [voice-bind] lines (ROK-1390)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let log: jest.SpyInstance;
  const SERIES_ROW = { ...row('b-1'), recurrenceGroupId: 'rg-1' };

  const voiceBindLines = () =>
    log.mock.calls
      .map(([message]) => String(message))
      .filter((m) => m.startsWith('[voice-bind]'));

  beforeEach(async () => {
    ctx = await setup();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    log.mockRestore();
    await ctx.module.close();
  });

  it('a lookup logs a miss with the guild queried, then a hit, naming each binding', async () => {
    ctx.stored.mockResolvedValue([SERIES_ROW, row('b-2', 'vc-other')]);
    await ctx.resolve();
    await ctx.resolve();

    expect(voiceBindLines()).toEqual([
      '[voice-bind] resolve ch=vc-1 cache=miss guild=g-1 bindings=[b-1:game-voice-monitor:series=rg-1]',
      expect.stringMatching(
        /^\[voice-bind\] resolve ch=vc-1 cache=hit age=\d+ms bindings=\[b-1:game-voice-monitor:series=rg-1\]$/,
      ),
    ]);
  });

  it('a binding-changed event logs the channel and the binding ids it evicted', async () => {
    ctx.stored.mockResolvedValue([SERIES_ROW]);
    await ctx.resolve();
    const emitter = ctx.module.get(EventEmitter2);
    emitter.emit(CHANNEL_BINDING_EVENTS.CHANGED, { channelId: CH });
    emitter.emit(CHANNEL_BINDING_EVENTS.CHANGED, { channelId: 'vc-unseen' });

    expect(voiceBindLines()).toEqual([
      '[voice-bind] resolve ch=vc-1 cache=miss guild=g-1 bindings=[b-1:game-voice-monitor:series=rg-1]',
      '[voice-bind] event=channel-binding.changed ch=vc-1 evicted=[b-1:game-voice-monitor:series=rg-1]',
      '[voice-bind] event=channel-binding.changed ch=vc-unseen evicted=none',
    ]);
  });
});
