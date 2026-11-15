/**
 * ROK-2210 (was ROK-1719 `forever-instance-data.ts`): the Forever-new
 * instances — 9 dungeons, 2 raids. Ids are fixed per name and never reused.
 * Names: Blizzard "What's Next" recap; "The Hall of Thanes" / "The Shaper's
 * Terrace" use Blizzard's spelling (operator ruling Q4, new events only —
 * saved events keep their snapshot). Dungeon levels are the in-game finder
 * spans (`GroupFinderActivity`, wowf build 1.60.1.70938 — see
 * `forever-levels.data.ts`; GFA id per row). Barrow Deeps and Hyjal Summit
 * are not in the client data yet (they open 2026-12-09): community levels.
 * Wowhead zone ids 1-4 verified 2026-10-09; 5-11 are AreaTable candidates
 * (operator ruling Q5: ship them).
 */
import { foreverNew } from './catalogue-builders';
import type { CatalogueInstance } from './instance-catalogue.types';

/** Reserved id range — clear of journal ids and synthetic wing ids. */
export const FOREVER_SEED_ID_BASE = 90_000_000;

/** Width of the reserved Forever seed id range above the base. */
export const FOREVER_SEED_ID_SPAN = 999;

const B = FOREVER_SEED_ID_BASE;

export const FOREVER_NEW_ROWS: readonly CatalogueInstance[] = [
  foreverNew(
    [B + 1, 'The Hall of Thanes', 'HoT'],
    'dungeon',
    [13, 20, 5], // GFA #1984 Hall of Thanes
    [[16919], 16919],
    'in_game',
  ),
  foreverNew(
    [B + 2, 'Ruins of Lordaeron', 'RoL'],
    'dungeon',
    [15, 22, 5], // GFA #1982
    [[16611], 16611],
    'in_game',
  ),
  foreverNew(
    [B + 3, 'Excavation Site: Wetlands', 'Excavation'],
    'dungeon',
    [26, 33, 5], // GFA #1981
    [[16732], 16732],
    'in_game',
  ),
  foreverNew(
    [B + 4, 'City of Dalaran', 'Dalaran'],
    'dungeon',
    [28, 35, 5], // GFA #1983
    [[16544, 16560], 16544],
    'in_game',
  ),
  foreverNew(
    [B + 5, 'The Drowned City', 'Drowned'],
    'dungeon',
    [35, 42, 5], // GFA #1985
    [[16550], 16550],
    'in_game',
  ),
  foreverNew(
    [B + 6, "Krol'dok Stronghold", "Krol'dok"],
    'dungeon',
    [40, 47, 5], // GFA #1986
    [[16842], 16842],
    'in_game',
  ),
  foreverNew(
    [B + 7, 'Alcaz Prison', 'Alcaz'],
    'dungeon',
    [48, 55, 5], // GFA #1980
    [[16620], 16620],
    'in_game',
  ),
  foreverNew(
    [B + 8, 'Blackmaw Hold', 'Blackmaw'],
    'dungeon',
    [55, 60, 5], // GFA #1979
    [[16554], 16554],
    'in_game',
  ),
  foreverNew(
    [B + 9, "The Shaper's Terrace", "Shaper's"],
    'dungeon',
    [58, 60, 5], // GFA #1978
    [[16985], 16985],
    'in_game',
  ),
  foreverNew(
    [B + 10, 'Barrow Deeps', 'BD'],
    'raid',
    [60, 60, 10],
    [[16871], 16871],
    'community',
  ),
  // Not 'Hyjal' — that short name belongs to the TBC raid of the same name.
  foreverNew(
    [B + 11, 'Hyjal Summit', 'HS'],
    'raid',
    [60, 60, 20],
    [[16597], 16597],
    'community',
  ),
];
