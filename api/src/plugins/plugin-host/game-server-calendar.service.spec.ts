import { Logger } from '@nestjs/common';
import type {
  GameServerCalendarItemDto,
  GameServerCalendarQueryDto,
  GameServerMarkerItemDto,
  GameServerStatusDto,
  GameServerWindowItemDto,
} from '@raid-ledger/contract';
import { GameServerCalendarService } from './game-server-calendar.service';
import { GAME_SERVER_PROVIDER_TIMEOUT_MS } from './game-server-calendar.helpers';
import { EXTENSION_POINTS, type GameServerProvider } from './extension-points';
import type { PluginRegistryService } from './plugin-registry.service';

const FROM = '2026-10-01T00:00:00.000Z';
const TO = '2026-10-31T00:00:00.000Z';

function windowItem(
  over: Partial<GameServerWindowItemDto> = {},
): GameServerWindowItemDto {
  return {
    kind: 'window',
    serverKey: 'srv-1',
    serverName: 'Alpha',
    gameId: 7,
    provider: 'ignored',
    start: '2026-10-05T10:00:00.000Z',
    end: '2026-10-05T11:00:00.000Z',
    label: 'Maintenance',
    source: 'schedule',
    ...over,
  };
}

function markerItem(
  over: Partial<GameServerMarkerItemDto> = {},
): GameServerMarkerItemDto {
  return {
    kind: 'marker',
    serverKey: 'srv-2',
    serverName: 'Bravo',
    gameId: 3,
    provider: 'ignored',
    at: '2026-10-04T08:00:00.000Z',
    effect: 'restart',
    label: 'Nightly restart',
    ...over,
  };
}

function status(over: Partial<GameServerStatusDto> = {}): GameServerStatusDto {
  return {
    serverKey: 'srv-1',
    serverName: 'Alpha',
    gameId: 7,
    provider: 'ignored',
    state: 'running',
    checkedAt: '2026-10-05T10:00:00.000Z',
    ...over,
  };
}

type CalendarFn = GameServerProvider['getCalendarItems'];
type StatusFn = GameServerProvider['getStatuses'];

function fakeProvider(
  slug: string,
  calendar:
    GameServerCalendarItemDto[] | (() => Promise<GameServerCalendarItemDto[]>),
  statuses: GameServerStatusDto[] | (() => Promise<GameServerStatusDto[]>) = [],
) {
  const getCalendarItems = jest.fn<
    ReturnType<CalendarFn>,
    Parameters<CalendarFn>
  >(
    typeof calendar === 'function' ? calendar : () => Promise.resolve(calendar),
  );
  const getStatuses = jest.fn<ReturnType<StatusFn>, Parameters<StatusFn>>(
    typeof statuses === 'function' ? statuses : () => Promise.resolve(statuses),
  );
  const provider: GameServerProvider = {
    pluginSlug: slug,
    providerLabel: `Label ${slug}`,
    getCalendarItems,
    getStatuses,
  };
  return { provider, getCalendarItems, getStatuses };
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
const reject = <T>(): Promise<T> => Promise.reject(new Error('boom'));

let warn: jest.SpyInstance;

function build(providers: GameServerProvider[], inactive: string[] = []) {
  const registry = {
    getMultiAdapters: jest.fn(() => providers),
    isActive: jest.fn((slug: string) => !inactive.includes(slug)),
  };
  const service = new GameServerCalendarService(
    registry as unknown as PluginRegistryService,
  );
  return { service, registry };
}

const calendarQuery = (gameIds?: number[]): GameServerCalendarQueryDto => ({
  from: FROM,
  to: TO,
  gameIds,
});

beforeEach(() => {
  warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('GameServerCalendarService — provider selection', () => {
  it('returns empty data for both endpoints when no provider is registered', async () => {
    const { service, registry } = build([]);
    await expect(service.getCalendarItems(calendarQuery())).resolves.toEqual({
      data: [],
    });
    await expect(service.getStatuses()).resolves.toEqual({ data: [] });
    expect(registry.getMultiAdapters).toHaveBeenCalledWith(
      EXTENSION_POINTS.GAME_SERVER_PROVIDER,
      '*',
    );
  });

  it('never calls or returns an inactive provider', async () => {
    const a = fakeProvider('fake-a', [windowItem()], [status()]);
    const b = fakeProvider(
      'fake-b',
      [markerItem()],
      [status({ serverKey: 'b' })],
    );
    const { service } = build([a.provider, b.provider], ['fake-b']);
    const cal = await service.getCalendarItems(calendarQuery());
    const st = await service.getStatuses();
    expect(cal.data.map((i) => i.provider)).toEqual(['Label fake-a']);
    expect(st.data.map((s) => s.provider)).toEqual(['Label fake-a']);
    expect(b.getCalendarItems).not.toHaveBeenCalled();
    expect(b.getStatuses).not.toHaveBeenCalled();
  });
});

describe('GameServerCalendarService — failing providers', () => {
  it('skips and logs a provider that rejects; others still returned', async () => {
    const a = fakeProvider('fake-a', [windowItem()], [status()]);
    const b = fakeProvider('fake-b', reject, reject);
    const { service } = build([a.provider, b.provider]);
    const cal = await service.getCalendarItems(calendarQuery());
    const st = await service.getStatuses();
    expect(cal.data).toHaveLength(1);
    expect(st.data).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"fake-b" failed: boom'),
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('skips and logs a provider that throws synchronously', async () => {
    const a = fakeProvider('fake-a', [windowItem()]);
    const b = fakeProvider('fake-b', () => {
      throw new Error('sync boom');
    });
    const { service } = build([a.provider, b.provider]);
    const cal = await service.getCalendarItems(calendarQuery());
    expect(cal.data.map((i) => i.provider)).toEqual(['Label fake-a']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"fake-b" failed: sync boom'),
    );
  });
});

describe('GameServerCalendarService — provider timeout', () => {
  it('times out a never-resolving calendar provider after 5s and returns the others', async () => {
    jest.useFakeTimers();
    const a = fakeProvider('fake-a', [windowItem()]);
    const b = fakeProvider('fake-hang', never);
    const { service } = build([a.provider, b.provider]);
    let settled = false;
    const pending = service.getCalendarItems(calendarQuery()).then((r) => {
      settled = true;
      return r;
    });
    await jest.advanceTimersByTimeAsync(GAME_SERVER_PROVIDER_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const cal = await pending;
    expect(cal.data.map((i) => i.provider)).toEqual(['Label fake-a']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"fake-hang" failed: timed out after 5000ms'),
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out a never-resolving status provider the same way', async () => {
    jest.useFakeTimers();
    const a = fakeProvider('fake-a', [], [status()]);
    const b = fakeProvider('fake-hang', [], never);
    const { service } = build([a.provider, b.provider]);
    const pending = service.getStatuses();
    await jest.advanceTimersByTimeAsync(GAME_SERVER_PROVIDER_TIMEOUT_MS);
    const st = await pending;
    expect(st.data.map((s) => s.provider)).toEqual(['Label fake-a']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"fake-hang" failed: timed out'),
    );
  });

  it('clears the timeout timer when a provider resolves in time', async () => {
    jest.useFakeTimers();
    const a = fakeProvider('fake-a', [windowItem()]);
    const { service } = build([a.provider]);
    await service.getCalendarItems(calendarQuery());
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('GameServerCalendarService — invalid payloads', () => {
  it('skips and logs a provider whose payload fails the contract schema', async () => {
    const a = fakeProvider('fake-a', [windowItem()], [status()]);
    const b = fakeProvider(
      'fake-b',
      [markerItem({ gameId: -1 })],
      [status({ gameId: -1 })],
    );
    const { service } = build([a.provider, b.provider]);
    const cal = await service.getCalendarItems(calendarQuery());
    const st = await service.getStatuses();
    expect(cal.data.map((i) => i.provider)).toEqual(['Label fake-a']);
    expect(st.data.map((s) => s.provider)).toEqual(['Label fake-a']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"fake-b" returned invalid data'),
    );
  });
});

describe('GameServerCalendarService — stamp, strip, filter, sort', () => {
  it('stamps the provider label and strips keys a provider leaked', async () => {
    const leaky = { ...windowItem(), address: '10.0.0.5' };
    const a = fakeProvider('fake-a', [leaky]);
    const { service } = build([a.provider]);
    const cal = await service.getCalendarItems(calendarQuery());
    expect(cal.data[0]?.provider).toBe('Label fake-a');
    expect(cal.data[0]).not.toHaveProperty('address');
  });

  it('passes the range as Dates and gameIds through to providers', async () => {
    const a = fakeProvider('fake-a', [], []);
    const { service } = build([a.provider]);
    await service.getCalendarItems(calendarQuery([7, 3]));
    await service.getStatuses([7, 3]);
    await service.getCalendarItems(calendarQuery());
    expect(a.getCalendarItems).toHaveBeenNthCalledWith(
      1,
      { from: new Date(FROM), to: new Date(TO) },
      [7, 3],
    );
    expect(a.getStatuses).toHaveBeenCalledWith([7, 3]);
    expect(a.getCalendarItems).toHaveBeenNthCalledWith(
      2,
      { from: new Date(FROM), to: new Date(TO) },
      undefined,
    );
  });
});

describe('GameServerCalendarService — filter and sort', () => {
  it('drops windows with end <= start and items outside gameIds', async () => {
    const a = fakeProvider(
      'fake-a',
      [
        windowItem({ serverKey: 'ok' }),
        windowItem({ serverKey: 'inverted', end: '2026-10-05T09:00:00.000Z' }),
        windowItem({ serverKey: 'zero', end: '2026-10-05T10:00:00.000Z' }),
        markerItem({ serverKey: 'other-game', gameId: 99 }),
      ],
      [
        status({ serverKey: 'ok' }),
        status({ serverKey: 'other-game', gameId: 99 }),
      ],
    );
    const { service } = build([a.provider]);
    const cal = await service.getCalendarItems(calendarQuery([7]));
    const st = await service.getStatuses([7]);
    expect(cal.data.map((i) => i.serverKey)).toEqual(['ok']);
    expect(st.data.map((s) => s.serverKey)).toEqual(['ok']);
  });

  it('sorts calendar items by start/at then serverName, statuses by name then key', async () => {
    const a = fakeProvider(
      'fake-a',
      [
        windowItem({ serverName: 'Zulu' }),
        markerItem({ serverName: 'Mike', at: '2026-10-05T10:00:00.000Z' }),
        markerItem({ serverName: 'Early', at: '2026-10-02T00:00:00.000Z' }),
      ],
      [
        status({ serverName: 'Bravo', serverKey: 'k2' }),
        status({ serverName: 'Alpha', serverKey: 'k9' }),
        status({ serverName: 'Bravo', serverKey: 'k1' }),
      ],
    );
    const { service } = build([a.provider]);
    const cal = await service.getCalendarItems(calendarQuery());
    const st = await service.getStatuses();
    expect(cal.data.map((i) => i.serverName)).toEqual([
      'Early',
      'Mike',
      'Zulu',
    ]);
    expect(st.data.map((s) => `${s.serverName}/${s.serverKey}`)).toEqual([
      'Alpha/k9',
      'Bravo/k1',
      'Bravo/k2',
    ]);
  });
});
