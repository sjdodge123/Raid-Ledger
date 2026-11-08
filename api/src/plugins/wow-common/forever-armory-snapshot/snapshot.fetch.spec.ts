/**
 * ROK-2133: the shared roster Armory fetch — quests skipped, errors
 * classified into `MemberArmoryErrorKind`, unaddressable names never call.
 */
import {
  BadGatewayException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import type { CharacterSyncAdapter } from '../../plugin-host/extension-points';
import type { ExternalCharacterProfile } from '../../plugin-host/extension-types';
import { fetchForeverArmorySnapshot } from './snapshot.fetch';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const NOW = new Date('2026-11-08T12:00:00Z');

const profile: ExternalCharacterProfile = {
  name: 'Thrall Stormcaller',
  realm: null,
  class: 'Shaman',
  spec: 'Enhancement',
  role: 'dps',
  level: 42,
  race: 'Orc',
  faction: 'horde',
  itemLevel: 51,
  avatarUrl: 'https://img/avatar.jpg',
  renderUrl: null,
  profileUrl: null,
  externalId: '12345',
};

interface AdapterMocks {
  adapter: CharacterSyncAdapter;
  fetchProfile: jest.Mock;
  fetchQuests: jest.Mock;
}

function makeAdapter(): AdapterMocks {
  const fetchProfile = jest.fn().mockResolvedValue({ ...profile });
  const fetchQuests = jest.fn().mockResolvedValue({ questIds: [1] });
  const adapter: CharacterSyncAdapter = {
    gameSlugs: ['wow-forever'],
    resolveGameSlugs: () => ['wow-forever'],
    fetchProfile,
    fetchSpecialization: jest
      .fn()
      .mockResolvedValue({ spec: null, role: null, talents: { t: 1 } }),
    fetchEquipment: jest.fn().mockResolvedValue({ items: [] }),
    fetchProfessions: jest.fn().mockResolvedValue({ primaries: [] }),
    fetchQuests,
  };
  return { adapter, fetchProfile, fetchQuests };
}

function makeDb(): { mock: MockDb; db: Db } {
  const mock = createDrizzleMock();
  mock.limit.mockResolvedValue([{ apiNamespacePrefix: 'static-forever' }]);
  return { mock, db: mock as unknown as Db };
}

const target = {
  name: 'Thrall Stormcaller',
  region: 'us',
  gameId: 7,
  now: NOW,
};

describe('fetchForeverArmorySnapshot', () => {
  it('maps a fetched profile to a snapshot without fetching quests', async () => {
    const { adapter, fetchProfile, fetchQuests } = makeAdapter();
    const out = await fetchForeverArmorySnapshot(makeDb().db, adapter, target);
    expect(fetchQuests).not.toHaveBeenCalled();
    expect(fetchProfile).toHaveBeenCalledWith(
      'Thrall Stormcaller',
      null,
      'us',
      'static-forever',
    );
    expect(out).toEqual({
      ok: true,
      snapshot: {
        blizzardCharacterId: 12345,
        level: 42,
        class: 'Shaman',
        race: 'Orc',
        spec: 'Enhancement',
        role: 'dps',
        itemLevel: 51,
        avatarUrl: 'https://img/avatar.jpg',
        equipment: { items: [] },
        talents: { t: 1 },
        armoryProfessions: { primaries: [] },
        lastLoginAt: null,
        syncedAt: NOW,
      },
    });
  });

  it('a non-numeric fetched id maps to a null blizzardCharacterId', async () => {
    const { adapter, fetchProfile } = makeAdapter();
    fetchProfile.mockResolvedValue({ ...profile, externalId: 'abc' });
    const out = await fetchForeverArmorySnapshot(makeDb().db, adapter, target);
    expect(out.ok && out.snapshot.blizzardCharacterId).toBeNull();
  });
});

describe('fetchForeverArmorySnapshot — failures', () => {
  it('classifies a 404 as not_found', async () => {
    const { adapter, fetchProfile } = makeAdapter();
    fetchProfile.mockRejectedValue(new NotFoundException());
    const out = await fetchForeverArmorySnapshot(makeDb().db, adapter, target);
    expect(out).toEqual({ ok: false, kind: 'not_found' });
  });

  it.each([
    ['502', new BadGatewayException()],
    ['429', new HttpException('Too Many Requests', 429)],
    ['network', new Error('ECONNRESET')],
  ])('classifies a %s as upstream', async (_label, err) => {
    const { adapter, fetchProfile } = makeAdapter();
    fetchProfile.mockRejectedValue(err);
    const out = await fetchForeverArmorySnapshot(makeDb().db, adapter, target);
    expect(out).toEqual({ ok: false, kind: 'upstream' });
  });

  it('a non-two-part name is invalid_name with no db read or Blizzard call', async () => {
    const { adapter, fetchProfile } = makeAdapter();
    const { mock, db } = makeDb();
    const out = await fetchForeverArmorySnapshot(db, adapter, {
      ...target,
      name: 'Thrall',
    });
    expect(out).toEqual({ ok: false, kind: 'invalid_name' });
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(mock.select).not.toHaveBeenCalled();
  });
});
