import {
  buildGuildRosterUrl,
  buildProfileDetailUrls,
  buildProfileUrl,
  buildRulesetUrl,
  dedupeTargets,
  summariseKeys,
} from './forever-namespace-probe.forever';
import {
  runProbe,
  type ProbeFetch,
  type ProbeResponse,
} from './forever-namespace-probe.helpers';

/** A response stub with a fixed status and JSON body. */
function reply(status: number, body: unknown = {}): ProbeResponse {
  return { status, json: () => Promise.resolve(body) };
}

const API = 'https://us.api.blizzard.com';
const NS = '?namespace=profile-forever-us&locale=en_US';

describe('Forever URL builders (ROK-2102)', () => {
  it('builds the dynamic ruleset index URL', () => {
    expect(buildRulesetUrl('forever', 'eu')).toEqual({
      endpoint: 'ruleset',
      url: 'https://eu.api.blizzard.com/data/wow/ruleset/index?namespace=dynamic-forever-eu&locale=en_US',
    });
  });

  it('builds a realmless profile URL from a single-segment slug', () => {
    expect(buildProfileUrl('Thrall-Stormborn', 'forever', 'us')).toBe(
      `${API}/profile/wow/character/thrall-stormborn${NS}`,
    );
  });

  it('keeps the two-segment Classic profile URL unchanged', () => {
    expect(buildProfileUrl('Dreamscythe/Thrall', 'forever', 'us')).toBe(
      `${API}/profile/wow/character/dreamscythe/thrall${NS}`,
    );
  });

  it('builds the four profile sub-resource URLs', () => {
    const root = `${API}/profile/wow/character/thrall-stormborn`;
    expect(buildProfileDetailUrls('thrall-stormborn', 'forever', 'us')).toEqual(
      [
        { endpoint: 'profile-equipment', url: `${root}/equipment${NS}` },
        { endpoint: 'profile-professions', url: `${root}/professions${NS}` },
        { endpoint: 'profile-quests', url: `${root}/quests${NS}` },
        { endpoint: 'profile-media', url: `${root}/character-media${NS}` },
      ],
    );
  });

  it.each([
    ['raid-ledger', `${API}/data/wow/guild/raid-ledger/roster${NS}`],
    [
      'Dreamscythe/Raid-Ledger',
      `${API}/data/wow/guild/dreamscythe/raid-ledger/roster${NS}`,
    ],
  ])('builds the guild roster URL for %s', (path, url) => {
    expect(buildGuildRosterUrl(path, 'forever', 'us')).toBe(url);
  });

  it('dedupes matches by prefix:region', () => {
    expect(
      dedupeTargets([
        { prefix: 'forever', region: 'us', raceName: null, signal: 'ruleset' },
        {
          prefix: 'forever',
          region: 'us',
          raceName: 'Sky',
          signal: 'skyborne',
        },
        { prefix: 'forever', region: 'eu', raceName: null, signal: 'ruleset' },
      ]),
    ).toEqual([
      { prefix: 'forever', region: 'us' },
      { prefix: 'forever', region: 'eu' },
    ]);
  });

  it('summarises keys only — never names or ids', () => {
    const shape = summariseKeys({ name: 'Thrall', id: 7, items: [{ id: 1 }] });
    expect(shape).toEqual({
      topLevelKeys: ['name', 'id', 'items'],
      entryCount: 0,
      sample: [],
    });
    expect(summariseKeys(null)).toEqual({
      topLevelKeys: [],
      entryCount: 0,
      sample: [],
    });
  });
});

/** Forever-us: ruleset `rulesets` list, profile + subs + guild as configured. */
function foreverFetch(calls: string[], profileStatus: number): ProbeFetch {
  return (url) => {
    calls.push(url);
    if (url.includes('/ruleset/index?namespace=dynamic-forever-us'))
      return Promise.resolve(
        reply(200, { rulesets: [{ id: 1, name: 'PvP' }] }),
      );
    if (url.includes('/ruleset/'))
      return Promise.resolve(reply(200, { rulesets: [] }));
    if (url.includes('/profile/wow/character/thrall-stormborn?'))
      return Promise.resolve(reply(profileStatus, { name: 'Thrall', id: 9 }));
    if (url.includes('/profile/') || url.includes('/roster'))
      return Promise.resolve(reply(200, { secret: 'x', members: [{ id: 1 }] }));
    return Promise.resolve(reply(404));
  };
}

describe('runProbe — live Forever shapes (ROK-2102)', () => {
  const input = (fetchFn: ProbeFetch, guildPath: string | null) => ({
    fetchFn,
    token: 't',
    candidates: ['forever', 'classic'],
    regions: ['us'],
    characterPath: 'Thrall-Stormborn',
    guildPath,
  });

  it('matches a non-empty ruleset index but not an empty one', async () => {
    const run = await runProbe(input(foreverFetch([], 404), null));
    expect(run.matches).toEqual([
      { prefix: 'forever', region: 'us', raceName: null, signal: 'ruleset' },
    ]);
    expect(run.shapes['forever:us:ruleset']).toMatchObject({ entryCount: 1 });
  });

  it('probes profile sub-resources only after a profile 200', async () => {
    const calls: string[] = [];
    const run = await runProbe(input(foreverFetch(calls, 404), null));
    expect(calls.some((u) => u.includes('/equipment'))).toBe(false);
    expect(run.cells.filter((c) => c.endpoint === 'profile')).toHaveLength(1);
  });

  it('records profile-family + guild roster cells with keys-only shapes', async () => {
    const calls: string[] = [];
    const run = await runProbe(input(foreverFetch(calls, 200), 'raid-ledger'));
    const endpoints = run.cells
      .filter((c) => c.prefix === 'forever' && c.status === 200)
      .map((c) => c.endpoint)
      .sort();
    expect(endpoints).toEqual([
      'guild-roster',
      'profile',
      'profile-equipment',
      'profile-media',
      'profile-professions',
      'profile-quests',
      'ruleset',
    ]);
    expect(calls).toContain(`${API}/data/wow/guild/raid-ledger/roster${NS}`);
    expect(run.shapes['forever:us:profile']).toEqual({
      topLevelKeys: ['name', 'id'],
      entryCount: 0,
      sample: [],
    });
    expect(run.shapes['forever:us:guild-roster']).toEqual({
      topLevelKeys: ['secret', 'members'],
      entryCount: 0,
      sample: [],
    });
    expect(JSON.stringify(run.shapes)).not.toContain('Thrall');
  });

  it('probes the profile once per prefix:region even with two signals', async () => {
    const calls: string[] = [];
    const fetchFn: ProbeFetch = (url) => {
      if (url.includes('static-forever-us'))
        return Promise.resolve(reply(200, { races: [{ name: 'Skyborne' }] }));
      return foreverFetch(calls, 404)(url, {
        headers: {},
        signal: new AbortController().signal,
      });
    };
    const run = await runProbe(input(fetchFn, null));
    expect(run.matches.map((m) => m.signal).sort()).toEqual([
      'ruleset',
      'skyborne',
    ]);
    expect(run.cells.filter((c) => c.endpoint === 'profile')).toHaveLength(1);
  });
});
