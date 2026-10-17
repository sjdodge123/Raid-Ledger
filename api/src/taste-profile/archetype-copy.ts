/**
 * Archetype server-side copy tables (ROK-1083).
 *
 * These strings are owned by the server and shipped to the UI via the
 * taste-profile response payload (see `ArchetypeSchema.descriptions` in
 * `@raid-ledger/contract`). Keeping copy server-side means text changes
 * don't force a contract rebuild + redeploy cascade, and the LLM context
 * builder reuses the same descriptions when constructing prompts.
 *
 * - `TIER_DESCRIPTIONS`: one short phrase per intensity tier.
 * - `VECTOR_TITLE_DESCRIPTIONS`: one phrase per vector title.
 * - `VECTOR_TITLE_AXES`: which pool axis (or axes, for multi-axis combo
 *   titles) feed each vector-title score. Multi-axis titles use the
 *   max of their components (see `archetype.helpers.ts`).
 */
import type {
  IntensityTier,
  TasteProfilePoolAxis,
  VectorTitle,
} from '@raid-ledger/contract';

/**
 * Short human-readable description per intensity tier. Shipped inside
 * `ArchetypeDto.descriptions.tier` so the UI (and LLM prompts) render
 * the same copy everywhere.
 */
export const TIER_DESCRIPTIONS: Record<IntensityTier, string> = {
  Hardcore: 'Plays nearly daily, many hours per week',
  Dedicated: 'Shows up several times a week',
  Regular: 'A few sessions a week',
  Casual: 'Drops in once or twice a week',
} as const;

/**
 * Short human-readable description per vector title. The order of
 * strings in `ArchetypeDto.descriptions.titles` mirrors the order of
 * entries in `ArchetypeDto.vectorTitles`.
 */
export const VECTOR_TITLE_DESCRIPTIONS: Record<VectorTitle, string> = {
  Duelist: 'Lives for PvP and one-on-one fights',
  Brawler: 'Thrives on fast-paced fighting games',
  'Last One Standing': 'Battle-royale devotee — last squad wins',
  Tactician: 'Reads the map, calls the shots in MOBAs',
  Marksman: 'Sharp aim and reflexes in shooters',
  Companion: 'Plays best shoulder-to-shoulder in co-op',
  Raider: 'MMO group content is home base',
  Socialite: 'Here for the people as much as the games',
  Hero: 'Drawn to story-driven RPGs and fantasy worlds',
  Spacefarer: 'Explores science-fiction frontiers',
  Wayfarer: 'Chases adventure and discovery',
  Architect: 'Builds, automates, and shapes sandboxes',
  Strategist: 'Out-thinks opponents in strategy titles',
  Survivor: 'Scrapes by in survival games and lives to tell it',
  Nightcrawler: 'Drawn to horror and the uncanny',
  'Risk Taker': 'Rolls the dice on roguelike runs',
  Operative: 'Moves in the shadows — stealth specialist',
  Puzzler: 'Loves unraveling puzzles',
  Acrobat: 'Leaps and lands platformer challenges',
  Racer: 'Lives for speed and the perfect racing line',
  Athlete: 'Competes on the virtual field in sports titles',
} as const;

/**
 * Vector-title → axis(es) mapping. Single-axis titles score on the raw
 * axis value; multi-axis titles score via `max(...component axes)`
 * (per ROK-1083 locked decision — see `archetype.helpers.ts` doc).
 *
 * Axis order inside each tuple matters for tie-break: the FIRST axis in
 * the tuple is the title's "primary" axis, and primary-axis position
 * inside `TASTE_PROFILE_AXIS_POOL` is the secondary sort key when
 * titles share a score.
 */
export const VECTOR_TITLE_AXES: Record<
  VectorTitle,
  readonly TasteProfilePoolAxis[]
> = {
  Duelist: ['pvp'],
  Brawler: ['fighting'],
  'Last One Standing': ['battle_royale'],
  Tactician: ['moba'],
  Marksman: ['shooter'],
  Companion: ['co_op'],
  Raider: ['mmo'],
  Socialite: ['social'],
  Hero: ['rpg', 'fantasy'],
  Spacefarer: ['sci_fi'],
  Wayfarer: ['adventure'],
  Architect: ['crafting', 'automation', 'sandbox'],
  Strategist: ['strategy'],
  Survivor: ['survival'],
  Nightcrawler: ['horror'],
  'Risk Taker': ['roguelike'],
  Operative: ['stealth'],
  Puzzler: ['puzzle'],
  Acrobat: ['platformer'],
  Racer: ['racing'],
  Athlete: ['sports'],
} as const;
