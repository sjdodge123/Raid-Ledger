/**
 * ROK-2142: classic bosses added when the retail-journal boss lists were
 * replaced with the 1.12 lists. A name here means the boss has NO loot rows
 * of any kind yet (neither `classic` nor `forever`). ROK-2170 fills them with
 * Forever rows (`expansion: 'forever'`), dungeon by dungeon. The loot specs
 * exempt exactly these names and fail once one of them gains loot of either
 * kind, so this list only ever shrinks.
 */
export const LOOT_PENDING_CLASSIC_BOSSES: ReadonlySet<string> = new Set([
  'Agathelos the Raging',
  'Aggem Thorncurse',
  "Atal'alarion",
  'Darkmaster Gandling',
  'Death Speaker Jargba',
  'Doctor Theolen Krastinov',
  'Gizrul the Slavener',
  'Glutton',
  'Halycon',
  'Highlord Omokk',
  'Instructor Malicia',
  'Jandice Barov',
  'Kirtonos the Herald',
  'Lady Illucia Barov',
  'Lord Alexei Barov',
  'Lorekeeper Polkelt',
  'Marduk Blackpool',
  'Mother Smolderweb',
  'Ogom the Wretched',
  'Overlord Ramtusk',
  'Overlord Wyrmthalak',
  'Plaguemaw the Rotting',
  'Pyroguard Emberseer',
  'Quartermaster Zigris',
  'Ras Frostwhisper',
  'Rattlegore',
  "Shadow Hunter Vosh'gajin",
  'Solakar Flamewreath',
  'Spawn of Hakkar',
  'The Beast',
  'The Ravenian',
  "Tuten'kash",
  'Urok Doomhowl',
  'Vectus',
  'War Master Voone',
  'Warchief Rend Blackhand',
]);
