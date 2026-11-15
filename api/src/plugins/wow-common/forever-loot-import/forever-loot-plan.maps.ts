/**
 * ROK-2170 / ROK-2210: lookup tables behind `forever-loot-plan.ts` — Wowhead
 * quality/slot/type labels and boss-source fixes for Forever loot captures.
 */
/** Wowhead quality number (the q0..q5 link class) → the quality name. */
export const QUALITY_NAMES: readonly string[] = [
  'Poor',
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
];

/**
 * A Wowhead source that is a listed boss under another name. Sneed climbs
 * out of Sneed's Shredder and the boss list has one row for the encounter.
 */
export const SOURCE_ALIASES: Readonly<Record<string, string>> = {
  Sneed: "Sneed's Shredder",
  // Spelling: Wowhead has a lower-case r, the bundled boss row does not.
  'Ghamoo-ra': 'Ghamoo-Ra',
  // Gyth is Rend's mount; the boss list has one row for the encounter.
  Gyth: 'Warchief Rend Blackhand',
};

/**
 * Drops filed under exactly one boss whatever their Wowhead source says,
 * keyed by the capture's zone id. Operator ruling 2026-11-11: Wowhead's
 * Forever page does not attribute these to the Avatar of Hakkar.
 */
export const ITEM_BOSS_OVERRIDES: Readonly<
  Record<number, Readonly<Record<number, string>>>
> = {
  1477: {
    10838: 'Avatar of Hakkar', // Might of Hakkar
    10844: 'Avatar of Hakkar', // Spire of Hakkar
    10845: 'Avatar of Hakkar', // Warrior's Embrace
    12462: 'Avatar of Hakkar', // Embrace of the Wind Serpent
  },
};

/** Wowhead slot label → the slot vocabulary the loot file already uses. */
export const SLOT_MAP: Readonly<Record<string, string | null>> = {
  Head: 'Head',
  Neck: 'Neck',
  Shoulder: 'Shoulder',
  Back: 'Back',
  Chest: 'Chest',
  Wrist: 'Wrist',
  Hands: 'Hands',
  Waist: 'Waist',
  Legs: 'Legs',
  Feet: 'Feet',
  Finger: 'Finger',
  Trinket: 'Trinket',
  'One-Hand': 'One-Hand',
  'Two-Hand': 'Two-Hand',
  'Main Hand': 'Main Hand',
  'Off Hand': 'Off Hand',
  'Held In Off-hand': 'Held In Off-hand',
  Shield: 'Shield',
  Ranged: 'Ranged',
  Thrown: 'Ranged',
  Relic: 'Relic',
  Ammo: null,
  Bag: null,
};

/** Wowhead type label → the itemSubclass vocabulary the loot file already uses. */
export const TYPE_MAP: Readonly<Record<string, string | null>> = {
  'Cloth Armor': 'Cloth',
  'Leather Armor': 'Leather',
  'Mail Armor': 'Mail',
  'Plate Armor': 'Plate',
  Cloak: 'Cloth',
  Ring: 'Miscellaneous',
  Amulet: 'Miscellaneous',
  Trinket: 'Miscellaneous',
  'Off-hand Frill': 'Miscellaneous',
  Shield: 'Shield',
  Dagger: 'Dagger',
  'Fist Weapon': 'Fist Weapon',
  Staff: 'Staff',
  Polearm: 'Polearm',
  'One-Handed Axe': 'Axe',
  'One-Handed Mace': 'Mace',
  'One-Handed Sword': 'Sword',
  'Two-Handed Axe': 'Axe',
  'Two-Handed Mace': 'Mace',
  'Two-Handed Sword': 'Sword',
  Bow: 'Bow',
  Gun: 'Gun',
  Crossbow: 'Crossbow',
  Wand: 'Wand',
  'Thrown Weapon': 'Thrown',
  Bag: 'Bag',
  Quest: 'Quest',
  'Blacksmithing Plans': 'Blacksmithing',
  'Engineering Schematic': 'Engineering',
  'Leatherworking Pattern': 'Leatherworking',
  'Tailoring Pattern': 'Tailoring',
  'Enchanting Formula': 'Enchanting',
  Book: 'Book',
  Arrow: 'Arrow',
  'Cooking Recipe': 'Cooking',
  'First Aid Book': 'First Aid',
  'Fishing Book': 'Fishing',
};
