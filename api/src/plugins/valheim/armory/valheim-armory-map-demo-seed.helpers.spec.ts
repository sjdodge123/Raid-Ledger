/**
 * ROK-1837 L3 — the inlined map fixture equals the contract fixture file,
 * and the generated base map's quadrants/cross are where the seed says.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAP_FIXTURE_EXPLORED,
  MAP_FIXTURE_IDENTITY,
  MAP_FIXTURE_PINS,
  MAP_FIXTURE_PLACEHOLDER_SHA256,
  MAP_FIXTURE_SHARED_EXPLORED,
} from './valheim-armory-map-demo-fixture';
import { mapPixel } from './valheim-armory-map-demo-seed.helpers';

const FIXTURE = join(
  __dirname,
  '../../../../../packages/contract/valheim-link/v1/fixtures/map-shared-layer.json',
);

describe('map demo fixture (ROK-1837 L3)', () => {
  it('inlines map-shared-layer.json verbatim', () => {
    const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<
      string,
      unknown
    >;
    expect({
      character: MAP_FIXTURE_IDENTITY,
      explored: MAP_FIXTURE_EXPLORED,
      sharedExplored: MAP_FIXTURE_SHARED_EXPLORED,
      pins: MAP_FIXTURE_PINS,
      placeholder: MAP_FIXTURE_PLACEHOLDER_SHA256,
    }).toEqual({
      character: file.character,
      explored: file.explored,
      sharedExplored: file.sharedExplored,
      pins: file.pins,
      placeholder: (file.baseMap as { sha256: string }).sha256,
    });
  });

  it('paints four quadrants and a centre cross', () => {
    const corners = [
      mapPixel(0, 0),
      mapPixel(2047, 0),
      mapPixel(0, 2047),
      mapPixel(2047, 2047),
    ];
    expect(new Set(corners.map((c) => c.join())).size).toBe(4);
    expect(mapPixel(1024, 0)).toEqual([245, 245, 245]);
    expect(mapPixel(0, 1024)).toEqual([245, 245, 245]);
    expect(mapPixel(1100, 1100)).toEqual(corners[3]);
  });
});
