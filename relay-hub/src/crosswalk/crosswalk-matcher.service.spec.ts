import {
  RlGameIdSchema,
  type CrosswalkContributionItem,
} from '@raid-ledger/contract';
import { CrosswalkMatcherService } from './crosswalk-matcher.service';
import type { CrosswalkStore, StoredId } from './crosswalk.repository';
import { lockKeysFor } from './item-ids';
import { resolveResult } from './match-plan';

const INSTANCE = '3f2b8c1e-9a4d-4e7b-8c2f-1a6d5e9b0c47';
const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const A = '01JD0000000000000000000000';
const B = '01JD0000000000000000000001';
const STEAM = { kind: 'steam_app_id', value: '10' } as const;
const ITAD = { kind: 'itad_uuid', value: UUID } as const;

function item(over: Partial<CrosswalkContributionItem> = {}) {
  const base: CrosswalkContributionItem = {
    clientRef: 'g1',
    name: 'Resident Evil',
    steamAppId: 10,
    provenance: { steamAppId: 'steam' },
  };
  return { ...base, ...over };
}

function owned(
  id: typeof STEAM | typeof ITAD,
  rlGameId: string,
  provenance: StoredId['provenance'] = 'steam',
): StoredId {
  return { ...id, rlGameId, provenance };
}

function setup(owners: StoredId[] = [], candidate?: string) {
  const store: jest.Mocked<CrosswalkStore> = {
    findIdOwners: jest.fn().mockResolvedValue(owners),
    findNameCandidate: jest.fn().mockResolvedValue(candidate),
    insertGame: jest.fn().mockResolvedValue(undefined),
    insertIds: jest.fn().mockResolvedValue(undefined),
    raiseProvenance: jest.fn().mockResolvedValue(undefined),
    bumpSeq: jest.fn().mockResolvedValue(undefined),
    openConflictExists: jest.fn().mockResolvedValue(false),
    insertConflict: jest.fn().mockResolvedValue(undefined),
  };
  const keys: (readonly string[])[] = [];
  const lock = {
    run<T>(k: readonly string[], fn: (s: CrosswalkStore) => Promise<T>) {
      keys.push(k);
      return fn(store);
    },
  };
  return { store, keys, service: new CrosswalkMatcherService(lock) };
}

describe('CrosswalkMatcherService.matchBatch', () => {
  it('step (d): a new game is created with a ULID and all its ids', async () => {
    const { store, keys, service } = setup();
    const [r] = await service.matchBatch(INSTANCE, [item()]);
    expect(r?.result).toBe('created');
    expect(RlGameIdSchema.safeParse(r?.rlGameId).success).toBe(true);
    expect(store.insertGame).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Resident Evil',
        rlGameId: r?.rlGameId,
      }),
    );
    expect(store.insertIds).toHaveBeenCalledWith(r?.rlGameId, INSTANCE, [
      { ...STEAM, provenance: 'steam' },
    ]);
    expect(keys).toEqual([lockKeysFor(item())]);
  });

  it('re-posting a known game matches and writes nothing', async () => {
    const { store, service } = setup([owned(STEAM, A)]);
    const [r] = await service.matchBatch(INSTANCE, [item()]);
    expect(r).toEqual({ clientRef: 'g1', result: 'matched', rlGameId: A });
    expect(store.insertIds).toHaveBeenCalledWith(A, INSTANCE, []);
    expect(store.bumpSeq).not.toHaveBeenCalled();
    expect(store.insertGame).not.toHaveBeenCalled();
  });

  it('a new ITAD id on a known Steam id attaches and bumps the seq', async () => {
    const { store, service } = setup([owned(STEAM, A)]);
    const it2 = item({
      itadUuid: UUID,
      provenance: { steamAppId: 'steam', itadUuid: 'itad' },
    });
    const [r] = await service.matchBatch(INSTANCE, [it2]);
    expect(r?.result).toBe('attached');
    expect(store.insertIds).toHaveBeenCalledWith(A, INSTANCE, [
      { ...ITAD, provenance: 'itad' },
    ]);
    expect(store.bumpSeq).toHaveBeenCalledWith(A);
  });
});

describe('CrosswalkMatcherService.matchBatch — conflicts', () => {
  it('ids owned by two games: conflict row A/B, nothing else changes', async () => {
    const { store, service } = setup([owned(STEAM, A), owned(ITAD, B, 'itad')]);
    const it2 = item({
      itadUuid: UUID,
      provenance: { steamAppId: 'steam', itadUuid: 'itad' },
    });
    const [r] = await service.matchBatch(INSTANCE, [it2]);
    expect(r).toEqual({ clientRef: 'g1', result: 'conflict', rlGameId: A });
    expect(store.insertConflict).toHaveBeenCalledWith({
      ...ITAD,
      existingRlGameId: A,
      proposedRlGameId: B,
      instanceId: INSTANCE,
      payload: { clientRef: 'g1', ...ITAD, provenance: 'itad' },
    });
    expect(store.bumpSeq).not.toHaveBeenCalled();
  });

  it('an identical open conflict is not written twice (L7)', async () => {
    const { store, service } = setup([owned(STEAM, A), owned(ITAD, B, 'itad')]);
    store.openConflictExists.mockResolvedValue(true);
    const it2 = item({
      itadUuid: UUID,
      provenance: { steamAppId: 'steam', itadUuid: 'itad' },
    });
    const [r] = await service.matchBatch(INSTANCE, [it2]);
    expect(r?.result).toBe('conflict');
    expect(store.insertConflict).not.toHaveBeenCalled();
  });

  it('partial conflict: the new IGDB id still attaches to A (AC 6)', async () => {
    const { store, service } = setup([owned(STEAM, A), owned(ITAD, B, 'itad')]);
    const it2 = item({
      itadUuid: UUID,
      igdbId: 77,
      provenance: { steamAppId: 'steam', itadUuid: 'itad', igdbId: 'igdb' },
    });
    const [r] = await service.matchBatch(INSTANCE, [it2]);
    expect(r).toEqual({ clientRef: 'g1', result: 'conflict', rlGameId: A });
    expect(store.insertIds).toHaveBeenCalledWith(A, INSTANCE, [
      { kind: 'igdb_id', value: '77', provenance: 'igdb' },
    ]);
    expect(store.bumpSeq).toHaveBeenCalledWith(A);
  });
});

describe('CrosswalkMatcherService.matchBatch — provenance and names', () => {
  it('steam provenance raises a stored igdb one (D15)', async () => {
    const { store, service } = setup([owned(STEAM, A, 'igdb')]);
    const [r] = await service.matchBatch(INSTANCE, [item()]);
    expect(r?.result).toBe('attached');
    expect(store.raiseProvenance).toHaveBeenCalledWith({
      ...STEAM,
      provenance: 'steam',
    });
    expect(store.bumpSeq).toHaveBeenCalledWith(A);
  });

  it('igdb provenance never lowers a stored steam one', async () => {
    const { store, service } = setup([owned(STEAM, A, 'steam')]);
    const [r] = await service.matchBatch(INSTANCE, [
      item({ provenance: { steamAppId: 'igdb' } }),
    ]);
    expect(r?.result).toBe('matched');
    expect(store.raiseProvenance).not.toHaveBeenCalled();
  });

  it('step (c): an eligible same-name game gets every id attached', async () => {
    const { store, service } = setup([], B);
    const [r] = await service.matchBatch(INSTANCE, [item()]);
    expect(r).toEqual({ clientRef: 'g1', result: 'attached', rlGameId: B });
    expect(store.findNameCandidate).toHaveBeenCalledWith('resident evil', [
      'steam_app_id',
    ]);
    expect(store.insertGame).not.toHaveBeenCalled();
  });

  it('a name that normalizes to empty skips step (c)', async () => {
    const { store, service } = setup([], B);
    const [r] = await service.matchBatch(INSTANCE, [item({ name: '' })]);
    expect(r?.result).toBe('created');
    expect(store.findNameCandidate).not.toHaveBeenCalled();
  });

  it('keeps item order across a batch', async () => {
    const { service } = setup();
    const out = await service.matchBatch(INSTANCE, [
      item(),
      item({ clientRef: 'g2' }),
    ]);
    expect(out.map((r) => r.clientRef)).toEqual(['g1', 'g2']);
  });
});

describe('resolveResult (L8)', () => {
  const base = { rlGameId: A, created: false, changed: false, conflict: false };
  it.each([
    [{ conflict: true, changed: true }, 'conflict'],
    [{ changed: true, created: true }, 'attached'],
    [{ created: true }, 'created'],
    [{}, 'matched'],
  ] as const)('%o → %s', (over, expected) => {
    expect(resolveResult('c', { ...base, ...over }).result).toBe(expected);
  });
});
