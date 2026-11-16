/**
 * ROK-2223: dungeon quests that are escorts (or an NPC-defend event that
 * starts on accept). They cannot be shared with the party in Classic, so
 * every listed row must carry `sharable: false`. Reviewed against the whole
 * bundle (Classic + Forever) from our objectives and the Blizzard quest text.
 * ROK-2224 builds the planner / Quest Prep "escort" callout on this list.
 */
export interface EscortQuest {
  questId: number;
  name: string;
}

const e = (questId: number, name: string): EscortQuest => ({ questId, name });

/** Every escort quest in the bundled dungeon quest data. */
export const ESCORT_QUESTS: readonly EscortQuest[] = [
  // Objectives: "Escort Willix the Importer out of Razorfen Kraul."
  e(1144, 'Willix the Importer'),
  // Objectives: "Escort Kernobee to the Clockwerk Run exit"; text "Lead me to the exit".
  e(2904, 'A Fine Mess'),
  // Objectives: "Escort Belnistrasz to the Quilboar's idol ... Protect Belnistrasz".
  e(3525, 'Extinguishing the Idol'),
  // Objectives: "Defend Gor'shak."; the guards attack the moment it is accepted.
  e(3982, 'What Is Going On?'),
  // Objectives: "Escort your prisoner, Grark Lorkrub, through Burning Steppes".
  e(4121, 'Precarious Predicament'),
  // Text: "We need to get out of here ... Help me get my gear back" (Marshal Windsor follows you).
  e(4322, 'Jail Break!'),
  // Text: "Please follow me ... while I channel the energy" (Celebras's ritual walk).
  e(7046, 'The Scepter of Celebras'),
];

/** Quest ids of {@link ESCORT_QUESTS}, for lookups. */
export const ESCORT_QUEST_IDS: ReadonlySet<number> = new Set(
  ESCORT_QUESTS.map((entry) => entry.questId),
);
