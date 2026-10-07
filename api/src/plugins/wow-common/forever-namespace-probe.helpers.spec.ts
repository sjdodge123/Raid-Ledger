import {
  DEFAULT_FOREVER_CANDIDATES,
  FOREVER_PROBE_REGIONS,
  FOREVER_PROBE_TIMEOUT_MS,
  buildCandidateList,
  buildProbeUrls,
  hasSkyborne,
  isInLaunchWindow,
  probeOne,
  runProbe,
  summariseShape,
  type ProbeFetch,
  type ProbeResponse,
} from './forever-namespace-probe.helpers';

/** A response stub with a fixed status and JSON body. */
function reply(status: number, body: unknown = {}): ProbeResponse {
  return { status, json: () => Promise.resolve(body) };
}

/** A fetch that never settles until its signal aborts (a timeout). */
const hangingFetch: ProbeFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('buildCandidateList', () => {
  it('starts from the seven defaults with classic as the control', () => {
    expect(DEFAULT_FOREVER_CANDIDATES).toEqual([
      'classicforever',
      'forever',
      'classicfe',
      'classic2x',
      'classicplus',
      'wowforever',
      'classic',
    ]);
    expect(buildCandidateList([])).toEqual(DEFAULT_FOREVER_CANDIDATES);
  });

  it('appends valid extras, dedupes, and drops invalid prefixes', () => {
    const list = buildCandidateList([
      ' Classicann ',
      'forever',
      'classicann',
      'x',
      'bad-prefix',
      'a'.repeat(33),
      'fe2',
    ]);
    expect(list).toEqual([...DEFAULT_FOREVER_CANDIDATES, 'classicann', 'fe2']);
  });
});

describe('buildProbeUrls', () => {
  it('builds the realm, connected-realm and playable-race URLs', () => {
    expect(buildProbeUrls('classicforever', 'eu')).toEqual([
      {
        endpoint: 'realm',
        url: 'https://eu.api.blizzard.com/data/wow/realm/index?namespace=dynamic-classicforever-eu&locale=en_US',
      },
      {
        endpoint: 'connected-realm',
        url: 'https://eu.api.blizzard.com/data/wow/connected-realm/index?namespace=dynamic-classicforever-eu&locale=en_US',
      },
      {
        endpoint: 'playable-race',
        url: 'https://eu.api.blizzard.com/data/wow/playable-race/index?namespace=static-classicforever-eu&locale=en_US',
      },
    ]);
  });
});

describe('probeOne', () => {
  it('uses a 10 s default timeout', () => {
    expect(FOREVER_PROBE_TIMEOUT_MS).toBe(10_000);
  });

  it('returns the status and body with a bearer token', async () => {
    const fetchFn = jest.fn<ReturnType<ProbeFetch>, Parameters<ProbeFetch>>(
      () => Promise.resolve(reply(200, { a: 1 })),
    );
    const out = await probeOne(fetchFn, 'tok', 'https://x');
    expect(out).toEqual({ status: 200, body: { a: 1 } });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://x',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
  });

  it('returns a null body for a non-200 status', async () => {
    const out = await probeOne(() => Promise.resolve(reply(403)), 't', 'u');
    expect(out).toEqual({ status: 403, body: null });
  });

  it('returns a null status with the error on a network failure', async () => {
    const out = await probeOne(
      () => Promise.reject(new Error('ECONNRESET')),
      't',
      'u',
    );
    expect(out).toEqual({ status: null, body: null, error: 'ECONNRESET' });
  });

  it('returns a null status when the request times out', async () => {
    const out = await probeOne(hangingFetch, 't', 'u', 5);
    expect(out.status).toBeNull();
    expect(out.error).toMatch(/timed out after 5ms/);
  });
});

describe('hasSkyborne', () => {
  it('returns the matched race name', () => {
    const body = { races: [{ name: 'Human' }, { name: 'Skyborne' }] };
    expect(hasSkyborne(body)).toBe('Skyborne');
  });

  it('matches a localized name object case-insensitively', () => {
    const body = { races: [{ name: { en_US: 'The SKYBORNE' } }] };
    expect(hasSkyborne(body)).toBe('The SKYBORNE');
  });

  it('returns null without Skyborne or for a malformed body', () => {
    expect(hasSkyborne({ races: [{ name: 'Human' }] })).toBeNull();
    expect(hasSkyborne({ races: 'nope' })).toBeNull();
    expect(hasSkyborne(null)).toBeNull();
  });
});

describe('summariseShape', () => {
  it('captures keys, entry count and a 3-entry sample', () => {
    const realms = [1, 2, 3, 4].map((id) => ({
      id,
      name: `R${id}`,
      slug: `r${id}`,
      region: {},
    }));
    expect(summariseShape({ _links: {}, realms })).toEqual({
      topLevelKeys: ['_links', 'realms'],
      entryCount: 4,
      sample: [1, 2, 3].map((id) => ({
        keys: ['id', 'name', 'slug', 'region'],
        id,
        name: `R${id}`,
        slug: `r${id}`,
      })),
    });
  });

  it('handles href-only entries and a body without an array', () => {
    const summary = summariseShape({ connected_realms: [{ href: 'h' }] });
    expect(summary).toEqual({
      topLevelKeys: ['connected_realms'],
      entryCount: 1,
      sample: [{ keys: ['href'] }],
    });
    expect(summariseShape({ a: 1 })).toEqual({
      topLevelKeys: ['a'],
      entryCount: 0,
      sample: [],
    });
  });
});

describe('isInLaunchWindow', () => {
  it.each([
    ['2026-11-03T23:59:00Z', false],
    ['2026-11-04T00:00:00Z', true],
    ['2026-11-18T23:59:59Z', true],
    ['2026-11-19T00:00:00Z', false],
  ])('%s -> %s', (iso, expected) => {
    expect(isInLaunchWindow(new Date(iso))).toBe(expected);
  });
});

describe('runProbe', () => {
  /** realm 404, connected-realm 403, classic races 200, forever/kr realm hangs. */
  const matrixFetch: ProbeFetch = (url, init) => {
    if (url.includes('realm/index?namespace=dynamic-forever-kr'))
      return hangingFetch(url, init);
    if (url.includes('/connected-realm/')) return Promise.resolve(reply(403));
    if (url.includes('static-classic-'))
      return Promise.resolve(reply(200, { races: [{ name: 'Human' }] }));
    return Promise.resolve(reply(404));
  };

  it('records one cell per candidate x region x endpoint (84)', async () => {
    const run = await runProbe({
      fetchFn: matrixFetch,
      token: 't',
      candidates: buildCandidateList([]),
      regions: FOREVER_PROBE_REGIONS,
      characterPath: null,
      timeoutMs: 5,
    });
    expect(FOREVER_PROBE_REGIONS).toEqual(['us', 'eu', 'kr', 'tw']);
    expect(run.cells).toHaveLength(84);
    const keys = new Set(
      run.cells.map((c) => `${c.prefix}|${c.region}|${c.endpoint}`),
    );
    expect(keys.size).toBe(84);
    const find = (p: string, r: string, e: string) =>
      run.cells.find(
        (c) => c.prefix === p && c.region === r && c.endpoint === e,
      );
    expect(find('forever', 'kr', 'realm')).toMatchObject({ status: null });
    expect(find('forever', 'kr', 'realm')?.error).toMatch(/timed out/);
    expect(find('forever', 'us', 'realm')?.status).toBe(404);
    expect(find('classic', 'eu', 'connected-realm')?.status).toBe(403);
    expect(find('classic', 'tw', 'playable-race')?.status).toBe(200);
    expect(run.matches).toEqual([]);
  });
});

describe('runProbe matches + concurrency', () => {
  /** Skyborne under classicforever; a Human-only 200 under the classic control. */
  function skyFetch(calls: string[]): ProbeFetch {
    return (url) => {
      calls.push(url);
      if (url.includes('static-classicforever-'))
        return Promise.resolve(reply(200, { races: [{ name: 'Skyborne' }] }));
      if (url.includes('static-classic-'))
        return Promise.resolve(reply(200, { races: [{ name: 'Human' }] }));
      if (url.includes('/profile/')) return Promise.resolve(reply(404));
      if (url.includes('dynamic-classicforever-'))
        return Promise.resolve(reply(200, { realms: [{ id: 7 }] }));
      return Promise.resolve(reply(404));
    };
  }

  it('matches Skyborne but not the classic control, then checks the profile', async () => {
    const calls: string[] = [];
    const run = await runProbe({
      fetchFn: skyFetch(calls),
      token: 't',
      candidates: ['classicforever', 'classic'],
      regions: ['us'],
      characterPath: 'Dreamscythe/Thrall',
    });
    expect(run.matches).toEqual([
      { prefix: 'classicforever', region: 'us', raceName: 'Skyborne' },
    ]);
    expect(calls).toContain(
      'https://us.api.blizzard.com/profile/wow/character/dreamscythe/thrall?namespace=profile-classicforever-us&locale=en_US',
    );
    const profile = run.cells.filter((c) => c.endpoint === 'profile');
    expect(profile).toEqual([
      {
        prefix: 'classicforever',
        region: 'us',
        endpoint: 'profile',
        status: 404,
      },
    ]);
    expect(Object.keys(run.shapes).sort()).toEqual([
      'classicforever:us:connected-realm',
      'classicforever:us:realm',
    ]);
    expect(run.shapes['classicforever:us:realm']).toMatchObject({
      entryCount: 1,
    });
  });

  it('skips the profile check without a character path', async () => {
    const calls: string[] = [];
    const run = await runProbe({
      fetchFn: skyFetch(calls),
      token: 't',
      candidates: ['classicforever'],
      regions: ['us'],
      characterPath: null,
    });
    expect(run.cells.some((c) => c.endpoint === 'profile')).toBe(false);
    expect(calls.some((u) => u.includes('/profile/'))).toBe(false);
  });
});

describe('runProbe concurrency', () => {
  it('runs at most 4 requests at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const slowFetch: ProbeFetch = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return reply(404);
    };
    const run = await runProbe({
      fetchFn: slowFetch,
      token: 't',
      candidates: ['aa', 'bb', 'cc'],
      regions: ['us', 'eu'],
      characterPath: null,
    });
    expect(run.cells).toHaveLength(18);
    expect(peak).toBe(4);
  });
});
