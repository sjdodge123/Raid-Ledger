import { Logger } from '@nestjs/common';
import type { NewPelicanSchedule, PelicanServerRow } from '../../drizzle/schema';
import type { PelicanSchedule, PelicanTask } from './pelican-api.schemas';
import type { PelicanClient, PelicanResult } from './pelican-client';
import { PelicanScheduleSyncService } from './pelican-schedule-sync.service';
import type { PelicanSchedulesRepository } from './pelican-schedules.repository';
import type { PelicanServersRepository } from './pelican-servers.repository';
import { pelicanRow } from './testing/pelican-rows';

const SENTINEL = 'SENTINEL_PAYLOAD_1773';
const SCHEDULE_NAME = 'Nightly restart schedule name';
type Listed = PelicanResult<PelicanSchedule[]>;

function task(overrides: Partial<PelicanTask> = {}): PelicanTask {
  return {
    id: 1,
    sequence_id: 1,
    action: 'command',
    payload: SENTINEL,
    time_offset: 0,
    is_queued: false,
    continue_on_failure: false,
    ...overrides,
  };
}

function schedule(id: number, tasks: PelicanTask[]): PelicanSchedule {
  return {
    id,
    name: SCHEDULE_NAME,
    cron: {
      minute: '0',
      hour: '4',
      day_of_month: '*',
      month: '*',
      day_of_week: '*',
    },
    is_active: true,
    is_processing: false,
    only_when_online: false,
    last_run_at: null,
    next_run_at: '2026-10-14T04:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    tasks,
  };
}

const okList = (list: PelicanSchedule[]): Listed => ({ ok: true, data: list });
const twoSchedules = (): Listed =>
  okList([
    schedule(1, [task({ action: 'power', payload: 'restart' })]),
    schedule(2, [task()]),
    schedule(3, []),
  ]);

function build(
  rows: PelicanServerRow[],
  respond: (uuid: string) => Promise<Listed> = () =>
    Promise.resolve(twoSchedules()),
) {
  const client = { listSchedules: jest.fn(respond) };
  const servers = { listPollable: jest.fn(() => Promise.resolve(rows)) };
  const schedules = {
    replaceForServer: jest.fn(
      (_id: number, _rows: NewPelicanSchedule[]): Promise<boolean> =>
        Promise.resolve(true),
    ),
  };
  const service = new PelicanScheduleSyncService(
    servers as unknown as PelicanServersRepository,
    schedules as unknown as PelicanSchedulesRepository,
  );
  const conn = {
    client: client as unknown as PelicanClient,
    host: 'panel.example.test',
  };
  return { service, client, servers, schedules, conn };
}

function replacedIds(schedules: {
  replaceForServer: jest.Mock<Promise<boolean>, [number, NewPelicanSchedule[]]>;
}): number[] {
  return schedules.replaceForServer.mock.calls.map(([id]) => id).sort();
}

let logged: string[];
beforeEach(() => {
  logged = [];
  const capture = (msg: unknown) => {
    logged.push(String(msg));
  };
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(capture);
  }
});
afterEach(() => jest.restoreAllMocks());

describe('PelicanScheduleSyncService.syncSchedules', () => {
  it('fetches exactly the pollable servers, by panel uuid', async () => {
    const rows = [pelicanRow(1), pelicanRow(2)];
    const { service, client, conn } = build(rows);
    await service.syncSchedules(conn);
    const asked = client.listSchedules.mock.calls.map(([uuid]) => uuid).sort();
    expect(asked).toEqual(rows.map((r) => r.panelUuid).sort());
  });

  it('replaces each server with payload-free rows and counts the run', async () => {
    const { service, schedules, conn } = build([pelicanRow(1), pelicanRow(2)]);
    const outcome = await service.syncSchedules(conn);
    expect(outcome).toEqual({ synced: 2, failed: 0, skipped: 2 });
    expect(replacedIds(schedules)).toEqual([1, 2]);
    const [, written] = schedules.replaceForServer.mock.calls[0] ?? [0, []];
    expect(written.map((r) => [r.serverId, r.panelScheduleId, r.effect])).toEqual(
      [
        [expect.any(Number), 1, 'restart'],
        [expect.any(Number), 2, 'command'],
      ],
    );
    expect(JSON.stringify(schedules.replaceForServer.mock.calls)).not.toContain(
      SENTINEL,
    );
  });

  it('leaves a failed server untouched and still replaces the others', async () => {
    const rows = [pelicanRow(1), pelicanRow(2), pelicanRow(3)];
    const failing = rows[1]?.panelUuid;
    const { service, schedules, conn } = build(rows, (uuid) =>
      Promise.resolve(
        uuid === failing
          ? { ok: false, error: { kind: 'bad_response', status: 200 } }
          : twoSchedules(),
      ),
    );
    const outcome = await service.syncSchedules(conn);
    expect(replacedIds(schedules)).toEqual([1, 3]);
    expect(outcome).toEqual({ synced: 2, failed: 1, skipped: 2 });
  });
});

describe('PelicanScheduleSyncService.syncSchedules — isolation', () => {
  it('resolves and replaces the rest when one write throws', async () => {
    const { service, schedules, conn } = build([
      pelicanRow(1),
      pelicanRow(2),
      pelicanRow(3),
    ]);
    schedules.replaceForServer.mockImplementation((id) =>
      id === 2 ? Promise.reject(new TypeError('boom')) : Promise.resolve(true),
    );
    const outcome = await service.syncSchedules(conn);
    expect(outcome).toEqual({ synced: 2, failed: 1, skipped: 2 });
    expect(replacedIds(schedules)).toEqual([1, 2, 3]);
  });

  it('resolves when the fetch itself throws for one server', async () => {
    const rows = [pelicanRow(1), pelicanRow(2)];
    const { service, schedules, conn } = build(rows, (uuid) =>
      uuid === rows[0]?.panelUuid
        ? Promise.reject(new Error('socket'))
        : Promise.resolve(twoSchedules()),
    );
    const outcome = await service.syncSchedules(conn);
    expect(outcome).toEqual({ synced: 1, failed: 1, skipped: 1 });
    expect(replacedIds(schedules)).toEqual([2]);
  });

  it('does not count a server whose replace found the plugin inactive', async () => {
    const { service, schedules, conn } = build([pelicanRow(1)]);
    schedules.replaceForServer.mockResolvedValueOnce(false);
    expect(await service.syncSchedules(conn)).toEqual({
      synced: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it('resolves with zero counts when listing pollable servers throws', async () => {
    const { service, servers, client, conn } = build([pelicanRow(1)]);
    servers.listPollable.mockRejectedValueOnce(new Error('db down'));
    expect(await service.syncSchedules(conn)).toEqual({
      synced: 0,
      failed: 0,
      skipped: 0,
    });
    expect(client.listSchedules).not.toHaveBeenCalled();
  });
});

describe('PelicanScheduleSyncService.syncSchedules — limits and logs', () => {
  it('keeps at most 4 schedule fetches in flight', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => pelicanRow(i + 1));
    let inFlight = 0;
    let peak = 0;
    const { service, client, conn } = build(rows, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight--;
      return twoSchedules();
    });
    await service.syncSchedules(conn);
    expect(client.listSchedules).toHaveBeenCalledTimes(10);
    expect(peak).toBe(4);
  });

  it('never logs a payload, uuid, identifier or name', async () => {
    const rows = [pelicanRow(1), pelicanRow(2)];
    const { service, schedules, conn } = build(rows);
    schedules.replaceForServer.mockRejectedValueOnce(new Error(SENTINEL));
    await service.syncSchedules(conn);
    const text = logged.join('\n');
    expect(text).toContain('panel.example.test');
    for (const r of rows) {
      expect(text).not.toContain(r.panelUuid);
      expect(text).not.toContain(r.identifier);
      expect(text).not.toContain(r.name);
    }
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain(SCHEDULE_NAME);
  });
});
