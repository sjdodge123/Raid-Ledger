import type { PelicanConfigService } from './pelican-config.service';
import type {
  PelicanActiveScheduleCron,
  PelicanSchedulesRepository,
} from './pelican-schedules.repository';
import {
  PelicanTzCheckService,
  type TzCheckServer,
} from './pelican-tz-check.service';
import { cronColumns } from './testing/pelican-schedule-rows';

/** 04:00 UTC — an occurrence of `0 4 * * *` in UTC, not in New York. */
const NEXT_RUN = new Date('2026-10-15T04:00:00.000Z');

function restart(serverId: number): PelicanActiveScheduleCron {
  return {
    serverId,
    ...cronColumns('0 4 * * *'),
    isActive: true,
    nextRunAt: NEXT_RUN,
  };
}

function build(rows: PelicanActiveScheduleCron[], defaultTz = 'UTC') {
  const listActiveForServers = jest.fn<
    Promise<PelicanActiveScheduleCron[]>,
    [number[]]
  >(() => Promise.resolve(rows));
  const resolveDefaultTimezone = jest.fn(() => Promise.resolve(defaultTz));
  const service = new PelicanTzCheckService(
    { listActiveForServers } as unknown as PelicanSchedulesRepository,
    { resolveDefaultTimezone } as unknown as PelicanConfigService,
  );
  return { service, listActiveForServers };
}

const ids = async (
  service: PelicanTzCheckService,
  servers: TzCheckServer[],
): Promise<number[]> => [...(await service.mismatchedServerIds(servers))];

describe('PelicanTzCheckService (ROK-1096 D11)', () => {
  it('flags only the server whose override does not match its schedules', async () => {
    const { service, listActiveForServers } = build([restart(1), restart(2)]);
    const out = await ids(service, [
      { id: 1, timezone: 'UTC' },
      { id: 2, timezone: 'America/New_York' },
    ]);
    expect(listActiveForServers).toHaveBeenCalledWith([1, 2]);
    expect(out).toEqual([2]);
  });

  it('judges an inheriting server against the plugin default', async () => {
    const nyDefault = build([restart(1)], 'America/New_York');
    await expect(
      ids(nyDefault.service, [{ id: 1, timezone: null }]),
    ).resolves.toEqual([1]);
    const utcDefault = build([restart(1)], 'UTC');
    await expect(
      ids(utcDefault.service, [{ id: 1, timezone: null }]),
    ).resolves.toEqual([]);
  });

  it('never flags a server with no active schedules or an unusable zone', async () => {
    const { service } = build([restart(2)]);
    const out = await ids(service, [
      { id: 1, timezone: 'America/New_York' },
      { id: 2, timezone: 'Mars/Olympus' },
    ]);
    expect(out).toEqual([]);
  });

  it('skips the query for an empty listing', async () => {
    const { service, listActiveForServers } = build([]);
    await expect(ids(service, [])).resolves.toEqual([]);
    expect(listActiveForServers).not.toHaveBeenCalled();
  });
});
