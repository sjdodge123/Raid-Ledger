/**
 * Seed-time helpers for `seed-testing.ts`.
 *
 * Extracted into its own module so the helpers can be unit-tested without
 * triggering the script's top-level `bootstrap()` (which connects to Postgres).
 * Mirrors the contract `CharacterProfessionsDto` shape from
 * `packages/contract/src/characters.schema.ts`.
 */

interface ProfessionTier {
  id: number;
  name: string;
  skillLevel: number;
  maxSkillLevel: number;
}

interface ProfessionEntry {
  id: number;
  name: string;
  slug: string;
  skillLevel: number;
  maxSkillLevel: number;
  tiers: ProfessionTier[];
}

interface CharacterProfessions {
  primary: ProfessionEntry[];
  secondary: ProfessionEntry[];
  syncedAt: string;
}

type ProfessionRow = readonly [
  name: string,
  skillLevel: number,
  maxSkillLevel: number,
  retailTier: string | null,
  retailTierMax: number | null,
];

type ClassProfessionMap = Record<
  string,
  { primary: readonly ProfessionRow[]; secondary: readonly ProfessionRow[] }
>;

// Per-class realistic profession assignments (Wrath-era cap of 450 for primaries,
// Cataclysm Cooking 200 cap for secondaries). Retail tier name reflects an
// expansion-era tier so the panel renders nested tier rows.
const CLASS_PROFESSIONS: ClassProfessionMap = {
  Mage: {
    primary: [
      ['Tailoring', 450, 450, 'Dragon Isles Tailoring', 100],
      ['Enchanting', 425, 450, 'Dragon Isles Enchanting', 100],
    ],
    secondary: [['Cooking', 150, 150, null, null]],
  },
  Warrior: {
    primary: [
      ['Mining', 450, 450, 'Dragon Isles Mining', 100],
      ['Blacksmithing', 440, 450, 'Dragon Isles Blacksmithing', 100],
    ],
    secondary: [['Fishing', 100, 150, null, null]],
  },
  Priest: {
    primary: [
      ['Tailoring', 450, 450, 'Dragon Isles Tailoring', 100],
      ['Enchanting', 450, 450, 'Dragon Isles Enchanting', 100],
    ],
    secondary: [['Cooking', 200, 200, null, null]],
  },
  Rogue: {
    primary: [
      ['Skinning', 450, 450, 'Dragon Isles Skinning', 100],
      ['Leatherworking', 430, 450, 'Dragon Isles Leatherworking', 100],
    ],
    secondary: [['Cooking', 175, 200, null, null]],
  },
  Druid: {
    primary: [
      ['Herbalism', 450, 450, 'Dragon Isles Herbalism', 100],
      ['Alchemy', 425, 450, 'Dragon Isles Alchemy', 100],
    ],
    secondary: [['Cooking', 150, 200, null, null]],
  },
  Paladin: {
    primary: [
      ['Mining', 450, 450, 'Dragon Isles Mining', 100],
      ['Blacksmithing', 425, 450, 'Dragon Isles Blacksmithing', 100],
    ],
    secondary: [['Fishing', 100, 150, null, null]],
  },
  'Death Knight': {
    primary: [
      ['Mining', 450, 450, 'Dragon Isles Mining', 100],
      ['Engineering', 425, 450, 'Dragon Isles Engineering', 100],
    ],
    secondary: [['Cooking', 150, 200, null, null]],
  },
  Warlock: {
    primary: [
      ['Tailoring', 450, 450, 'Dragon Isles Tailoring', 100],
      ['Enchanting', 425, 450, 'Dragon Isles Enchanting', 100],
    ],
    secondary: [['Cooking', 100, 200, null, null]],
  },
};

const RETAIL_GAME_SLUG = 'world-of-warcraft';
const CLASSIC_GAME_SLUG = 'world-of-warcraft-classic';

/** Stable synthetic id derived from string — enough for seed determinism. */
function hashId(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

function buildEntry(
  row: ProfessionRow,
  includeRetailTier: boolean,
): ProfessionEntry {
  const [name, skillLevel, maxSkillLevel, tierName, tierMax] = row;
  const slug = slugify(name);
  const tiers: ProfessionTier[] =
    includeRetailTier && tierName && tierMax !== null
      ? [
          {
            id: hashId(`${slug}:${tierName}`),
            name: tierName,
            skillLevel: tierMax,
            maxSkillLevel: tierMax,
          },
        ]
      : [];
  return {
    id: hashId(slug),
    name,
    slug,
    skillLevel,
    maxSkillLevel,
    tiers,
  };
}

/**
 * Build a `CharacterProfessions` blob for a seed character.
 * Returns `null` for non-WoW games (Valheim, FFXIV, etc.).
 *
 * Retail (`world-of-warcraft`): each primary gets one nested tier row.
 * Classic (`world-of-warcraft-classic`): tiers are empty arrays.
 */
export function buildSeedProfessions(
  charClass: string,
  gameSlug: string,
): CharacterProfessions | null {
  if (gameSlug !== RETAIL_GAME_SLUG && gameSlug !== CLASSIC_GAME_SLUG) {
    return null;
  }
  const map = CLASS_PROFESSIONS[charClass];
  if (!map) return null;
  const includeRetailTier = gameSlug === RETAIL_GAME_SLUG;
  return {
    primary: map.primary.map((row) => buildEntry(row, includeRetailTier)),
    secondary: map.secondary.map((row) => buildEntry(row, includeRetailTier)),
    syncedAt: new Date().toISOString(),
  };
}
