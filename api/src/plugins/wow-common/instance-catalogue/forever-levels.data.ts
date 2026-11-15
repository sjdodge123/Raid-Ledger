/**
 * ROK-2210: the WoW: Forever dungeon-finder level spans for the Forever
 * editions of Classic instances, keyed by catalogue id. `classic_era` rows
 * keep their Classic levels; `foreverEdition` applies these as `in_game`.
 *
 * Source: the Forever client's `GroupFinderActivity` DB2 table
 * (`MinLevel`, `MaxLevelSuggestion`), wago.tools product `wowf`, build
 * 1.60.1.70938 (2026-11-13) —
 * https://wago.tools/db2/GroupFinderActivity/csv?build=1.60.1.70938
 * Matches the operator's in-game finder screenshot on six rows. Trailing
 * comments give the GFA id (and the finder FullName where it differs).
 * Refresh by re-pulling that CSV for the newest `wowf` build.
 */
import type { LevelSpan } from './catalogue-builders';

export const FOREVER_FINDER_LEVELS: ReadonlyMap<number, LevelSpan> = new Map<
  number,
  LevelSpan
>([
  [226, [13, 18]], // #798
  [240, [15, 24]], // #796
  [63, [17, 26]], // #799
  [64, [20, 30]], // #800
  [238, [24, 32]], // #802 Stormwind Stockades
  [227, [24, 32]], // #801
  [231, [29, 38]], // #803
  [234, [29, 38]], // #804
  // No whole-SM finder entry: the unlisted parent spans its four wings.
  [316, [30, 46]],
  [31601, [30, 38]], // #805 Scarlet Monastery - Graveyard
  [31602, [33, 41]], // #829 Scarlet Monastery - Library
  [31603, [36, 44]], // #827 Scarlet Monastery - Armory
  [31604, [38, 46]], // #828 Scarlet Monastery - Cathedral
  [233, [37, 46]], // #806
  [239, [41, 51]], // #807
  [241, [44, 54]], // #808
  // #809: one Maraudon entry, no wings — the parent and all three wings.
  [232, [46, 55]],
  [23201, [46, 55]],
  [23202, [46, 55]],
  [23203, [46, 55]],
  [237, [50, 60]], // #810 Sunken Temple
  [228, [52, 60]], // #811
  [229, [55, 60]], // #812
  [22901, [59, 60]], // #837
  [230, [56, 60]], // #814 Dire Maul (West)
  [1276, [54, 60]], // #813 Dire Maul (East)
  [1277, [56, 60]], // #815 Dire Maul (North)
  [236, [58, 60]], // #816 Stratholme (Main Gate)
  [1292, [58, 60]], // #1603 Stratholme (Service Gate)
  [246, [58, 60]], // #797
  [741, [60, 60]], // #839
  [760, [60, 60]], // #838
  [742, [60, 60]], // #840
  [76, [60, 60]], // #836
  [743, [60, 60]], // #842 Ahn'Qiraj Ruins
  [744, [60, 60]], // #843 Ahn'Qiraj Temple
  [754, [60, 60]], // #841
]);
