/**
 * ROK-2142: classic bosses added when the retail-journal boss lists were
 * replaced with the 1.12 lists. A name here means the boss has NO loot rows
 * of any kind yet (neither `classic` nor `forever`). ROK-2170 fills them with
 * Forever rows (`expansion: 'forever'`), dungeon by dungeon. The loot specs
 * exempt exactly these names and fail once one of them gains loot of either
 * kind, so this list only ever shrinks.
 */
export const LOOT_PENDING_CLASSIC_BOSSES: ReadonlySet<string> = new Set([
  'Doctor Theolen Krastinov',
  'Instructor Malicia',
  'Lady Illucia Barov',
  'Lord Alexei Barov',
  'Lorekeeper Polkelt',
  'Marduk Blackpool',
  'The Ravenian',
  'Vectus',
]);
