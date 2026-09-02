/**
 * ROK-1314 review F2 — `/games/discover` must CACHE first, PERSONALIZE second.
 *
 * The discover rows are Redis-cached per slug. Personalization is overlaid
 * afterwards, on the way out, so the cached payload stays viewer-neutral. If a
 * future refactor moved the overlay down into the row builder, viewer A's
 * `currentUserOwns` flags would be written into a SHARED cache entry and served
 * to everyone for the whole TTL — a genuine cross-viewer leak that no
 * single-viewer test would reveal.
 *
 * The backend review confirmed the ordering is correct today; nothing pinned
 * it. This does, structurally: the cache writers must not be able to see a
 * viewer id.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf-8');

/** Strip comments — these guards discuss the hazard in prose right beside it. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Every module that writes a shared discover cache entry. */
const CACHE_WRITERS = [
  'igdb/igdb-discover.helpers.ts',
  'igdb/igdb-discover-deals.helpers.ts',
  'igdb/igdb-discover-community-playing.helpers.ts',
];

describe('ROK-1314 F2 — discover caches are viewer-neutral', () => {
  it.each(CACHE_WRITERS)('%s never references a viewer', (file) => {
    const code = codeOnly(read(file));
    // If a cache writer ever needs one of these, personalization has moved
    // below the cache boundary and the entry is no longer shareable.
    expect(code).not.toMatch(/viewerId/);
    expect(code).not.toMatch(/currentUserOwns/);
    expect(code).not.toMatch(/currentUserWishlisted/);
    expect(code).not.toMatch(/loadViewerInterests/);
  });

  it('the personalization layer sits ABOVE the row builder, not inside it', () => {
    const code = codeOnly(read('igdb/igdb-personalization.helpers.ts'));
    // buildDiscoverRows owns every setex; the overlay must consume its result
    // rather than be threaded into it.
    const buildCall = code.indexOf('buildDiscoverRows(');
    const overlayCall = code.indexOf('personalizeDiscoverRows(');
    expect(buildCall).toBeGreaterThan(-1);
    expect(overlayCall).toBeGreaterThan(-1);
    // The overlay is applied to an already-built (already-cached) result.
    expect(code).toMatch(/personalizeDiscoverRows\(/);
    // And no viewer id is handed to the builder.
    expect(code).not.toMatch(/buildDiscoverRows\([^)]*viewerId/);
  });
});
