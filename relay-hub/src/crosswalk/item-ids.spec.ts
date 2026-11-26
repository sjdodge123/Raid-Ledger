import {
  buildGameNameLockKeys,
  type CrosswalkContributionItem,
} from '@raid-ledger/contract';
import { idLockKey, itemIds, lockKeysFor } from './item-ids';

const UUID = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';

function item(
  over: Partial<CrosswalkContributionItem> = {},
): CrosswalkContributionItem {
  return {
    clientRef: '1',
    name: 'Resident Evil',
    steamAppId: 304240,
    igdbId: 991,
    itadUuid: UUID,
    provenance: { steamAppId: 'steam', igdbId: 'igdb', itadUuid: 'itad' },
    ...over,
  };
}

describe('itemIds (L4)', () => {
  it('maps every id sent to {kind, value, provenance}, steam first', () => {
    expect(itemIds(item())).toEqual([
      { kind: 'steam_app_id', value: '304240', provenance: 'steam' },
      { kind: 'igdb_id', value: '991', provenance: 'igdb' },
      { kind: 'itad_uuid', value: UUID.toLowerCase(), provenance: 'itad' },
    ]);
  });

  it('skips ids not sent', () => {
    const only = item({ steamAppId: undefined, itadUuid: undefined });
    expect(itemIds(only)).toEqual([
      { kind: 'igdb_id', value: '991', provenance: 'igdb' },
    ]);
  });

  it('stores a missing provenance as null', () => {
    const ids = itemIds(item({ provenance: {} }));
    expect(ids.map((i) => i.provenance)).toEqual([null, null, null]);
  });
});

describe('lockKeysFor (L1)', () => {
  it('locks the normalized name plus one key per id, sorted', () => {
    const keys = lockKeysFor(item());
    const expected = [
      ...buildGameNameLockKeys('Resident Evil'),
      'igdb_id:991',
      'itad_uuid:' + UUID.toLowerCase(),
      'steam_app_id:304240',
    ].sort();
    expect(keys).toEqual(expected);
    expect(keys).toEqual([...keys].sort());
  });

  it('is de-duplicated and skips a name that normalizes to empty', () => {
    const keys = lockKeysFor(item({ name: '', igdbId: undefined }));
    expect(keys).toEqual([
      'itad_uuid:' + UUID.toLowerCase(),
      'steam_app_id:304240',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('idLockKey joins kind and value', () => {
    expect(idLockKey({ kind: 'igdb_id', value: '7', provenance: null })).toBe(
      'igdb_id:7',
    );
  });
});
