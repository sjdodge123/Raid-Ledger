/**
 * ROK-1692 — an emptied lobby room is re-flushed when its grace runs out.
 *
 * The drain only flushes DIRTY channels, and an empty room produces no voice
 * events, so before this the only thing that ever re-flushed it was the 5-min
 * reaper cron: the brief-visit delete (and every `empty` close) landed up to
 * six minutes late, and a rejoin in that gap closed the row `stale` with its
 * recap still in the channel. `flushChannel` now reports when the room's grace
 * runs out and the service re-marks the channel on the first tick at or after
 * that instant.
 *
 * `flushChannel` is mocked: the ladder itself is pinned by the flush specs;
 * what is only observable here is the service's scheduling.
 */
jest.mock('./channel-presence-flush', () => ({
  __esModule: true,
  flushChannel: jest.fn(),
}));
jest.mock('./channel-presence-store.helpers', () => ({
  __esModule: true,
  closeRow: jest.fn(),
  listOpenRows: jest.fn(),
}));
jest.mock('../discord-bot-client.messages.helpers', () => ({
  __esModule: true,
  fetchMessageOrNull: jest.fn(),
}));
jest.mock('../listeners/voice-state.helpers', () => ({
  __esModule: true,
  resolveAllBindings: jest.fn(),
}));

import {
  ChannelPresenceEmbedService,
  PRESENCE_FLUSH_INTERVAL_MS as TICK,
} from './channel-presence-embed.service';
import { flushChannel } from './channel-presence-flush';
import { listOpenRows } from './channel-presence-store.helpers';
import { fetchMessageOrNull } from '../discord-bot-client.messages.helpers';
import { resolveAllBindings } from '../listeners/voice-state.helpers';

const VOICE = 'vc-1';
const NOW = Date.parse('2026-09-26T19:15:00Z');
const GRACE = 60_000;
const flushes = jest.mocked(flushChannel);

function build(): ChannelPresenceEmbedService {
  return new ChannelPresenceEmbedService(
    {} as never,
    { getClient: () => ({}), getGuildId: () => 'g-1' } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

/** A service that has adopted `rows` and started its 5 s drain. */
async function started(rows: unknown[] = []) {
  jest.mocked(listOpenRows).mockResolvedValue(rows as never);
  const service = build();
  await service.recover();
  service.onModuleInit();
  return service;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  flushes.mockResolvedValue(null);
  jest.mocked(fetchMessageOrNull).mockResolvedValue({} as never);
  jest
    .mocked(resolveAllBindings)
    .mockResolvedValue([
      { bindingPurpose: 'general-lobby', bindingId: 'b-1' },
    ] as never);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('an emptied room is re-flushed when its grace runs out (ROK-1692)', () => {
  it('flushes again on the first tick at the grace — no voice event, no reaper', async () => {
    const service = await started();
    flushes.mockResolvedValueOnce(NOW + GRACE);
    service.markDirty(VOICE);
    await service.flushNow();
    expect(flushes).toHaveBeenCalledTimes(1);

    // Inside the grace the room is NOT re-flushed every tick.
    await jest.advanceTimersByTimeAsync(GRACE - TICK);
    expect(flushes).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(TICK);
    expect(flushes).toHaveBeenCalledTimes(2);
    expect(flushes.mock.calls[1][0].channelId).toBe(VOICE);

    // That flush closed the row (it reported nothing pending): no more.
    await jest.advanceTimersByTimeAsync(TICK * 10);
    expect(flushes).toHaveBeenCalledTimes(2);
  });

  it('re-arms after an API restart: recovery adopts the row and its flush reschedules', async () => {
    // The in-memory schedule died with the old process; `recover()` marks
    // every open row dirty, and that first flush reports the remaining grace.
    flushes.mockResolvedValueOnce(NOW + TICK + GRACE);
    await started([{ id: 'row-1', voiceChannelId: VOICE }]);

    await jest.advanceTimersByTimeAsync(TICK);
    expect(flushes).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(GRACE);
    expect(flushes).toHaveBeenCalledTimes(2);
  });

  it('drops the pending re-check when a rejoin reports nothing pending', async () => {
    const service = await started();
    flushes.mockResolvedValueOnce(NOW + GRACE);
    service.markDirty(VOICE);
    await service.flushNow();
    // Someone rejoins inside the grace: the live flush reports nothing.
    service.markDirty(VOICE);
    await service.flushNow();

    await jest.advanceTimersByTimeAsync(GRACE + TICK * 2);
    expect(flushes).toHaveBeenCalledTimes(2);
  });

  it('forgets every pending re-check on clear()', async () => {
    const service = await started();
    flushes.mockResolvedValueOnce(NOW + GRACE);
    service.markDirty(VOICE);
    await service.flushNow();
    service.clear();
    await service.recover();

    await jest.advanceTimersByTimeAsync(GRACE + TICK * 2);
    expect(flushes).toHaveBeenCalledTimes(1);
  });
});

describe('forgetBinding — the seam reads the binding that exists now (ROK-1692)', () => {
  /** A caching stand-in for `resolveAllBindings`, keyed like the real one. */
  function cachingBindings(current: { value: unknown[] }) {
    jest
      .mocked(resolveAllBindings)
      .mockImplementation((_deps, channelId, cache) => {
        const hit = cache.get(channelId);
        if (hit) return Promise.resolve(hit.value);
        cache.set(channelId, {
          cachedAt: Date.now(),
          value: current.value as never,
        });
        return Promise.resolve(current.value as never);
      });
  }

  const lobby = (bindingId: string, gracePeriod?: number) => ({
    bindingPurpose: 'general-lobby',
    bindingId,
    config: { minPlayers: 2, ...(gracePeriod ? { gracePeriod } : {}) },
  });

  it('a flush after forgetBinding resolves the re-created binding, not the cached one', async () => {
    const current = { value: [lobby('b-old')] as unknown[] };
    cachingBindings(current);
    const service = await started();
    service.markDirty(VOICE);
    await service.flushNow();

    // The previous test deletes its binding and the next one binds the same
    // channel with a 1-minute grace — inside the 60 s cache TTL.
    current.value = [lobby('b-new', 1)];
    service.forgetBinding(VOICE);
    service.markDirty(VOICE);
    await service.flushNow();

    expect(flushes).toHaveBeenCalledTimes(2);
    expect(flushes.mock.calls[1][0].binding).toEqual(lobby('b-new', 1));
  });

  it('without it, the cache keeps serving the deleted binding (why the seam calls it)', async () => {
    const current = { value: [lobby('b-old')] as unknown[] };
    cachingBindings(current);
    const service = await started();
    service.markDirty(VOICE);
    await service.flushNow();

    current.value = [lobby('b-new', 1)];
    service.markDirty(VOICE);
    await service.flushNow();

    expect(flushes.mock.calls[1][0].binding).toEqual(lobby('b-old'));
  });
});
