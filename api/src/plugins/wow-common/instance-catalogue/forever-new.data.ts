/**
 * ROK-2210 (was ROK-1719 `forever-instance-data.ts`): the Forever-new
 * instances — 9 dungeons, 2 raids. Ids are fixed per name and never reused.
 * Names: Blizzard "What's Next" recap; "The Hall of Thanes" / "The Shaper's
 * Terrace" use Blizzard's spelling (operator ruling Q4, new events only —
 * saved events keep their snapshot). Levels are community-sourced.
 * Wowhead zone ids 1-4 verified 2026-10-09; 5-11 are AreaTable candidates
 * (operator ruling Q5: ship them).
 */
import { foreverNew } from './catalogue-builders';
import type { CatalogueInstance } from './instance-catalogue.types';

/** Reserved id range — clear of journal ids and synthetic wing ids. */
export const FOREVER_SEED_ID_BASE = 90_000_000;

const B = FOREVER_SEED_ID_BASE;

export const FOREVER_NEW_ROWS: readonly CatalogueInstance[] = [
  foreverNew(
    [B + 1, 'The Hall of Thanes', 'HoT'],
    'dungeon',
    [13, 18, 5],
    [[16919], 16919],
  ),
  foreverNew(
    [B + 2, 'Ruins of Lordaeron', 'RoL'],
    'dungeon',
    [15, 20, 5],
    [[16611], 16611],
  ),
  foreverNew(
    [B + 3, 'Excavation Site: Wetlands', 'Excavation'],
    'dungeon',
    [24, 29, 5],
    [[16732], 16732],
  ),
  foreverNew(
    [B + 4, 'City of Dalaran', 'Dalaran'],
    'dungeon',
    [28, 33, 5],
    [[16544, 16560], 16544],
  ),
  foreverNew(
    [B + 5, 'The Drowned City', 'Drowned'],
    'dungeon',
    [35, 40, 5],
    [[16550], 16550],
  ),
  foreverNew(
    [B + 6, "Krol'dok Stronghold", "Krol'dok"],
    'dungeon',
    [40, 45, 5],
    [[16842], 16842],
  ),
  foreverNew(
    [B + 7, 'Alcaz Prison', 'Alcaz'],
    'dungeon',
    [48, 53, 5],
    [[16620], 16620],
  ),
  foreverNew(
    [B + 8, 'Blackmaw Hold', 'Blackmaw'],
    'dungeon',
    [55, 60, 5],
    [[16554], 16554],
  ),
  foreverNew(
    [B + 9, "The Shaper's Terrace", "Shaper's"],
    'dungeon',
    [58, 60, 5],
    [[16985], 16985],
  ),
  foreverNew(
    [B + 10, 'Barrow Deeps', 'BD'],
    'raid',
    [60, 60, 10],
    [[16871], 16871],
  ),
  // Not 'Hyjal' — that short name belongs to the TBC raid of the same name.
  foreverNew(
    [B + 11, 'Hyjal Summit', 'HS'],
    'raid',
    [60, 60, 20],
    [[16597], 16597],
  ),
];
