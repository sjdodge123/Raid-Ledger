/**
 * VoiceStateListener bot-CONNECTED recovery wiring (TDB:836, TDB:175).
 *
 * The step guards and the success latch are unit-tested in
 * voice-state-connect.helpers.spec.ts; these cases prove the LISTENER feeds
 * them — a guarded chain, and the latched binding-health report rather than
 * the bare one.
 */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Collection } from 'discord.js';
import { VoiceStateListener } from './voice-state.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { DepartureGraceService } from '../services/departure-grace.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { GameActivityService } from '../services/game-activity.service';
import { UsersService } from '../../users/users.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { ChannelPresenceEmbedService } from '../services/channel-presence-embed.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

function makeCollection<K, V>(entries: [K, V][] = []): Collection<K, V> {
  return new Collection<K, V>(entries);
}

function makeClient(channels: [string, unknown][] = []) {
  const guild = { channels: { cache: makeCollection(channels) } };
  return {
    on: jest.fn(),
    removeListener: jest.fn(),
    guilds: { cache: makeCollection([['guild-1', guild]]) },
  };
}

function makeMocks() {
  return {
    client: { getClient: jest.fn(), getGuildId: jest.fn(() => 'guild-1') },
    bindings: {
      getBindings: jest.fn().mockResolvedValue([]),
      getBindingsWithGameNames: jest.fn().mockResolvedValue([]),
    },
    attendance: { recoverActiveSessions: jest.fn().mockResolvedValue(null) },
    presence: {
      recover: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn(),
    },
  };
}
type Mocks = ReturnType<typeof makeMocks>;

/** `db` is non-null only when given, so the binding-health report can run. */
async function buildListener(m: Mocks, db?: object) {
  const optional = db ? [{ provide: DrizzleAsyncProvider, useValue: db }] : [];
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      VoiceStateListener,
      { provide: DiscordBotClientService, useValue: m.client },
      { provide: AdHocEventService, useValue: {} },
      { provide: VoiceAttendanceService, useValue: m.attendance },
      { provide: DepartureGraceService, useValue: {} },
      { provide: ChannelBindingsService, useValue: m.bindings },
      { provide: PresenceGameDetectorService, useValue: {} },
      { provide: GameActivityService, useValue: {} },
      { provide: UsersService, useValue: {} },
      { provide: AdHocEventsGateway, useValue: {} },
      { provide: ChannelPresenceEmbedService, useValue: m.presence },
      ...optional,
    ],
  }).compile();
  return moduleRef.get(VoiceStateListener);
}

describe('VoiceStateListener connect recovery', () => {
  let m: Mocks;
  let listener: VoiceStateListener | undefined;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    m = makeMocks();
    m.client.getClient.mockReturnValue(makeClient());
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    listener?.onBotDisconnected();
    listener = undefined;
    // Restored here, not at the end of a test, so a failing assertion
    // cannot leak the spies into later cases.
    jest.restoreAllMocks();
  });

  it('keeps recovering when recoverActiveSessions rejects (TDB:836)', async () => {
    m.client.getClient.mockReturnValue(
      makeClient([
        [
          'voice-ch-1',
          {
            isVoiceBased: () => true,
            members: makeCollection([['user-1', { id: 'user-1' }]]),
          },
        ],
      ]),
    );
    listener = await buildListener(m);
    m.attendance.recoverActiveSessions.mockRejectedValueOnce(new Error('x'));

    await expect(listener.onBotConnected()).resolves.toBeUndefined();

    expect(m.presence.recover).toHaveBeenCalledTimes(1);
    expect(m.bindings.getBindingsWithGameNames).toHaveBeenCalledWith('guild-1');
    expect(errorSpy).toHaveBeenCalledWith(
      '[voice-connect] recoverActiveSessions failed: Error: x',
    );
  });

  it('runs the binding-health report once across repeated CONNECTEDs (TDB:175)', async () => {
    listener = await buildListener(m, {});

    await listener.onBotConnected();
    await listener.onBotConnected();

    expect(m.bindings.getBindings).toHaveBeenCalledTimes(1);
    expect(m.bindings.getBindings).toHaveBeenCalledWith('guild-1');
  });

  it('retries the binding-health report after a failed one (ROK-1415)', async () => {
    listener = await buildListener(m, {});
    m.bindings.getBindings.mockRejectedValueOnce(new Error('db down'));

    await listener.onBotConnected();
    await listener.onBotConnected();
    await listener.onBotConnected();

    // Fails once, succeeds on the retry, then latches: 2 calls, not 1 or 3.
    expect(m.bindings.getBindings).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      '[binding-heal] health report failed: Error: db down',
    );
  });
});

describe('VoiceStateListener binding-cache sweep', () => {
  let listener: VoiceStateListener | undefined;

  afterEach(() => {
    listener?.onBotDisconnected();
    listener = undefined;
    jest.restoreAllMocks();
  });

  it('restarts the sweep instead of stacking one per CONNECTED', async () => {
    const m = makeMocks();
    m.client.getClient.mockReturnValue(makeClient());
    const SWEEP_MS = 10 * 60 * 1000;
    const setSpy = jest.spyOn(global, 'setInterval');
    const clearSpy = jest.spyOn(global, 'clearInterval');
    listener = await buildListener(m);

    await listener.onBotConnected();
    await listener.onBotConnected();
    listener.onBotDisconnected();

    const started = setSpy.mock.calls
      .map((call, i) => ({ ms: call[1], timer: setSpy.mock.results[i]?.value }))
      .filter((s) => s.ms === SWEEP_MS)
      .map((s) => s.timer as unknown);
    const cleared = new Set(clearSpy.mock.calls.map(([t]) => t as unknown));
    expect(started).toHaveLength(2);
    // An orphaned sweep is a ref'd interval that keeps the process alive.
    expect(started.filter((t) => !cleared.has(t))).toEqual([]);
  });
});
