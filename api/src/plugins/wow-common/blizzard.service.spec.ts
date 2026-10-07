import { BadGatewayException } from '@nestjs/common';
import { checkOrSetAlreadyCaught } from '@sentry/core';
import { BlizzardService } from './blizzard.service';
import * as instH from './blizzard-instance.helpers';
import * as instFetch from './blizzard-instance.fetch';
import {
  blizzardUpstreamError,
  isNamespaceRefusal,
} from './blizzard-upstream-error';

import { setForeverNamespacePrefix } from './forever-namespace.resolver';

jest.mock('./blizzard-instance.helpers');

/**
 * TDB:1786: the public realm route must not re-hit Blizzard (and re-alert
 * Sentry) on every call for a namespace Blizzard refuses with a 403.
 */
const fetchRealms = jest.mocked(instH.fetchRealmListFromApi);
const T0 = Date.parse('2026-10-01T00:00:00Z');
const MIN = 60 * 1000;
const REALMS = [{ name: 'Area 52', slug: 'area-52', id: 1 }];
const FRESH_REALMS = [{ name: 'Benediction', slug: 'benediction', id: 2 }];

const refused = () => blizzardUpstreamError(403, 'realms', 'x');
const failed = () => blizzardUpstreamError(500, 'realms', 'try again');
/** setImmediate stays real, and runs only after pending promise chains settle. */
const flushRefreshes = () => new Promise((r) => setImmediate(r));

function setup() {
  const getAccessToken = jest.fn().mockResolvedValue('t');
  const service = new BlizzardService({ getAccessToken } as never);
  return { service, getAccessToken };
}

/** Run a call that must reject, and hand back what it rejected with. */
async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => {
      throw new Error('expected the realm fetch to reject');
    },
    (err: unknown) => err,
  );
}

/** Fake clock (setImmediate stays real) and a clean upstream mock per test. */
function useRealmClock() {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0, doNotFake: ['setImmediate'] });
    fetchRealms.mockReset();
  });
  afterEach(async () => {
    await flushRefreshes();
    jest.useRealTimers();
  });
}

describe('BlizzardService.fetchRealmList — namespace refusal cache', () => {
  useRealmClock();

  it('answers a repeat 403 locally by rethrowing the same exception', async () => {
    const { service, getAccessToken } = setup();
    fetchRealms.mockImplementation(() => Promise.reject(refused()));

    const first = await rejectionOf(
      service.fetchRealmList('us', 'classicforever'),
    );
    const second = await rejectionOf(
      service.fetchRealmList('us', 'classicforever'),
    );

    expect(first).toBeInstanceOf(BadGatewayException);
    expect(second).toBeInstanceOf(BadGatewayException);
    expect(isNamespaceRefusal(second)).toBe(true);
    expect(second).toBe(first);
    expect(fetchRealms).toHaveBeenCalledTimes(1);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it('a repeat 403 is one Sentry event: the SDK skips the rethrown instance', async () => {
    const { service } = setup();
    fetchRealms.mockImplementation(() => Promise.reject(refused()));

    const first = await rejectionOf(service.fetchRealmList('us', 'anniv'));
    // The check Sentry's client.captureException runs before sending an event.
    expect(checkOrSetAlreadyCaught(first)).toBe(false);
    const second = await rejectionOf(service.fetchRealmList('us', 'anniv'));

    expect(checkOrSetAlreadyCaught(second)).toBe(true);
  });

  it('asks Blizzard again once the 10-minute refusal expires', async () => {
    const { service } = setup();
    fetchRealms.mockImplementation(() => Promise.reject(refused()));
    await rejectionOf(service.fetchRealmList('eu', 'classicforever'));

    jest.setSystemTime(T0 + 10 * MIN - 1);
    await rejectionOf(service.fetchRealmList('eu', 'classicforever'));
    expect(fetchRealms).toHaveBeenCalledTimes(1);

    jest.setSystemTime(T0 + 10 * MIN);
    await rejectionOf(service.fetchRealmList('eu', 'classicforever'));
    expect(fetchRealms).toHaveBeenCalledTimes(2);
  });

  it('does not remember a non-403 upstream failure', async () => {
    const { service } = setup();
    fetchRealms.mockImplementation(() => Promise.reject(failed()));

    await rejectionOf(service.fetchRealmList('kr', 'classicforever'));
    const second = await rejectionOf(
      service.fetchRealmList('kr', 'classicforever'),
    );

    expect(second).toBeInstanceOf(BadGatewayException);
    expect(isNamespaceRefusal(second)).toBe(false);
    expect(fetchRealms).toHaveBeenCalledTimes(2);
  });
});

describe('BlizzardService.fetchRealmList — stale and recovery paths', () => {
  useRealmClock();

  it('keeps serving stale realms when the background refresh gets a 403', async () => {
    const { service } = setup();
    fetchRealms.mockResolvedValueOnce(REALMS);
    await service.fetchRealmList('tw', 'classicforever');

    // 55 min is inside the stale window (last 20% of the 60-min TTL).
    jest.setSystemTime(T0 + 55 * MIN);
    fetchRealms.mockImplementationOnce(() => Promise.reject(refused()));
    await expect(
      service.fetchRealmList('tw', 'classicforever'),
    ).resolves.toEqual(REALMS);
    await flushRefreshes();
    expect(fetchRealms).toHaveBeenCalledTimes(2);

    // Once the entry expires, a refusal from the swallowed refresh must not
    // short-circuit the next call: it goes to Blizzard.
    jest.setSystemTime(T0 + 60 * MIN);
    fetchRealms.mockResolvedValueOnce(FRESH_REALMS);
    await expect(
      service.fetchRealmList('tw', 'classicforever'),
    ).resolves.toEqual(FRESH_REALMS);
    expect(fetchRealms).toHaveBeenCalledTimes(3);
  });

  it('clears the refusal when a later fetch succeeds', async () => {
    const { service } = setup();
    fetchRealms.mockImplementationOnce(() => Promise.reject(refused()));
    await rejectionOf(service.fetchRealmList('us', 'classic1x'));

    jest.setSystemTime(T0 + 10 * MIN);
    fetchRealms.mockResolvedValueOnce(REALMS);
    await expect(service.fetchRealmList('us', 'classic1x')).resolves.toEqual(
      REALMS,
    );

    const { realmRefusals } = service as unknown as {
      realmRefusals: Map<string, unknown>;
    };
    expect([...realmRefusals.keys()]).toEqual([]);
  });
});

/**
 * ROK-1719 (OQ2): when Blizzard's journal is down, WoW: Forever still offers
 * the seeded instances — and that seed-only list is never cached.
 */
describe('BlizzardService.fetchAllInstances — Forever degraded mode', () => {
  afterEach(() => jest.restoreAllMocks());
  const FULL = {
    dungeons: [{ id: 63, name: 'Deadmines', expansion: 'Classic' }],
    raids: [],
  };

  it('serves the 11 seeded instances instead of throwing, then recovers', async () => {
    const { service } = setup();
    const fetchAll = jest
      .spyOn(instFetch, 'fetchAllInstancesFromApi')
      .mockRejectedValueOnce(failed())
      .mockResolvedValueOnce(FULL);
    const degraded = await service.fetchAllInstances('us', 'wow_forever');
    expect(degraded.dungeons.map((d) => d.id)).toHaveLength(9);
    expect(degraded.raids.map((r) => r.name)).toEqual([
      'Barrow Deeps',
      'Hyjal Summit',
    ]);
    await expect(
      service.fetchAllInstances('us', 'wow_forever'),
    ).resolves.toEqual(FULL);
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it('still throws for every other variant', async () => {
    const { service } = setup();
    jest
      .spyOn(instFetch, 'fetchAllInstancesFromApi')
      .mockRejectedValue(failed());
    await expect(
      service.fetchAllInstances('us', 'classic_era'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});

/** ROK-1717: the realm cache/refusal key follows the admin Forever prefix. */
describe('BlizzardService.fetchRealmList — Forever prefix override', () => {
  useRealmClock();
  afterEach(() => setForeverNamespacePrefix(null));

  type RealmMaps = {
    realmCache: Map<string, unknown>;
    realmRefusals: Map<string, unknown>;
  };

  it('a 403 remembered for classicforever no longer blocks after an override', async () => {
    const { service } = setup();
    fetchRealms.mockRejectedValueOnce(refused());
    await rejectionOf(service.fetchRealmList('us', 'classicforever'));
    fetchRealms.mockResolvedValueOnce(REALMS);

    setForeverNamespacePrefix('foo');

    await expect(service.fetchRealmList('us', 'classicforever')).resolves.toBe(
      REALMS,
    );
    expect(fetchRealms).toHaveBeenCalledTimes(2);
  });

  it('purgeNamespace clears the realm cache and refusal memo for that prefix only', async () => {
    const { service } = setup();
    fetchRealms.mockResolvedValueOnce(REALMS);
    await service.fetchRealmList('us', 'classicforever');
    fetchRealms.mockResolvedValueOnce(REALMS);
    await service.fetchRealmList('us', 'classicann');
    fetchRealms.mockRejectedValueOnce(refused());
    await rejectionOf(service.fetchRealmList('eu', 'classicforever'));

    service.purgeNamespace('classicforever');

    const { realmCache, realmRefusals } = service as unknown as RealmMaps;
    expect([...realmCache.keys()]).toEqual(['us:classicann']);
    expect([...realmRefusals.keys()]).toEqual([]);
  });
});
