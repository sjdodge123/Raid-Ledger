/**
 * ROK-2120 review r1: the insert guard must treat rows it has already kept in
 * the same batch as key owners, or two NEW rows sharing a steam_app_id / slug
 * both reach the batch INSERT and violate the unique index (rolling back the
 * whole batch).
 */
import { mapApiGameToDbRow } from './igdb.mappers';
import {
  guardInsertRows,
  recordOwner,
  type KeyOwners,
} from './igdb-upsert-collisions.helpers';
import { SEED_OWNED_GAME_SLUGS } from '../games-lookup/seed-owned-games.helpers';
import { at } from '../common/testing/narrow';

jest.mock('./games-key-owner.helpers', () => ({
  reportDuplicatePair: jest.fn(),
}));

/** Empty owner map (no DB row holds any incoming key). */
function noOwners(): KeyOwners {
  return { igdb: new Map(), slug: new Map(), steam: new Map() };
}

/** A mapped IGDB row with the given keys. */
function row(igdbId: number, slug: string, steamAppId: number | null) {
  return {
    ...mapApiGameToDbRow({ id: igdbId, name: slug, slug }),
    steamAppId,
  };
}

describe('guardInsertRows — in-batch key claims', () => {
  it('strips the steam id from the second NEW row claiming it in one batch', () => {
    const kept = guardInsertRows(
      [row(501, 'edition-a', 777), row(502, 'edition-b', 777)],
      noOwners(),
    );
    expect(kept.map((r) => [r.igdbId, r.steamAppId])).toEqual([
      [501, 777],
      [502, null],
    ]);
  });

  it('drops the second NEW row claiming a slug already kept in the batch', () => {
    const kept = guardInsertRows(
      [row(601, 'same-slug', null), row(602, 'same-slug', null)],
      noOwners(),
    );
    expect(kept.map((r) => r.igdbId)).toEqual([601]);
  });

  it('keeps an upsert onto its own igdb owner (owner already holds the keys)', () => {
    const owners = noOwners();
    owners.igdb.set(701, 9);
    owners.slug.set('owned', 9);
    owners.steam.set(888, 9);
    const kept = guardInsertRows([row(701, 'owned', 888)], owners);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.steamAppId).toBe(888);
  });
});

describe('recordOwner — replaced keys are released (ROK-2120 r3)', () => {
  it('moves a merged row from its old slug to the new one', () => {
    const owners = noOwners();
    owners.slug.set('old-slug', 77);
    recordOwner(owners, 77, {
      igdbId: 200,
      slug: 'new-slug',
      steamAppId: null,
    });
    expect([...owners.slug]).toEqual([['new-slug', 77]]);
  });

  it('keeps a seed-owned slug (the SET clause never overwrites it)', () => {
    const seed = at(SEED_OWNED_GAME_SLUGS, 0);
    const owners = noOwners();
    owners.slug.set(seed, 9);
    recordOwner(owners, 9, { igdbId: 1, slug: 'incoming', steamAppId: null });
    expect([...owners.slug]).toEqual([[seed, 9]]);
  });
});
