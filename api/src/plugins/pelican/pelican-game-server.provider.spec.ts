import { Logger } from '@nestjs/common';
import { GameServerCalendarItemSchema } from '@raid-ledger/contract';
import type {
  PelicanClientFactory,
  PelicanConnection,
} from './pelican-client.factory';
import { PelicanGameServerProvider } from './pelican-game-server.provider';
import type {
  PelicanSchedulesRepository,
  PelicanServableSchedule,
} from './pelican-schedules.repository';
import type { PelicanServerRow } from '../../drizzle/schema';
import type { PelicanServersRepository } from './pelican-servers.repository';
import { pelicanRow } from './testing/pelican-rows';
import { servableSchedule } from './testing/pelican-schedule-rows';

const RANGE = {
  from: new Date('2026-10-14T00:00:00.000Z'),
  to: new Date('2026-10-15T00:00:00.000Z'),
};

const CONNECTED = {
  host: 'panel.example.test',
} as unknown as PelicanConnection;

function build(
  rows: PelicanServableSchedule[],
  pollable: PelicanServerRow[] = [],
  connection: PelicanConnection | null = CONNECTED,
) {
  const listServable = jest.fn<Promise<PelicanServableSchedule[]>, [number[]?]>(
    () => Promise.resolve(rows),
  );
  const listPollable = jest.fn(() => Promise.resolve(pollable));
  const connect = jest.fn(() => Promise.resolve(connection));
  const provider = new PelicanGameServerProvider(
    { listPollable } as unknown as PelicanServersRepository,
    { listServable } as unknown as PelicanSchedulesRepository,
    { connect } as unknown as PelicanClientFactory,
  );
  return { provider, listServable, listPollable };
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

  it('logs skipped schedules by id only', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const bad = servableSchedule('61 4 * * *', 'restart', {
      serverId: 42,
      name: 'Secret reboot',
      serverName: 'Secret',
    });
    const { provider } = build([bad]);
    await expect(provider.getCalendarItems(RANGE)).resolves.toEqual([]);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual([
      `Pelican projection skipped server 42 schedule ${bad.id}: bad_cron`,
    ]);
  });
});

describe('PelicanGameServerProvider.getStatuses (ROK-1776)', () => {
  const checked = new Date(Date.now() - 60_000);
  const rows = () => [pelicanRow(1, { statusCheckedAt: checked })];

  it('returns nothing and skips the repository while unconfigured', async () => {
    const { provider, listPollable } = build([], rows(), null);
    await expect(provider.getStatuses()).resolves.toEqual([]);
    expect(listPollable).not.toHaveBeenCalled();
  });

  it('maps checked rows to member-safe DTOs while configured', async () => {
    const { provider, listPollable } = build([], rows());
    const out = await provider.getStatuses();
    expect(listPollable).toHaveBeenCalledTimes(1);
    expect(out.map((s) => [s.serverKey, s.provider, s.state])).toEqual([
      ['1', 'Pelican', 'running'],
    ]);
  });
});
