import { Logger } from '@nestjs/common';
import { PelicanClient } from './pelican-client';
import type { PelicanClientFactory } from './pelican-client.factory';
import type { PelicanServersRepository } from './pelican-servers.repository';
import { PelicanStatusService } from './pelican-status.service';
import type { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import type { PelicanServerRow } from '../../drizzle/schema';
import {
  jsonResponse,
  loadPelicanFixture,
  requestUrl,
} from './testing/pelican-fixtures';
import { pelicanRow } from './testing/pelican-rows';

const KEY = 'pacc_FAKEKEYfortests0123456789';
type FetchArgs = Parameters<typeof fetch>;

function resources(state = 'running', suspended = false): unknown {
  const body = loadPelicanFixture('server-resources') as {
    attributes: Record<string, unknown>;
  };
  body.attributes.current_state = state;
  body.attributes.is_suspended = suspended;
  return body;
}

function build(
  rows: PelicanServerRow[],
  respond: (uuid: string) => Promise<Response> = () =>
    Promise.resolve(jsonResponse(resources())),
  opts: { active?: boolean; conn?: boolean } = {},
) {
  const fetchImpl = jest.fn<Promise<Response>, FetchArgs>((input) => {
    const uuid = requestUrl(input).pathname.split('/')[4] ?? '';
    return respond(decodeURIComponent(uuid));
  });
  const client = new PelicanClient({
    baseUrl: 'https://panel.example.test',
    apiKey: KEY,
    fetchImpl,
  });
  const registry = { isActive: jest.fn(() => opts.active ?? true) };
  const factory = {
    connect: jest.fn(() =>
      Promise.resolve(
        (opts.conn ?? true) ? { client, host: 'panel.example.test' } : null,
      ),
    ),
  };
  const repo = {
    listStatusPollable: jest.fn(() => Promise.resolve(rows)),
    writeStatus: jest.fn(() => Promise.resolve()),
  };
  const service = new PelicanStatusService(
    registry as unknown as PluginRegistryService,
    factory as unknown as PelicanClientFactory,
    repo as unknown as PelicanServersRepository,
  );
  return { service, fetchImpl, repo };
}

beforeEach(() => {
  for (const m of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, m).mockImplementation(() => {});
  }
});
afterEach(() => jest.restoreAllMocks());

describe('PelicanStatusService.pollStatuses', () => {
  it('polls every due server and writes state + suspension', async () => {
    const rows = [pelicanRow(1), pelicanRow(2)];
    const { service, repo } = build(rows, (uuid) =>
      Promise.resolve(
        jsonResponse(resources('offline', uuid === rows[1]?.panelUuid)),
      ),
    );
    await expect(service.pollStatuses()).resolves.toEqual({
      polled: 2,
      failed: 0,
      skipped: 0,
    });
    expect(repo.writeStatus).toHaveBeenCalledWith(
      1,
      { currentState: 'offline', isSuspended: false },
      expect.any(Date),
    );
    expect(repo.writeStatus).toHaveBeenCalledWith(
      2,
      { currentState: 'offline', isSuspended: true },
      expect.any(Date),
    );
  });

  it('skips servers checked within the last 20 s (panel cache)', async () => {
    const recent = pelicanRow(1, {
      statusCheckedAt: new Date(Date.now() - 5_000),
    });
    const old = pelicanRow(2, {
      statusCheckedAt: new Date(Date.now() - 25_000),
    });
    const { service, fetchImpl, repo } = build([recent, old]);
    await expect(service.pollStatuses()).resolves.toEqual({
      polled: 1,
      failed: 0,
      skipped: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(repo.writeStatus).toHaveBeenCalledWith(
      2,
      expect.anything(),
      expect.any(Date),
    );
  });

  it('runs at most 4 resources calls at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const rows = Array.from({ length: 9 }, (_, i) => pelicanRow(i + 1));
    const { service } = build(rows, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight--;
      return jsonResponse(resources());
    });
    const out = await service.pollStatuses();
    expect(out.polled).toBe(9);
    expect(peak).toBe(4);
  });
});

describe('PelicanStatusService failures', () => {
  it('a failed call writes nothing for that server (D7)', async () => {
    const rows = [pelicanRow(1), pelicanRow(2)];
    const { service, repo } = build(rows, (uuid) =>
      Promise.resolve(
        uuid === rows[0]?.panelUuid
          ? jsonResponse({}, 502)
          : jsonResponse(resources()),
      ),
    );
    await expect(service.pollStatuses()).resolves.toEqual({
      polled: 1,
      failed: 1,
      skipped: 0,
    });
    expect(repo.writeStatus).toHaveBeenCalledTimes(1);
    expect(repo.writeStatus).toHaveBeenCalledWith(
      2,
      expect.anything(),
      expect.any(Date),
    );
  });
});

describe('PelicanStatusService guards and logging', () => {
  it.each([
    ['inactive', { active: false }],
    ['unconfigured', { conn: false }],
  ])('makes zero HTTP calls when %s', async (_label, opts) => {
    const { service, fetchImpl, repo } = build(
      [pelicanRow(1)],
      undefined,
      opts,
    );
    await expect(service.pollStatuses()).resolves.toEqual({
      polled: 0,
      failed: 0,
      skipped: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(repo.listStatusPollable).not.toHaveBeenCalled();
  });

  it('never logs the key, a uuid, an identifier or a server name', async () => {
    const rows = [pelicanRow(1), pelicanRow(2)];
    const { service } = build(rows, (uuid) =>
      Promise.resolve(
        uuid === rows[0]?.panelUuid
          ? jsonResponse({}, 500)
          : jsonResponse(resources()),
      ),
    );
    await service.pollStatuses();
    const logged = (['log', 'warn', 'error', 'debug'] as const)
      .flatMap((m) => jest.mocked(Logger.prototype[m]).mock.calls.flat())
      .map(String)
      .join('\n');
    expect(logged).toContain('/servers/{id}/resources');
    for (const secret of [
      KEY,
      ...rows.flatMap((r) => [r.panelUuid, r.identifier, r.name]),
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('PelicanStatusService.pollStatuses — in flight', () => {
  it('flags alreadyRunning when a poll is in flight', async () => {
    const { service } = build([pelicanRow(1)]);
    // The first call claims the flag synchronously, before its first await.
    const first = service.pollStatuses();
    await expect(service.pollStatuses()).resolves.toEqual({
      polled: 0,
      failed: 0,
      skipped: 0,
      alreadyRunning: true,
    });
    await expect(first).resolves.toEqual({ polled: 1, failed: 0, skipped: 0 });
  });
});
