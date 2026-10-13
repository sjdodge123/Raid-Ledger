import { Logger } from '@nestjs/common';
import { PelicanClient } from './pelican-client';
import type { PelicanClientFactory } from './pelican-client.factory';
import type { PelicanServersRepository } from './pelican-servers.repository';
import { PelicanSyncService } from './pelican-sync.service';
import { toListedServer } from './pelican-sync.helpers';
import type { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import {
  fakeServer,
  jsonResponse,
  requestUrl,
  serverPageBody,
} from './testing/pelican-fixtures';

const KEY = 'pacc_FAKEKEYfortests0123456789';
type FetchArgs = Parameters<typeof fetch>;
type Respond = (page: number) => Promise<Response>;

function build(
  respond: Respond,
  opts: { active?: boolean; conn?: boolean } = {},
) {
  const fetchImpl = jest.fn<Promise<Response>, FetchArgs>((input) =>
    respond(Number(requestUrl(input).searchParams.get('page'))),
  );
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
  const counts = { upserted: 2, markedMissing: 1, restored: 1 };
  const repo = { applyListing: jest.fn(() => Promise.resolve(counts)) };
  const service = new PelicanSyncService(
    registry as unknown as PluginRegistryService,
    factory as unknown as PelicanClientFactory,
    repo as unknown as PelicanServersRepository,
  );
  return { service, fetchImpl, repo, factory };
}

const twoPages: Respond = (page) =>
  Promise.resolve(jsonResponse(serverPageBody([fakeServer(page)], page, 2)));

let logged: string[];
beforeEach(() => {
  logged = [];
  const capture = (msg: unknown) => {
    logged.push(String(msg));
  };
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(capture);
  }
});
afterEach(() => jest.restoreAllMocks());

describe('PelicanSyncService.syncServers', () => {
  it('makes zero HTTP calls while the plugin is inactive', async () => {
    const { service, fetchImpl, factory } = build(twoPages, { active: false });
    expect((await service.syncServers()).code).toBe('not_configured');
    expect(factory.connect).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns not_configured without HTTP when no connection is saved', async () => {
    const { service, fetchImpl } = build(twoPages, { conn: false });
    expect((await service.syncServers()).code).toBe('not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('applies the servers from every page as one listing', async () => {
    const { service, repo } = build(twoPages);
    const outcome = await service.syncServers();
    expect(outcome).toEqual({
      code: 'ok',
      upserted: 2,
      markedMissing: 1,
      restored: 1,
    });
    expect(repo.applyListing).toHaveBeenCalledTimes(1);
    expect(repo.applyListing).toHaveBeenCalledWith(
      [fakeServer(1), fakeServer(2)].map(toListedServer),
      expect.any(Date),
    );
  });
});

describe('PelicanSyncService.syncServers — failures and overlap', () => {
  it('writes nothing and marks nothing missing when page 2 fails', async () => {
    const { service, repo } = build((page) =>
      page === 1
        ? twoPages(1)
        : Promise.resolve(new Response('', { status: 503 })),
    );
    const outcome = await service.syncServers();
    expect(outcome).toEqual({
      code: 'http',
      upserted: 0,
      markedMissing: 0,
      restored: 0,
    });
    expect(repo.applyListing).not.toHaveBeenCalled();
  });

  it('returns in_progress for an overlapping call and fetches page 1 once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service, fetchImpl } = build(async (page) => {
      await gate;
      return twoPages(page);
    });
    const first = service.syncServers();
    expect(service.isRunning).toBe(true);
    expect((await service.syncServers()).code).toBe('in_progress');
    release();
    expect((await first).code).toBe('ok');
    expect(service.isRunning).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never throws: a repository failure resolves internal_error and frees the flag', async () => {
    const { service, repo } = build(twoPages);
    repo.applyListing.mockRejectedValueOnce(new Error('connection lost'));
    expect((await service.syncServers()).code).toBe('internal_error');
    expect(service.isRunning).toBe(false);
  });

  it('logs no key, uuid, identifier or server name', async () => {
    const ok = build(twoPages);
    await ok.service.syncServers();
    const failing = build((page) =>
      page === 1
        ? twoPages(1)
        : Promise.resolve(new Response('', { status: 500 })),
    );
    await failing.service.syncServers();
    expect(logged.length).toBeGreaterThan(0);
    const text = logged.join('\n');
    for (const s of [fakeServer(1), fakeServer(2)]) {
      expect(text).not.toContain(s.uuid);
      expect(text).not.toContain(s.identifier);
      expect(text).not.toContain(s.name);
    }
    expect(text).not.toContain(KEY);
  });
});
