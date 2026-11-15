import { BadGatewayException } from '@nestjs/common';
import { checkOrSetAlreadyCaught } from '@sentry/core';
import { BlizzardService } from './blizzard.service';
import * as instH from './blizzard-instance.helpers';
import * as instFetch from './blizzard-instance.fetch';
import {
  blizzardUpstreamError,
  isNamespaceRefusal,
} from './blizzard-upstream-error';

import {
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';

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
 * ROK-2210: classic_era / wow_forever are served from the catalogue — no token
 * and no journal call, so they work with no Blizzard keys at all.
 */
describe('BlizzardService — catalogue-served variants (ROK-2210)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['wow_forever', 'classic_era'] as const)(
    'lists %s with no token and no journal call',
    async (variant) => {
      const { service, getAccessToken } = setup();
      const fetchAll = jest
        .spyOn(instFetch, 'fetchAllInstancesFromApi')
        .mockResolvedValue({ dungeons: [], raids: [] });
      const list = await service.fetchAllInstances('us', variant);
      expect(list.raids.map((r) => r.id)).toEqual(
        expect.arrayContaining([741, 760, 754]),
      );
      expect([getAccessToken.mock.calls, fetchAll.mock.calls]).toEqual([
        [],
        [],
      ]);
    },
  );

  it('resolves a catalogue id detail with no token', async () => {
    const { service, getAccessToken } = setup();
    const detail = await service.fetchInstanceDetail(
      22901,
      'us',
      'wow_forever',
    );
    expect(detail.name).toBe('Upper Blackrock Spire');
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('sends a non-catalogue id (Scarlet Halls 311) to the journal', async () => {
    const { service } = setup();
    const journal = jest
      .spyOn(instFetch, 'fetchInstanceDetailFromApi')
      .mockResolvedValue({
        id: 311,
        name: 'Scarlet Halls',
        expansion: 'Mists of Pandaria',
        minimumLevel: null,
        maxPlayers: 5,
        category: 'dungeon',
      });
    await service.fetchInstanceDetail(311, 'us', 'wow_forever');
    expect(journal).toHaveBeenCalledWith(311, 'us', 'wow_forever', 't');
  });

  it('still uses the journal list for retail', async () => {
    const { service } = setup();
    const fetchAll = jest
      .spyOn(instFetch, 'fetchAllInstancesFromApi')
      .mockResolvedValue({ dungeons: [], raids: [] });
    await service.fetchAllInstances('us', 'retail');
    expect(fetchAll).toHaveBeenCalledWith('us', 'retail', 't');
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

    service.purgeNamespace(getForeverNamespacePrefix());

    const { realmCache, realmRefusals } = service as unknown as RealmMaps;
    expect([...realmCache.keys()]).toEqual(['us:classicann']);
    expect([...realmRefusals.keys()]).toEqual([]);
  });
});

describe('BlizzardService.fetchCharacterQuests — Forever-only guard (ROK-2109)', () => {
  it('returns null for a non-Forever namespace without requesting a token', async () => {
    const { service, getAccessToken } = setup();
    await expect(
      service.fetchCharacterQuests('Androl', 'whitemane', 'us', null),
    ).resolves.toBeNull();
    await expect(
      service.fetchCharacterQuests('Androl', 'whitemane', 'us', 'classic1x'),
    ).resolves.toBeNull();
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});

describe('BlizzardService.fetchForeverGuildSummary (ROK-1170)', () => {
  it('fetches the summary with a token for the region and maps a 200', async () => {
    const { service, getAccessToken } = setup();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 900101, faction: { type: 'HORDE' } }), {
        status: 200,
      }),
    );
    try {
      await expect(
        service.fetchForeverGuildSummary('example-guild', 'eu'),
      ).resolves.toEqual({
        kind: 'found',
        summary: { blizzardGuildId: 900101, foundedAt: null, faction: 'Horde' },
      });
      expect(getAccessToken).toHaveBeenCalledWith('eu');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/data/wow/guild/example-guild?namespace='),
        { headers: { Authorization: 'Bearer t' } },
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
