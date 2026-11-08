/**
 * ROK-2124 L4 — ForeverAutoLinkService against a real database. Blizzard is
 * stubbed at the `BlizzardCharacterSyncAdapter` seam (spies on the instance
 * the app holds); the service under test is built with a no-op pause so a
 * multi-candidate run never waits 500 ms between attempts.
 */
import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import type { ExternalCharacterProfile } from '../../plugin-host/extension-types';
import { BlizzardCharacterSyncAdapter } from '../blizzard-character-sync.adapter';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';
import { WOW_FOREVER_GAME_SLUG } from '../wow-forever-identity.helpers';
import { ForeverAutoLinkService } from './forever-auto-link.service';

const HOUR = 60 * 60 * 1000;
type CharInsert = typeof schema.characters.$inferInsert;

let testApp: TestApp;
let adapter: BlizzardCharacterSyncAdapter;
let settings: SettingsService;
let service: ForeverAutoLinkService;
let gameId: number;
let userId: number;
let fetchProfile: jest.SpyInstance;

function profile(
  over: Partial<ExternalCharacterProfile> = {},
): ExternalCharacterProfile {
  return {
    name: 'Ana Forever',
    realm: null,
    class: '',
    spec: null,
    role: null,
    level: 42,
    race: 'Human',
    faction: 'Alliance',
    itemLevel: 51,
    avatarUrl: null,
    renderUrl: null,
    profileUrl: null,
    externalId: '9001',
    ...over,
  };
}

async function ensureGame(): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: WOW_FOREVER_GAME_SLUG })
      .returning(),
    'game',
  );
  return game.id;
}

async function seedUser(): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'local:autolink@test.local', username: 'autolink' })
      .returning(),
    'user',
  );
  return user.id;
}

/** A LedgerLink-bound, realmless Forever row (a candidate by default). */
async function seedChar(over: Partial<CharInsert> = {}): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId,
        name: 'Ana Forever',
        class: 'Paladin',
        region: 'us',
        ruleset: 'normal',
        level: 25,
        addonGuid: `Player-4395-${Math.random().toString(16).slice(2, 10)}`,
        ...over,
      })
      .returning(),
    'character',
  );
  return row.id;
}

const charRow = async (id: string) =>
  nonEmpty(
    await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, id)),
    'character',
  )[0];

const stateRow = async (id: string) =>
  (
    await testApp.db
      .select()
      .from(schema.wowForeverArmoryAutolink)
      .where(eq(schema.wowForeverArmoryAutolink.characterId, id))
  )[0];

function stubAdapter(): void {
  fetchProfile = jest
    .spyOn(adapter, 'fetchProfile')
    .mockResolvedValue(profile());
  jest.spyOn(adapter, 'fetchEquipment').mockResolvedValue(null);
  jest.spyOn(adapter, 'fetchProfessions').mockResolvedValue(null);
  jest.spyOn(adapter, 'fetchQuests').mockResolvedValue(null);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adapter = testApp.app.get(BlizzardCharacterSyncAdapter);
  settings = testApp.app.get(SettingsService);
});

beforeEach(async () => {
  gameId = await ensureGame();
  userId = await seedUser();
  jest.spyOn(settings, 'isBlizzardConfigured').mockResolvedValue(true);
  stubAdapter();
  service = new ForeverAutoLinkService(
    testApp.db,
    settings,
    adapter,
    async () => {},
  );
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('candidacy (AC-10)', () => {
  it('the job attempts only due LedgerLink candidates, oldest first', async () => {
    const good = await seedChar();
    await seedChar({ name: 'Low Level', level: 9 });
    await seedChar({ name: 'No Guid', addonGuid: null });
    await seedChar({ name: 'Thrall' });
    await seedChar({ name: 'Has Realm', realm: 'Mankrik' });
    await seedChar({ name: 'Linked Already', gameVariant: 'wow_forever' });

    const tally = await service.runDue();

    expect(tally).toEqual({ linked: 1 });
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    expect(fetchProfile.mock.calls[0]?.[0]).toBe('Ana Forever');
    expect((await charRow(good)).gameVariant).toBe('wow_forever');
  });
});

describe('a successful link (AC-1 shape, AC-3)', () => {
  it('writes the Armory identity and sync fields, keeps the addon identity', async () => {
    const id = await seedChar();
    expect(await service.attempt(id)).toBe('linked');
    const row = await charRow(id);
    expect(row).toMatchObject({
      gameVariant: 'wow_forever',
      externalId: '9001',
      level: 42,
      name: 'Ana Forever',
      ruleset: 'normal',
      class: 'Paladin',
    });
    expect(row.addonGuid).not.toBeNull();
    expect(row.lastSyncedAt).toBeInstanceOf(Date);
    expect(await stateRow(id)).toBeUndefined();
  });
});

describe('retry / backoff (AC-4, AC-5, AC-6)', () => {
  it('a 404 backs off 1 h, a second attempt before retry_at makes no call, then 2 h', async () => {
    const id = await seedChar();
    fetchProfile.mockRejectedValue(new NotFoundException('hidden'));
    const before = Date.now();
    expect(await service.attempt(id)).toBe('not_found');
    const first = await stateRow(id);
    expect(first).toMatchObject({ failures: 1, lastError: 'not_found' });
    expect(first?.retryAt.getTime()).toBeGreaterThanOrEqual(before + HOUR);
    expect(first?.retryAt.getTime()).toBeLessThanOrEqual(Date.now() + HOUR);
    expect((await charRow(id)).gameVariant).toBeNull();

    expect(await service.attempt(id)).toBe('skipped');
    expect(fetchProfile).toHaveBeenCalledTimes(1);

    await testApp.db
      .update(schema.wowForeverArmoryAutolink)
      .set({ retryAt: new Date(Date.now() - 1000) })
      .where(eq(schema.wowForeverArmoryAutolink.characterId, id));
    const again = Date.now();
    expect(await service.attempt(id)).toBe('not_found');
    const second = await stateRow(id);
    expect(second?.failures).toBe(2);
    expect(second?.retryAt.getTime()).toBeGreaterThanOrEqual(again + 2 * HOUR);
  });

  it('an upstream error backs the row off and ends the job run', async () => {
    const first = await seedChar({ name: 'First Char' });
    const second = await seedChar({ name: 'Second Char' });
    fetchProfile.mockRejectedValue(new BadGatewayException('429'));

    expect(await service.runDue()).toEqual({ upstream: 1 });
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    expect((await stateRow(first))?.lastError).toBe('upstream');
    expect(await stateRow(second)).toBeUndefined();
  });
});

describe('lost compare-and-set race (AC-11)', () => {
  it('an Armory import landing mid-fetch wins; the auto-link writes nothing', async () => {
    const id = await seedChar();
    fetchProfile.mockImplementation(async () => {
      await testApp.db
        .update(schema.characters)
        .set({ gameVariant: 'wow_forever', level: 30 })
        .where(eq(schema.characters.id, id));
      return profile();
    });
    expect(await service.attempt(id)).toBe('lost_race');
    const row = await charRow(id);
    expect(row).toMatchObject({ gameVariant: 'wow_forever', level: 30 });
    expect(row.externalId).toBeNull();
    expect(row.lastSyncedAt).toBeNull();
    expect(await stateRow(id)).toBeUndefined();
  });
});

describe('gates and guards (AC-8, AC-9, AC-13, AC-14)', () => {
  it('Blizzard not configured → disabled, no call, no state', async () => {
    const id = await seedChar();
    jest.spyOn(settings, 'isBlizzardConfigured').mockResolvedValue(false);
    expect(await service.attempt(id)).toBe('disabled');
    expect(await service.runDue()).toBeNull();
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(await stateRow(id)).toBeUndefined();
  });

  it('kill switch off → disabled, no call, no state', async () => {
    const id = await seedChar();
    const real = settings.get.bind(settings);
    jest
      .spyOn(settings, 'get')
      .mockImplementation(async (key) =>
        key === WOW_FOREVER_ARMORY_IMPORT_KEY ? 'false' : real(key),
      );
    expect(await service.attempt(id)).toBe('disabled');
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(await stateRow(id)).toBeUndefined();
  });

  it('another row already holding the Blizzard id → not linked, backed off', async () => {
    const holder = await seedChar({
      name: 'Other Holder',
      gameVariant: 'wow_forever',
      externalId: '9001',
    });
    const id = await seedChar();
    expect(await service.attempt(id)).toBe('external_id_conflict');
    expect((await charRow(id)).gameVariant).toBeNull();
    expect((await stateRow(id))?.lastError).toBe('external_id_conflict');
    expect((await charRow(holder)).externalId).toBe('9001');
  });

  it('deleting the character deletes its state row', async () => {
    const id = await seedChar();
    fetchProfile.mockRejectedValue(new NotFoundException('hidden'));
    await service.attempt(id);
    expect(await stateRow(id)).toBeDefined();
    await testApp.db
      .delete(schema.characters)
      .where(eq(schema.characters.id, id));
    expect(await stateRow(id)).toBeUndefined();
  });
});
