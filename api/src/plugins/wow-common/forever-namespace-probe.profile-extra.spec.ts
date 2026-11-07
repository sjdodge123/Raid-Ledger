/**
 * ROK-2108 — keys-only profile extras, guild summary and ruleset detail.
 */
import type { ProbeFetch } from './forever-namespace-probe.helpers';
import { runProbe } from './forever-namespace-probe.helpers';
import {
  buildGuildSummaryUrl,
  buildMatchExtraUrls,
  buildProfileExtraUrls,
  buildRulesetDetailUrl,
  firstRulesetId,
  isDeepKeysEndpoint,
  summariseDeepKeys,
} from './forever-namespace-probe.profile-extra';
import { summariseCustomShape } from './forever-namespace-probe.static';

const T = { prefix: 'forever', region: 'us' };
const API = 'https://us.api.blizzard.com';
const PNS = '?namespace=profile-forever-us&locale=en_US';
const DNS = '?namespace=dynamic-forever-us&locale=en_US';
const CHAR = `${API}/profile/wow/character/rok-androl`;

describe('buildProfileExtraUrls', () => {
  it('builds the seven realmless sub-resource URLs in the profile namespace', () => {
    expect(buildProfileExtraUrls('Rok-Androl', T)).toEqual([
      {
        endpoint: 'profile-specializations',
        url: `${CHAR}/specializations${PNS}`,
      },
      {
        endpoint: 'profile-encounters-raids',
        url: `${CHAR}/encounters/raids${PNS}`,
      },
      {
        endpoint: 'profile-encounters-dungeons',
        url: `${CHAR}/encounters/dungeons${PNS}`,
      },
      { endpoint: 'profile-reputations', url: `${CHAR}/reputations${PNS}` },
      { endpoint: 'profile-achievements', url: `${CHAR}/achievements${PNS}` },
      { endpoint: 'profile-statistics', url: `${CHAR}/statistics${PNS}` },
      {
        endpoint: 'profile-quests-completed',
        url: `${CHAR}/quests/completed${PNS}`,
      },
    ]);
  });
});

describe('guild summary + ruleset detail URLs', () => {
  it('builds the realmless guild summary URL (lowercased, encoded)', () => {
    expect(buildGuildSummaryUrl('Raid Ledger', T)).toEqual({
      endpoint: 'guild-summary',
      url: `${API}/data/wow/guild/raid%20ledger${PNS}`,
    });
  });

  it('builds the dynamic ruleset detail URL', () => {
    expect(buildRulesetDetailUrl('3', T)).toEqual({
      endpoint: 'ruleset-detail',
      url: `${API}/data/wow/ruleset/3${DNS}`,
    });
  });

  it('reads the first sampled ruleset id; rejects absent or unsafe ids', () => {
    const shape = (id: unknown) => ({
      topLevelKeys: [],
      entryCount: 1,
      sample: [{ keys: ['id'], id }],
    });
    expect(firstRulesetId(shape(7))).toBe('7');
    expect(firstRulesetId(shape('pvp-rp'))).toBe('pvp-rp');
    expect(firstRulesetId(shape('../x'))).toBeNull();
    expect(firstRulesetId(shape(1.5))).toBeNull();
    expect(firstRulesetId(undefined)).toBeNull();
  });

  it('adds guild summary only with a guild, ruleset detail only with an id', () => {
    const shapes = {
      'forever:us:ruleset': {
        topLevelKeys: [],
        entryCount: 1,
        sample: [{ id: 2 }],
      },
    };
    expect(buildMatchExtraUrls(T, null, {})).toEqual([]);
    expect(
      buildMatchExtraUrls(T, 'raid-ledger', shapes).map((u) => u.endpoint),
    ).toEqual(['guild-summary', 'ruleset-detail']);
  });
});

describe('summariseDeepKeys', () => {
  it('records top-level keys + first-element keys and length of arrays, never values', () => {
    const body = {
      character: { name: 'Rok', id: 9 },
      reputations: [
        { faction: { name: 'Argent Dawn' }, standing: { value: 3 } },
        { faction: { name: 'Darnassus' } },
      ],
      empty: [],
      ids: [1, 2],
    };
    const shape = summariseDeepKeys(body);
    expect(shape).toEqual({
      topLevelKeys: ['character', 'reputations', 'empty', 'ids'],
      entryCount: 0,
      sample: [],
      arrayKeys: { reputations: ['faction', 'standing'], empty: [], ids: [] },
      arrayLengths: { reputations: 2, empty: 0, ids: 2 },
    });
    expect(JSON.stringify(shape)).not.toMatch(/Rok|Argent|Darnassus/);
  });

  it('returns an empty shape for null, primitives and array bodies', () => {
    const empty = {
      topLevelKeys: [],
      entryCount: 0,
      sample: [],
      arrayKeys: {},
      arrayLengths: {},
    };
    expect(summariseDeepKeys(null)).toEqual(empty);
    expect(summariseDeepKeys('x')).toEqual(empty);
    expect(summariseDeepKeys([{ a: 1 }])).toEqual(empty);
  });

  it('is the custom shape for every ROK-2108 endpoint only', () => {
    expect(isDeepKeysEndpoint('guild-summary')).toBe(true);
    expect(isDeepKeysEndpoint('ruleset-detail')).toBe(true);
    expect(isDeepKeysEndpoint('profile-statistics')).toBe(true);
    expect(isDeepKeysEndpoint('profile-quests')).toBe(false);
    expect(
      summariseCustomShape('profile-achievements', { a: [{ b: 1 }] }),
    ).toMatchObject({
      arrayKeys: { a: ['b'] },
    });
  });
});

const reply = (status: number, body: unknown = null) => ({
  status,
  json: () => Promise.resolve(body),
});
const fetchFor =
  (calls: string[], profileStatus: number): ProbeFetch =>
  (url) => {
    calls.push(url);
    if (url.includes('/ruleset/index?namespace=dynamic-forever-us'))
      return Promise.resolve(
        reply(200, { rulesets: [{ id: 4, name: 'PvP' }] }),
      );
    if (url.includes('/ruleset/4?'))
      return Promise.resolve(
        reply(200, { id: 4, realms: [{ slug: 's', id: 1 }] }),
      );
    if (url.includes('/data/wow/guild/raid-ledger?'))
      return Promise.resolve(reply(200, { name: 'Raid Ledger', crest: {} }));
    if (url === `${CHAR}${PNS}`)
      return Promise.resolve(reply(profileStatus, { id: 9 }));
    if (url.startsWith(CHAR))
      return Promise.resolve(reply(200, { secret: 'x' }));
    return Promise.resolve(reply(404));
  };
const input = (fetchFn: ProbeFetch) => ({
  fetchFn,
  token: 't',
  candidates: ['forever'],
  regions: ['us'],
  characterPath: 'rok-androl',
  guildPath: 'raid-ledger',
});

describe('runProbe — ROK-2108 follow-ups', () => {
  it('probes guild summary, ruleset detail and the extras with deep-keys shapes', async () => {
    const calls: string[] = [];
    const run = await runProbe(input(fetchFor(calls, 200)));
    expect(calls).toContain(`${API}/data/wow/guild/raid-ledger${PNS}`);
    expect(calls).toContain(`${API}/data/wow/ruleset/4${DNS}`);
    expect(calls).toContain(`${CHAR}/quests/completed${PNS}`);
    expect(run.shapes['forever:us:ruleset-detail']).toMatchObject({
      topLevelKeys: ['id', 'realms'],
      arrayKeys: { realms: ['slug', 'id'] },
    });
    expect(run.shapes['forever:us:guild-summary']).toMatchObject({
      topLevelKeys: ['name', 'crest'],
    });
    expect(run.shapes['forever:us:profile-specializations']).toMatchObject({
      topLevelKeys: ['secret'],
    });
    expect(JSON.stringify(run.shapes)).not.toContain('Raid Ledger');
  });

  it('skips the profile extras when the profile is not 200', async () => {
    const calls: string[] = [];
    const run = await runProbe(input(fetchFor(calls, 404)));
    expect(calls.some((u) => u.includes('/specializations'))).toBe(false);
    expect(run.cells.map((c) => c.endpoint)).toContain('guild-summary');
  });

  it('records a 403 / 404 on the new endpoints without a shape and keeps the other extras', async () => {
    const failing = new Map<string, number>([
      [`${CHAR}/achievements${PNS}`, 403],
      [`${CHAR}/statistics${PNS}`, 404],
      [`${API}/data/wow/guild/raid-ledger${PNS}`, 404],
      [`${API}/data/wow/ruleset/4${DNS}`, 403],
    ]);
    const base = fetchFor([], 200);
    const fetchFn: ProbeFetch = (url, init) => {
      const status = failing.get(url);
      return status === undefined
        ? base(url, init)
        : Promise.resolve(reply(status));
    };
    const run = await runProbe(input(fetchFn));
    const statusOf = (endpoint: string) =>
      run.cells.find((c) => c.endpoint === endpoint)?.status;
    expect(statusOf('profile-achievements')).toBe(403);
    expect(statusOf('profile-statistics')).toBe(404);
    expect(statusOf('guild-summary')).toBe(404);
    expect(statusOf('ruleset-detail')).toBe(403);
    for (const endpoint of [
      'profile-achievements',
      'profile-statistics',
      'guild-summary',
      'ruleset-detail',
    ]) {
      expect(run.shapes[`forever:us:${endpoint}`]).toBeUndefined();
    }
    for (const endpoint of [
      'profile-specializations',
      'profile-encounters-raids',
      'profile-encounters-dungeons',
      'profile-reputations',
      'profile-quests-completed',
    ]) {
      expect(statusOf(endpoint)).toBe(200);
      expect(run.shapes[`forever:us:${endpoint}`]).toMatchObject({
        topLevelKeys: ['secret'],
        arrayKeys: {},
      });
    }
  });
});
