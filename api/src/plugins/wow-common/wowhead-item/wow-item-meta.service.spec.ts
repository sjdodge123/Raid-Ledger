/**
 * ROK-1727 — WowItemMetaService unit spec: env 16 → env 4 → not_found
 * resolution, error backoff, due-row selection and the kill switch.
 * HTTP is an injected fetch; the DB is a minimal chain stub.
 */
import { SETTING_KEYS } from '../../../drizzle/schema/app-settings';
import type { SettingsService } from '../../../settings/settings.service';
import { WowItemMetaService } from './wow-item-meta.service';
import { RECHECK_TTL_MS, RESOLVED_TTL_MS } from './wow-item-meta.resolve';
import { createWowheadLimiter } from './wowhead-item.limiter';
import type {
  WowheadFetch,
  WowItemMetaInsert,
  WowItemMetaRow,
} from './wowhead-item.types';

const NOW = new Date('2026-10-09T12:00:00Z');
const HOUR = 3_600_000;
const HIT = { name: 'Thunderfury', quality: 5, icon: 'inv_sword_39' };

type Reply = { status: number; body?: unknown };

/** fetch stub keyed by `dataEnv`; records every URL it was asked for. */
function fetchStub(byEnv: Record<number, Reply[]>) {
  const urls: string[] = [];
  const fn = jest.fn<ReturnType<WowheadFetch>, Parameters<WowheadFetch>>(
    (url) => {
      urls.push(url);
      const env = Number(/dataEnv=(\d+)/.exec(url)?.[1]);
      const queue = byEnv[env] ?? [];
      const reply = (queue.length > 1 ? queue.shift() : queue[0]) ?? {
        status: 404,
      };
      return Promise.resolve({
        status: reply.status,
        json: () => Promise.resolve(reply.body ?? { error: 'x' }),
      });
    },
  );
  return { fn, urls };
}

function row(over: Partial<WowItemMetaRow>): WowItemMetaRow {
  return {
    itemId: 1,
    status: 'not_found',
    env: null,
    name: null,
    quality: null,
    icon: null,
    fetchedAt: NOW,
    nextRetryAt: null,
    attempts: 0,
    ...over,
  };
}

function setup(opts: {
  fetch: ReturnType<typeof fetchStub>;
  existing?: WowItemMetaRow[];
  due?: WowItemMetaRow[];
  setting?: string | null;
}) {
  const writes: { row: WowItemMetaInsert; set: Record<string, unknown> }[] = [];
  const where = jest.fn(() =>
    Object.assign(Promise.resolve(opts.existing ?? []), {
      orderBy: () => ({ limit: () => Promise.resolve(opts.due ?? []) }),
    }),
  );
  const db = {
    select: () => ({ from: () => ({ where }) }),
    insert: () => ({
      values: (r: WowItemMetaInsert) => ({
        onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
          writes.push({ row: r, set: cfg.set });
          return Promise.resolve();
        },
      }),
    }),
  };
  const settings = { get: jest.fn().mockResolvedValue(opts.setting ?? null) };
  const wait = jest.fn(() => Promise.resolve());
  const service = new WowItemMetaService(
    db as never,
    settings as unknown as SettingsService,
    {
      fetchFn: opts.fetch.fn,
      limiter: createWowheadLimiter({ minIntervalMs: 0 }),
      wait,
      now: () => NOW,
    },
  );
  return { service, writes, settings, wait };
}

const after = (ms: number) => new Date(NOW.getTime() + ms);

describe('WowItemMetaService.enqueue — resolution (ROK-1727)', () => {
  it('env 16 hit → resolved, env 16, cached 30 d, env 4 never asked', async () => {
    const fetch = fetchStub({ 16: [{ status: 200, body: HIT }] });
    const { service, writes } = setup({ fetch });
    await expect(service.enqueue([19019])).resolves.toBe(1);
    expect(fetch.urls).toEqual([
      'https://nether.wowhead.com/tooltip/item/19019?dataEnv=16',
    ]);
    expect(writes[0]?.row).toEqual({
      itemId: 19019,
      status: 'resolved',
      env: 16,
      ...HIT,
      fetchedAt: NOW,
      nextRetryAt: after(RESOLVED_TTL_MS),
      attempts: 0,
    });
  });

  it('env 16 miss + env 4 hit → classic_fallback, re-probed in 24 h', async () => {
    const fetch = fetchStub({
      16: [{ status: 404 }],
      4: [{ status: 200, body: HIT }],
    });
    const { service, writes } = setup({ fetch });
    await service.enqueue([16921]);
    expect(fetch.urls.map((u) => /dataEnv=(\d+)/.exec(u)?.[1])).toEqual([
      '16',
      '4',
    ]);
    expect(writes[0]?.row).toMatchObject({
      status: 'classic_fallback',
      env: 4,
      name: 'Thunderfury',
      nextRetryAt: after(RECHECK_TTL_MS),
    });
    expect(RECHECK_TTL_MS).toBe(24 * HOUR);
  });

  it('both envs miss → not_found, re-probed in 24 h', async () => {
    const fetch = fetchStub({ 16: [{ status: 404 }], 4: [{ status: 404 }] });
    const { service, writes } = setup({ fetch });
    await service.enqueue([16922]);
    expect(writes[0]?.row).toMatchObject({
      status: 'not_found',
      env: null,
      name: null,
      nextRetryAt: after(RECHECK_TTL_MS),
      attempts: 0,
    });
  });

  it('429 on every try → error with backoff; an existing row keeps its data', async () => {
    const fetch = fetchStub({ 16: [{ status: 429 }] });
    const existing = [
      row({
        itemId: 7,
        status: 'classic_fallback',
        env: 4,
        name: 'Old',
        attempts: 1,
        nextRetryAt: after(-1),
      }),
    ];
    const { service, writes, wait } = setup({ fetch, existing });
    await service.enqueue([7]);
    expect(fetch.fn).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(writes[0]?.row).toMatchObject({
      status: 'error',
      attempts: 2,
      nextRetryAt: after(4 * HOUR),
    });
    expect(writes[0]?.set).toEqual({
      fetchedAt: NOW,
      nextRetryAt: after(4 * HOUR),
      attempts: 2,
    });
  });
});

describe('WowItemMetaService — due selection + kill switch (ROK-1727)', () => {
  it('enqueue skips rows not yet due and de-dupes ids', async () => {
    const fetch = fetchStub({ 16: [{ status: 200, body: HIT }] });
    const existing = [
      row({ itemId: 1, status: 'resolved', nextRetryAt: after(HOUR) }),
      row({ itemId: 2, nextRetryAt: after(-HOUR) }),
    ];
    const { service, writes } = setup({ fetch, existing });
    await expect(service.enqueue([1, 2, 2, 3, 0])).resolves.toBe(2);
    expect(writes.map((w) => w.row.itemId).sort()).toEqual([2, 3]);
  });

  it('retryDue re-probes the due rows', async () => {
    const fetch = fetchStub({ 16: [{ status: 200, body: HIT }] });
    const due = [row({ itemId: 5, nextRetryAt: after(-HOUR) })];
    const { service, writes } = setup({ fetch, due });
    await expect(service.retryDue()).resolves.toBe(1);
    expect(writes[0]?.row).toMatchObject({ itemId: 5, status: 'resolved' });
  });

  it('kill switch off ("false") → no fetch and no write from either entry point', async () => {
    const fetch = fetchStub({ 16: [{ status: 200, body: HIT }] });
    const due = [row({ itemId: 5, nextRetryAt: after(-HOUR) })];
    const { service, writes, settings } = setup({
      fetch,
      due,
      setting: 'false',
    });
    await expect(service.enqueue([5, 6])).resolves.toBe(0);
    await expect(service.retryDue()).resolves.toBe(0);
    expect(settings.get).toHaveBeenCalledWith(
      SETTING_KEYS.WOWHEAD_RESOLVER_ENABLED,
    );
    expect(fetch.fn).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('kill switch unset → ON (D2)', async () => {
    const fetch = fetchStub({ 16: [{ status: 200, body: HIT }] });
    const { service } = setup({ fetch, setting: null });
    await expect(service.isEnabled()).resolves.toBe(true);
  });

  it('getMeta returns cached rows keyed by item id', async () => {
    const fetch = fetchStub({});
    const existing = [row({ itemId: 9, status: 'resolved', name: 'X' })];
    const { service } = setup({ fetch, existing });
    const meta = await service.getMeta([9, 9]);
    expect(meta.get(9)?.name).toBe('X');
    await expect(service.getMeta([])).resolves.toEqual(new Map());
  });
});
