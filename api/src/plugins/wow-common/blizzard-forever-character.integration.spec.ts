/**
 * ROK-2102 B.5 — realmless WoW: Forever character through the real Nest app's
 * BlizzardService, with `fetch` stubbed at the global seam (no network).
 *
 * The HTTP preview route still requires a realm until ROK-1722 C1, so the
 * service is driven directly; a 404 is asserted as the NotFoundException
 * (status 404) Nest would render.
 *
 * Fixtures in `testing/fixtures/blizzard-forever/` carry INVENTED values. Their
 * top-level keys follow the retail profile/equipment/professions/media/roster
 * bodies (the probe recorded status codes only). FLAG B1: swap for recorded,
 * anonymised bodies once available.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { SettingsService } from '../../settings/settings.service';
import { BlizzardService } from './blizzard.service';
import {
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';

const FIXTURES = join(__dirname, 'testing', 'fixtures', 'blizzard-forever');
const CHAR = 'https://us.api.blizzard.com/profile/wow/character/ana-forever';
const NS = '?namespace=profile-forever-us&locale=en_US';

function fixture(file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/** Exact URL → fixture file. Anything else is a 404. */
const ROUTES: Record<string, string> = {
  [`${CHAR}${NS}`]: 'profile.json',
  [`${CHAR}/character-media${NS}`]: 'media.json',
  [`${CHAR}/equipment${NS}`]: 'equipment.json',
  [`${CHAR}/professions${NS}`]: 'professions.json',
  [`https://us.api.blizzard.com/data/wow/guild/lantern-watch/roster${NS}`]:
    'guild-roster.json',
};

let testApp: TestApp;
let blizzard: BlizzardService;
let fetchSpy: jest.SpyInstance;
let previousPrefix: string;
let profileStatus: number;

function stubBlizzard(): void {
  fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes('battle.net/oauth/token')) {
        return Promise.resolve(json({ access_token: 't', expires_in: 3600 }));
      }
      if (url === `${CHAR}${NS}` && profileStatus !== 200) {
        return Promise.resolve(json({}, profileStatus));
      }
      const file = ROUTES[url];
      return Promise.resolve(file ? json(fixture(file)) : json({}, 404));
    });
}

/** Every character-profile URL fetched so far (OAuth and any background
 * Blizzard call a settings change may trigger are excluded). */
function apiUrls(): string[] {
  return fetchSpy.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((u: string) => u.includes('/profile/wow/character/'));
}

beforeAll(async () => {
  testApp = await getTestApp();
  blizzard = testApp.app.get(BlizzardService);
});

beforeEach(async () => {
  profileStatus = 200;
  stubBlizzard();
  await testApp.app
    .get(SettingsService)
    .setBlizzardConfig({ clientId: 'cid', clientSecret: 'secret' });
  previousPrefix = getForeverNamespacePrefix();
  setForeverNamespacePrefix('forever');
});

afterEach(async () => {
  setForeverNamespacePrefix(previousPrefix);
  fetchSpy.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('realmless Forever character (ROK-2102)', () => {
  it('maps the profile with realm null from the realmless path', async () => {
    const profile = await blizzard.fetchCharacterProfile(
      'Ana Forever',
      null,
      'us',
      'classicforever',
    );
    expect(profile).toEqual({
      name: 'Ana Forever',
      realm: null,
      class: 'Mage',
      spec: 'Frost',
      role: 'dps',
      level: 24,
      race: 'Human',
      faction: 'alliance',
      itemLevel: 22,
      avatarUrl: 'https://render.example.invalid/ana-forever-avatar.jpg',
      renderUrl: 'https://render.example.invalid/ana-forever-main-raw.png',
      profileUrl: null,
    });
    expect(apiUrls()).toEqual([`${CHAR}${NS}`, `${CHAR}/character-media${NS}`]);
  });

  it('maps the equipment summary', async () => {
    const equipment = await blizzard.fetchCharacterEquipment(
      'Ana Forever',
      null,
      'us',
      'classicforever',
    );
    expect(equipment?.equippedItemLevel).toBe(22);
    expect(equipment?.items.map((i) => [i.itemId, i.itemLevel])).toEqual([
      [910001, 23],
      [910002, 25],
    ]);
    expect(apiUrls()).toContain(`${CHAR}/equipment${NS}`);
  });

  it('fetches professions (Forever is not skipped)', async () => {
    const professions = await blizzard.fetchCharacterProfessions(
      'Ana Forever',
      null,
      'us',
      'classicforever',
    );
    expect(professions?.primary.map((p) => p.name)).toEqual(['Tailoring']);
    expect(professions?.secondary.map((p) => p.name)).toEqual(['Cooking']);
    expect(apiUrls()).toEqual([`${CHAR}/professions${NS}`]);
  });

  it('turns a profile 404 into a 404 with the level-10 copy', async () => {
    profileStatus = 404;
    const err: unknown = await blizzard
      .fetchCharacterProfile('Ana Forever', null, 'us', 'classicforever')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getStatus()).toBe(404);
    expect((err as Error).message).toContain(
      "isn't visible on Battle.net yet (US)",
    );
  });

  it('maps a guild roster under the Forever profile namespace', async () => {
    const roster = await blizzard.fetchForeverGuildRoster(
      'lantern-watch',
      'us',
    );
    expect(roster).toEqual({
      members: [
        { name: 'Ana Forever', level: 24, classId: 8, rank: 0 },
        { name: 'Bo Tester', level: 12, classId: 1, rank: 4 },
      ],
    });
  });
});
