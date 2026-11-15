/**
 * ROK-2210: the seven Classic raids (operator ruling Q6: list all seven for
 * Forever too). Ids from `data/boss-encounter-data.json`; Zul'Gurub reuses
 * journal id 76 (D8). Every 60-60 range is UNVERIFIED for Forever. Quest
 * areas for MC/BWL/AQ20/AQ40 are unknown ([]); no Wowhead zone ids yet.
 */
import { raid, type ClassicDef } from './catalogue-builders';

export const CLASSIC_RAID_DEFS: readonly ClassicDef[] = [
  raid([741, 'Molten Core', 'MC'], [60, 60, 40], [[], null]),
  raid([760, "Onyxia's Lair", 'Ony'], [60, 60, 40], [[2159], null]),
  raid([742, 'Blackwing Lair', 'BWL'], [60, 60, 40], [[], null]),
  raid([76, "Zul'Gurub", 'ZG'], [60, 60, 20], [[1977], null]),
  raid([743, "Ruins of Ahn'Qiraj", 'AQ20'], [60, 60, 20], [[], null]),
  raid([744, "Temple of Ahn'Qiraj", 'AQ40'], [60, 60, 40], [[], null]),
  raid([754, 'Naxxramas', 'Naxx'], [60, 60, 40], [[3456], null]),
];
