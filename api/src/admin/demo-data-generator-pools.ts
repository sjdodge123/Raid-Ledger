/**
 * Data pools and constants for demo data generation.
 */
import type { Rng } from './demo-data-rng';

// ─── Username pools ─────────────────────────────────────────────────────────

export const USERNAME_PREFIXES = [
  'Shadow',
  'Dark',
  'Storm',
  'Ice',
  'Fire',
  'Crystal',
  'Iron',
  'Steel',
  'Moon',
  'Sun',
  'Blood',
  'Void',
  'Nether',
  'Frost',
  'Thunder',
  'Doom',
  'Star',
  'Wolf',
  'Raven',
  'Ghost',
  'Night',
  'Chaos',
  'Arcane',
  'Nova',
  'Blaze',
  'Ash',
  'Venom',
  'Hex',
  'Crimson',
  'Azure',
] as const;

export const USERNAME_SUFFIXES = [
  'Blade',
  'Fury',
  'Strike',
  'Fang',
  'Claw',
  'Bane',
  'Heart',
  'Soul',
  'Wind',
  'Storm',
  'Hawk',
  'Wolf',
  'Mage',
  'Knight',
  'Hunter',
  'Slayer',
  'Walker',
  'Caller',
  'Weaver',
  'Singer',
  'Guard',
  'Reaper',
  'Breaker',
  'Dancer',
  'Seeker',
  'Warden',
  'Keeper',
  'Rider',
  'Sage',
  'Forge',
] as const;

const AVATAR_CHARS = '0123456789abcdef';

/** Generate a random hex avatar string. */
export function generateAvatar(rng: Rng): string {
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += AVATAR_CHARS[Math.floor(rng() * AVATAR_CHARS.length)];
  }
  return result;
}

// ─── WoW Classes ─────────────────────────────────────────────────────────────

export interface WowClassDef {
  class: string;
  specs: { name: string; role: 'tank' | 'healer' | 'dps' }[];
  wowClass: string;
}

export const WOW_CLASSES: WowClassDef[] = [
  {
    class: 'Warrior',
    specs: [
      { name: 'Arms', role: 'dps' },
      { name: 'Fury', role: 'dps' },
      { name: 'Protection', role: 'tank' },
    ],
    wowClass: 'warrior',
  },
  {
    class: 'Paladin',
    specs: [
      { name: 'Holy', role: 'healer' },
      { name: 'Protection', role: 'tank' },
      { name: 'Retribution', role: 'dps' },
    ],
    wowClass: 'paladin',
  },
  {
    class: 'Hunter',
    specs: [
      { name: 'Beast Mastery', role: 'dps' },
      { name: 'Marksmanship', role: 'dps' },
      { name: 'Survival', role: 'dps' },
    ],
    wowClass: 'hunter',
  },
  {
    class: 'Rogue',
    specs: [
      { name: 'Assassination', role: 'dps' },
      { name: 'Outlaw', role: 'dps' },
      { name: 'Subtlety', role: 'dps' },
    ],
    wowClass: 'rogue',
  },
  {
    class: 'Priest',
    specs: [
      { name: 'Discipline', role: 'healer' },
      { name: 'Holy', role: 'healer' },
      { name: 'Shadow', role: 'dps' },
    ],
    wowClass: 'priest',
  },
  {
    class: 'Shaman',
    specs: [
      { name: 'Elemental', role: 'dps' },
      { name: 'Enhancement', role: 'dps' },
      { name: 'Restoration', role: 'healer' },
    ],
    wowClass: 'shaman',
  },
  {
    class: 'Mage',
    specs: [
      { name: 'Arcane', role: 'dps' },
      { name: 'Fire', role: 'dps' },
      { name: 'Frost', role: 'dps' },
    ],
    wowClass: 'mage',
  },
  {
    class: 'Warlock',
    specs: [
      { name: 'Affliction', role: 'dps' },
      { name: 'Demonology', role: 'dps' },
      { name: 'Destruction', role: 'dps' },
    ],
    wowClass: 'warlock',
  },
  {
    class: 'Monk',
    specs: [
      { name: 'Brewmaster', role: 'tank' },
      { name: 'Mistweaver', role: 'healer' },
      { name: 'Windwalker', role: 'dps' },
    ],
    wowClass: 'monk',
  },
  {
    class: 'Druid',
    specs: [
      { name: 'Balance', role: 'dps' },
      { name: 'Feral', role: 'dps' },
      { name: 'Guardian', role: 'tank' },
      { name: 'Restoration', role: 'healer' },
    ],
    wowClass: 'druid',
  },
  {
    class: 'Demon Hunter',
    specs: [
      { name: 'Havoc', role: 'dps' },
      { name: 'Vengeance', role: 'tank' },
    ],
    wowClass: 'demonhunter',
  },
  {
    class: 'Death Knight',
    specs: [
      { name: 'Blood', role: 'tank' },
      { name: 'Frost', role: 'dps' },
      { name: 'Unholy', role: 'dps' },
    ],
    wowClass: 'deathknight',
  },
  {
    class: 'Evoker',
    specs: [
      { name: 'Devastation', role: 'dps' },
      { name: 'Preservation', role: 'healer' },
      { name: 'Augmentation', role: 'dps' },
    ],
    wowClass: 'evoker',
  },
];

// ─── FFXIV Jobs ──────────────────────────────────────────────────────────────

export interface FfxivJobDef {
  class: string;
  role: 'tank' | 'healer' | 'dps';
}

export const FFXIV_JOBS: FfxivJobDef[] = [
  { class: 'Paladin', role: 'tank' },
  { class: 'Warrior', role: 'tank' },
  { class: 'Dark Knight', role: 'tank' },
  { class: 'Gunbreaker', role: 'tank' },
  { class: 'White Mage', role: 'healer' },
  { class: 'Scholar', role: 'healer' },
  { class: 'Astrologian', role: 'healer' },
  { class: 'Sage', role: 'healer' },
  { class: 'Monk', role: 'dps' },
  { class: 'Dragoon', role: 'dps' },
  { class: 'Ninja', role: 'dps' },
  { class: 'Samurai', role: 'dps' },
  { class: 'Reaper', role: 'dps' },
  { class: 'Bard', role: 'dps' },
  { class: 'Machinist', role: 'dps' },
  { class: 'Dancer', role: 'dps' },
  { class: 'Black Mage', role: 'dps' },
  { class: 'Summoner', role: 'dps' },
  { class: 'Red Mage', role: 'dps' },
];

// ─── Character Game Slug Constants ──────────────────────────────────────────

export const WOW_SLUG = 'world-of-warcraft';
export const WOW_CLASSIC_SLUG = 'world-of-warcraft-classic';
export const FFXIV_SLUG = 'final-fantasy-xiv-online';
