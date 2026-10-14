import { Logger } from '@nestjs/common';
import { GameServerCalendarItemSchema } from '@raid-ledger/contract';
import type { PelicanConfigService } from './pelican-config.service';
import { PelicanGameServerProvider } from './pelican-game-server.provider';
import type {
  PelicanSchedulesRepository,
  PelicanServableSchedule,
} from './pelican-schedules.repository';
import type { PelicanServersRepository } from './pelican-servers.repository';
import { servableSchedule } from './testing/pelican-schedule-rows';

const RANGE = {
  from: new Date('2026-10-14T00:00:00.000Z'),
  to: new Date('2026-10-15T00:00:00.000Z'),
};

function build(rows: PelicanServableSchedule[], defaultTz = 'UTC') {
  const listServable = jest.fn<Promise<PelicanServableSchedule[]>, [number[]?]>(
    () => Promise.resolve(rows),
  );
  const resolveDefaultTimezone = jest.fn(() => Promise.resolve(defaultTz));
  const listPollable = jest.fn(() => Promise.resolve([]));
  const provider = new PelicanGameServerProvider(
    { listPollable } as unknown as PelicanServersRepository,
    { listServable } as unknown as PelicanSchedulesRepository,
    { resolveDefaultTimezone } as unknown as PelicanConfigService,
  );
  return { provider, listServable, resolveDefaultTimezone };
}

const evening = (over: Partial<PelicanServableSchedule> = {}) => [
  servableSchedule('0 18 * * *', 'start', { name: 'Open up', ...over }),
  servableSchedule('0 23 * * *', 'stop', over),
];

describe('PelicanGameServerProvider.getCalendarItems (ROK-1096)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('projects a start/stop pair into one schema-valid window', async () => {
    const { provider } = build(evening());
    const items = await provider.getCalendarItems(RANGE);
    expect(items).toEqual([
      {
        kind: 'window',
        serverKey: '1',
        serverName: 'Valheim',
        gameId: 7,
        provider: 'Pelican',
        start: '2026-10-14T18:00:00.000Z',
        end: '2026-10-14T23:00:00.000Z',
        label: 'Open up',
        source: 'schedule',
      },
    ]);
    for (const item of items) {
      expect(GameServerCalendarItemSchema.parse(item)).toEqual(item);
    }
  });

  it('uses the plugin default timezone when the server has no override', async () => {
    const { provider, resolveDefaultTimezone } = build(
      evening({ serverTimezone: null }),
      'America/New_York',
    );
    const items = await provider.getCalendarItems(RANGE);
    expect(resolveDefaultTimezone).toHaveBeenCalledTimes(1);
    // 18:00–23:00 EDT; the previous evening's window spills into the range (D7).
    expect(items.map((i) => (i.kind === 'window' ? i.start : i.at))).toEqual([
      '2026-10-13T22:00:00.000Z',
      '2026-10-14T22:00:00.000Z',
    ]);
  });

  it('passes gameIds to the repository and omits them when absent', async () => {
    const { provider, listServable } = build([]);
    await provider.getCalendarItems(RANGE, [7, 9]);
    await provider.getCalendarItems(RANGE);
    expect(listServable.mock.calls).toEqual([[[7, 9]], [undefined]]);
  });
});

describe('PelicanGameServerProvider.getCalendarItems filtering (ROK-1096)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('re-applies gameIds and drops inactive schedules (D14)', async () => {
    const { provider } = build([
      ...evening({ gameId: 8 }),
      servableSchedule('0 4 * * *', 'restart', { isActive: false }),
    ]);
    await expect(provider.getCalendarItems(RANGE, [7])).resolves.toEqual([]);
  });

  it('never leaks an address from a server or schedule name', async () => {
    const { provider } = build([
      servableSchedule('0 4 * * *', 'restart', {
        name: 'reboot 10.1.2.3:2456',
        serverName: 'Valheim 10.1.2.3:2456',
      }),
    ]);
    const items = await provider.getCalendarItems(RANGE);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain('10.1.2.3');
  });

  it('logs skipped servers by id only', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { provider } = build(
      evening({
        serverId: 42,
        serverTimezone: 'Mars/Olympus',
        serverName: 'Secret',
      }),
    );
    await expect(provider.getCalendarItems(RANGE)).resolves.toEqual([]);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual(['Pelican projection skipped server 42: bad_tz']);
  });
});
