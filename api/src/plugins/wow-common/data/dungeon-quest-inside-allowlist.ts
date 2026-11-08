/**
 * ROK-2142: the only dungeon quests whose `startsInsideDungeon` is true.
 *
 * The flag means "you can only pick this quest up inside the instance"
 * (an NPC, a dropped item or an object past the portal), so a group at the
 * entrance can count everything else before going in. The TyrsDev import
 * (ROK-245) had it true for every quest assigned to a dungeon, which is
 * wrong, so the seeder forces it from this list instead of trusting the JSON.
 *
 * Hand-checked against Wowhead Classic (2026-11-08). `verified: false` rows
 * are well-known in-instance starters whose Wowhead page did not show the
 * start location. Keep this small and correct rather than complete: a quest
 * missing here only shows in the "before you go in" list.
 */
export interface InsideQuest {
  questId: number;
  name: string;
  dungeon: string;
  verified: boolean;
}

const q = (
  questId: number,
  name: string,
  dungeon: string,
  verified = true,
): InsideQuest => ({ questId, name, dungeon, verified });

export const INSIDE_DUNGEON_QUESTS: readonly InsideQuest[] = [
  q(5724, 'Returning the Lost Satchel', 'Ragefire Chasm'),
  q(1200, 'Blackfathom Villainy', 'Blackfathom Deeps', false),
  q(6561, 'Blackfathom Villainy', 'Blackfathom Deeps', false),
  q(6564, 'Allegiance to the Old Gods', 'Blackfathom Deeps'),
  q(4295, "Rocknot's Ale", 'Blackrock Depths', false),
  q(3982, 'What Is Going On?', 'Blackrock Depths'),
  q(4001, 'What Is Going On?', 'Blackrock Depths'),
  q(4242, 'Abandoned Hope', 'Blackrock Depths'),
  q(4264, 'A Crumpled Up Note', 'Blackrock Depths'),
  q(4282, 'A Shred of Hope', 'Blackrock Depths'),
  q(4322, 'Jail Break!', 'Blackrock Depths'),
  q(4342, "Kharan's Tale", 'Blackrock Depths'),
  q(4361, 'The Bearer of Bad News', 'Blackrock Depths'),
  q(4201, 'The Love Potion', 'Blackrock Depths'),
  q(4083, 'The Spectral Chalice', 'Blackrock Depths'),
  q(4004, 'The Princess Saved?', 'Blackrock Depths'),
  q(4363, "The Princess's Surprise", 'Blackrock Depths'),
  q(4982, "Bijou's Belongings", 'Blackrock Spire'),
  q(5001, "Bijou's Belongings", 'Blackrock Spire'),
  q(4983, "Bijou's Reconnaissance Report", 'Blackrock Spire'),
  q(5002, 'Message to Maxwell', 'Blackrock Spire'),
  q(4742, 'Seal of Ascension', 'Blackrock Spire', false),
  q(4743, 'Seal of Ascension', 'Blackrock Spire', false),
  q(4867, 'Urok Doomhowl', 'Blackrock Spire'),
  q(5047, 'Finkle Einhorn, At Your Service!', 'Blackrock Spire'),
  q(5089, "General Drakkisath's Command", 'Blackrock Spire'),
  q(7461, 'The Madness Within', 'Dire Maul', false),
  q(7462, "The Treasure of the Shen'dralar", 'Dire Maul', false),
  q(7877, "The Treasure of the Shen'dralar", 'Dire Maul', false),
  q(7463, 'Arcane Refreshment', 'Dire Maul'),
  q(7508, "The Forging of Quel'Serrar", 'Dire Maul'),
  q(5518, 'The Gordok Ogre Suit', 'Dire Maul'),
  q(5519, 'The Gordok Ogre Suit', 'Dire Maul'),
  q(5525, 'Free Knot!', 'Dire Maul'),
  q(7429, 'Free Knot!', 'Dire Maul'),
  q(5528, 'The Gordok Taste Test', 'Dire Maul'),
  q(7703, 'Unfinished Gordok Business', 'Dire Maul'),
  q(1318, 'Unfinished Gordok Business', 'Dire Maul'),
  q(1193, 'A Broken Trap', 'Dire Maul'),
  q(8949, "Falrin's Vendetta", 'Dire Maul'),
  q(8950, "The Instigator's Enchantment", 'Dire Maul'),
  q(2904, 'A Fine Mess', 'Gnomeregan'),
  q(2945, 'Grime-Encrusted Ring', 'Gnomeregan'),
  q(2947, 'Return of the Ring', 'Gnomeregan'),
  q(2949, 'Return of the Ring', 'Gnomeregan'),
  q(2951, 'The Sparklematic 5200!', 'Gnomeregan'),
  q(2952, 'The Sparklematic 5200!', 'Gnomeregan'),
  q(4601, 'The Sparklematic 5200!', 'Gnomeregan'),
  q(4602, 'The Sparklematic 5200!', 'Gnomeregan'),
  q(4605, 'The Sparklematic 5200!', 'Gnomeregan'),
  q(4606, 'The Sparklematic 5200!', 'Gnomeregan'),
  q(2953, 'More Sparklematic Action', 'Gnomeregan'),
  q(4603, 'More Sparklematic Action', 'Gnomeregan'),
  q(4604, 'More Sparklematic Action', 'Gnomeregan'),
  q(7046, 'The Scepter of Celebras', 'Maraudon'),
  q(3523, 'Scourge of the Downs', 'Razorfen Downs'),
  q(3525, 'Extinguishing the Idol', 'Razorfen Downs'),
  q(1144, 'Willix the Importer', 'Razorfen Kraul'),
  q(5122, 'The Medallion of Faith', 'Stratholme', false),
  q(5125, "Aurius' Reckoning", 'Stratholme', false),
  q(5262, 'The Truth Comes Crashing Down', 'Stratholme'),
  q(2240, 'The Hidden Chamber', 'Uldaman'),
  q(2278, 'The Platinum Discs', 'Uldaman'),
  q(2279, 'The Platinum Discs', 'Uldaman'),
  q(2280, 'The Platinum Discs', 'Uldaman'),
];

export const INSIDE_DUNGEON_QUEST_IDS: ReadonlySet<number> = new Set(
  INSIDE_DUNGEON_QUESTS.map((entry) => entry.questId),
);
