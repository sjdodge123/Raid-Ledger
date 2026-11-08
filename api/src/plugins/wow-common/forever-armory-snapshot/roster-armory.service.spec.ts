/**
 * ROK-2133 D3: the roster Armory pass — orchestration only. The due query,
 * the Blizzard fetch and the writes are mocked at their module boundaries;
 * the SQL due predicate + oldest-first order are covered by the
 * integration spec.
 */
import { Test } from '@nestjs/testing';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { SettingsService } from '../../../settings/settings.service';
import { BlizzardCharacterSyncAdapter } from '../blizzard-character-sync.adapter';
import { RosterInsightsCache } from '../guilds/roster-insights/roster-insights.cache';
import { findForeverGameId } from '../forever-auto-link/forever-auto-link.apply';
import {
  listDueRosterMembers,
  type DueRosterMember,
} from './roster-armory.queries';
import { fetchForeverArmorySnapshot } from './snapshot.fetch';
import { recordMemberFailure, writeMemberSnapshot } from './snapshot.apply';
import {
  MAX_MEMBERS_PER_RUN,
  type MemberArmorySnapshot,
} from './snapshot.helpers';
import { RosterArmoryService } from './roster-armory.service';

jest.mock('../forever-auto-link/forever-auto-link.apply', () => ({
  findForeverGameId: jest.fn(),
}));
jest.mock('./roster-armory.queries', () => ({
  listDueRosterMembers: jest.fn(),
}));
jest.mock('./snapshot.fetch', () => ({
  fetchForeverArmorySnapshot: jest.fn(),
}));
jest.mock('./snapshot.apply', () => ({
  writeMemberSnapshot: jest.fn(),
  recordMemberFailure: jest.fn(),
}));

const listDue = jest.mocked(listDueRosterMembers);
const fetchSnap = jest.mocked(fetchForeverArmorySnapshot);
const writeSnap = jest.mocked(writeMemberSnapshot);
const recordFail = jest.mocked(recordMemberFailure);
const gameIdOf = jest.mocked(findForeverGameId);

let service: RosterArmoryService;
let settings: { get: jest.Mock; isBlizzardConfigured: jest.Mock };
let cache: { invalidateGuild: jest.Mock };

function member(id: number, blizzId: number, guildId = 1): DueRosterMember {
  return {
    memberId: id,
    guildId,
    blizzardCharacterId: blizzId,
    characterName: `Char${id}-Realm`,
    region: 'us',
  };
}

function snap(blizzId: number | null): MemberArmorySnapshot {
  return {
    blizzardCharacterId: blizzId,
    level: 20,
    class: 'Mage',
    race: 'Gnome',
    spec: null,
    role: null,
    itemLevel: 30,
    avatarUrl: null,
    equipment: null,
    talents: null,
    armoryProfessions: null,
    lastLoginAt: null,
    syncedAt: new Date('2026-11-08T00:00:00Z'),
  };
}

/** Every fetch succeeds with the requested member's own id. */
function fetchEchoesRosterId(rows: DueRosterMember[]): void {
  fetchSnap.mockImplementation((_db, _adapter, target) => {
    const row = rows.find((r) => r.characterName === target.name);
    return Promise.resolve({
      ok: true,
      snapshot: snap(row?.blizzardCharacterId ?? null),
    });
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  gameIdOf.mockResolvedValue(5);
  writeSnap.mockResolvedValue(undefined);
  recordFail.mockResolvedValue(undefined);
  settings = {
    get: jest.fn().mockResolvedValue(null),
    isBlizzardConfigured: jest.fn().mockResolvedValue(true),
  };
  cache = { invalidateGuild: jest.fn() };
  const mod = await Test.createTestingModule({
    providers: [
      RosterArmoryService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: SettingsService, useValue: settings },
      { provide: BlizzardCharacterSyncAdapter, useValue: {} },
      { provide: RosterInsightsCache, useValue: cache },
    ],
  }).compile();
  service = mod.get(RosterArmoryService);
});

describe('RosterArmoryService.runDue — gates (AC-6)', () => {
  it('kill switch off → no due query, no fetch, no writes', async () => {
    settings.get.mockResolvedValue('false');
    listDue.mockResolvedValue([member(1, 101)]);
    await expect(service.runDue()).resolves.toBeNull();
    expect(listDue).not.toHaveBeenCalled();
    expect(fetchSnap).not.toHaveBeenCalled();
    expect(writeSnap).not.toHaveBeenCalled();
    expect(recordFail).not.toHaveBeenCalled();
  });

  it('Blizzard unconfigured → no due query, no fetch, no writes', async () => {
    settings.isBlizzardConfigured.mockResolvedValue(false);
    listDue.mockResolvedValue([member(1, 101)]);
    await expect(service.runDue()).resolves.toBeNull();
    expect(listDue).not.toHaveBeenCalled();
    expect(fetchSnap).not.toHaveBeenCalled();
    expect(writeSnap).not.toHaveBeenCalled();
  });
});

describe('RosterArmoryService.runDue — the pass (AC-1, AC-7)', () => {
  it('asks for at most 150 due members of every claimable hub', async () => {
    listDue.mockResolvedValue([]);
    await service.runDue();
    expect(listDue).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        gameId: 5,
        limit: MAX_MEMBERS_PER_RUN,
        guildId: undefined,
      }),
    );
  });

  it('caps attempts at 150 in the order the query returned them', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => member(i + 1, 1000 + i));
    listDue.mockResolvedValue(rows);
    fetchEchoesRosterId(rows);
    await service.runDue();
    expect(fetchSnap).toHaveBeenCalledTimes(150);
    expect(fetchSnap.mock.calls.map((c) => c[2].name)).toEqual(
      rows.slice(0, 150).map((r) => r.characterName),
    );
  });

  it('success writes the snapshot under the roster id and invalidates that guild', async () => {
    const rows = [member(1, 101, 7)];
    listDue.mockResolvedValue(rows);
    fetchEchoesRosterId(rows);
    await service.runDue();
    expect(fetchSnap).toHaveBeenCalledWith(
      {},
      {},
      expect.objectContaining({ name: 'Char1-Realm', region: 'us', gameId: 5 }),
    );
    expect(writeSnap).toHaveBeenCalledWith(
      {},
      1,
      101,
      snap(101),
      expect.any(Date),
    );
    expect(cache.invalidateGuild).toHaveBeenCalledWith(7);
  });

  it('dedupes by Blizzard id: one fetch, written to every member sharing it', async () => {
    const rows = [member(1, 101, 7), member(2, 101, 8)];
    listDue.mockResolvedValue(rows);
    fetchEchoesRosterId(rows);
    await service.runDue();
    expect(fetchSnap).toHaveBeenCalledTimes(1);
    expect(writeSnap.mock.calls.map((c) => c[1])).toEqual([1, 2]);
    expect(cache.invalidateGuild.mock.calls.map((c) => c[0])).toEqual([7, 8]);
  });
});

describe('RosterArmoryService.runDue — failures (AC-3..5)', () => {
  it('fetched id ≠ roster id → id_mismatch failure, nothing stored', async () => {
    listDue.mockResolvedValue([member(1, 101)]);
    fetchSnap.mockResolvedValue({ ok: true, snapshot: snap(999) });
    await service.runDue();
    expect(writeSnap).not.toHaveBeenCalled();
    expect(recordFail).toHaveBeenCalledWith(
      {},
      1,
      'id_mismatch',
      expect.any(Date),
    );
    expect(cache.invalidateGuild).not.toHaveBeenCalled();
  });

  it('not_found backs the member off and the run continues', async () => {
    const rows = [member(1, 101), member(2, 102)];
    listDue.mockResolvedValue(rows);
    fetchSnap
      .mockResolvedValueOnce({ ok: false, kind: 'not_found' })
      .mockResolvedValueOnce({ ok: true, snapshot: snap(102) });
    await service.runDue();
    expect(recordFail).toHaveBeenCalledWith(
      {},
      1,
      'not_found',
      expect.any(Date),
    );
    expect(writeSnap.mock.calls.map((c) => c[1])).toEqual([2]);
  });

  it('an upstream error backs that member off and stops the run', async () => {
    const rows = [member(1, 101), member(2, 102), member(3, 103)];
    listDue.mockResolvedValue(rows);
    fetchSnap
      .mockResolvedValueOnce({ ok: true, snapshot: snap(101) })
      .mockResolvedValueOnce({ ok: false, kind: 'upstream' });
    await service.runDue();
    expect(fetchSnap).toHaveBeenCalledTimes(2);
    expect(recordFail.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [2, 'upstream'],
    ]);
    expect(writeSnap.mock.calls.map((c) => c[1])).toEqual([1]);
  });

  it('skips an overlapping run (own re-entry guard)', async () => {
    let release: (v: DueRosterMember[]) => void = () => undefined;
    listDue.mockReturnValueOnce(new Promise((r) => (release = r)));
    const first = service.runDue();
    await expect(service.runDue()).resolves.toBeNull();
    release([]);
    await expect(first).resolves.toEqual({});
  });
});

describe('RosterArmoryService.runForGuild (AC-13)', () => {
  it('scopes the due query to that guild', async () => {
    listDue.mockResolvedValue([]);
    await service.runForGuild(42);
    expect(listDue).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        gameId: 5,
        guildId: 42,
        limit: MAX_MEMBERS_PER_RUN,
      }),
    );
  });
});
