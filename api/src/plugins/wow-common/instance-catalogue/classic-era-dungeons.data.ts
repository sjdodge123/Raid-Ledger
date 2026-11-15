/**
 * ROK-2210: Classic dungeons, in today's journal order (wings in place of
 * their parent). Names keep the journal spelling (snapshot continuity).
 * Levels from the old `CLASSIC_INSTANCE_LEVELS` / `CLASSIC_SUB_INSTANCES`;
 * UNVERIFIED for Forever. `areas` = Forever quest-area ids; `zone` = Wowhead
 * zone id (candidates shipped per operator ruling Q5, 2026-11-15).
 */
import { dungeon, type ClassicDef } from './catalogue-builders';

export const CLASSIC_DUNGEON_DEFS: readonly ClassicDef[] = [
  dungeon([226, 'Ragefire Chasm', 'RFC'], [13, 18, 5], [[2437], 2437]),
  dungeon([240, 'Wailing Caverns', 'WC'], [17, 24, 5], [[718], 718]),
  dungeon([63, 'Deadmines', 'DM'], [17, 26, 5], [[1581], 1581]),
  dungeon([64, 'Shadowfang Keep', 'SFK'], [22, 30, 5], [[209, 236], 209]),
  dungeon([238, 'The Stockade', 'Stocks'], [22, 30, 5], [[717], 717]),
  dungeon([227, 'Blackfathom Deeps', 'BFD'], [24, 32, 5], [[719], 719]),
  dungeon([231, 'Gnomeregan', 'Gnomer'], [29, 38, 5], [[721, 133], 721]),
  // Wowhead zone 491 ≠ quest area 1717 (import-forever-boss-loot.mjs).
  dungeon([234, 'Razorfen Kraul', 'RFK'], [30, 40, 5], [[1717], 491]),
  dungeon([316, 'Scarlet Monastery', 'SM'], [26, 40, 5], [[796], 796], {
    unlisted: true,
  }),
  dungeon([31601, 'SM: Graveyard', 'SM:GY'], [26, 32, 5], [[796], 796], {
    parent: 316,
  }),
  dungeon([31602, 'SM: Library', 'SM:Lib'], [29, 33, 5], [[796], 796], {
    parent: 316,
  }),
  dungeon([31603, 'SM: Armory', 'SM:Arm'], [32, 36, 5], [[796], 796], {
    parent: 316,
  }),
  dungeon([31604, 'SM: Cathedral', 'SM:Cath'], [34, 40, 5], [[796], 796], {
    parent: 316,
  }),
  // Era guides say ~33-43; the old table's 40-50 looks shifted (UNVERIFIED).
  dungeon([233, 'Razorfen Downs', 'RFD'], [40, 50, 5], [[722], 722]),
  dungeon([239, 'Uldaman', 'Ulda'], [42, 52, 5], [[1517], 1337]),
  dungeon([241, "Zul'Farrak", 'ZF'], [44, 54, 5], [[1176], 1176]),
  dungeon([232, 'Maraudon', 'Mara'], [40, 55, 5], [[2100], 2100], {
    unlisted: true,
  }),
  dungeon([23201, 'Maraudon: Purple', 'Mara:P'], [40, 49, 5], [[2100], 2100], {
    parent: 232,
  }),
  dungeon([23202, 'Maraudon: Orange', 'Mara:O'], [40, 49, 5], [[2100], 2100], {
    parent: 232,
  }),
  dungeon(
    [23203, 'Maraudon: Pristine Waters', 'Mara:PW'],
    [46, 55, 5],
    [[2100], 2100],
    { parent: 232 },
  ),
  dungeon(
    [237, "The Temple of Atal'hakkar", 'ST'],
    [50, 56, 5],
    [[1477, 1417], 1477],
  ),
  dungeon([228, 'Blackrock Depths', 'BRD'], [52, 60, 5], [[1584], 1584]),
  dungeon([229, 'Lower Blackrock Spire', 'LBRS'], [55, 60, 5], [[1583], 1583], {
    questName: 'Blackrock Spire',
  }),
  // ROK-2210 Q2: UBRS as a wing of 229 (10 players, 55-60 UNVERIFIED).
  dungeon(
    [22901, 'Upper Blackrock Spire', 'UBRS'],
    [55, 60, 10],
    [[1583], 1583],
    { parent: 229 },
  ),
  dungeon(
    [230, 'Dire Maul - Capital Gardens', 'DM:W'],
    [55, 60, 5],
    [[2557], 2557],
    { questName: 'Dire Maul' },
  ),
  dungeon(
    [1276, 'Dire Maul - Warpwood Quarter', 'DM:E'],
    [55, 60, 5],
    [[2557], 2557],
    { parent: 230 },
  ),
  dungeon(
    [1277, 'Dire Maul - Gordok Commons', 'DM:N'],
    [55, 60, 5],
    [[2557], 2557],
    { parent: 230 },
  ),
  dungeon(
    [236, 'Stratholme - Main Gate', 'Strat:Live'],
    [58, 60, 5],
    [[2017], 2017],
    { questName: 'Stratholme' },
  ),
  dungeon(
    [1292, 'Stratholme - Service Entrance', 'Strat:UD'],
    [58, 60, 5],
    [[2017], 2017],
    { parent: 236 },
  ),
  dungeon([246, 'Scholomance', 'Scholo'], [58, 60, 5], [[2057], 2057]),
];
