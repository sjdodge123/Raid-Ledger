/**
 * ROK-1958 — pure helpers for `POST /admin/test/bg3/seed-hub` (the BG3 hub
 * widgets smoke + fleet test plan fixture). Everything here is deterministic
 * from `(tag, now)`, so the unit spec pins it without a database:
 *   - the body schema and variant names;
 *   - the per-tag usernames, Discord snowflakes, hub name and campaign key;
 *   - the save history: `BG3_SEED_SESSIONS` sessions ≥ 4 h apart (so the
 *     Campaign tab's 20-per-page History shows "Show more"), each a valid
 *     `bg3-save` v1 message built from the contract's golden fixture shape
 *     (`packages/contract/companion/bg3-save/v1/fixtures/act2-party-4p-summon.json`
 *     — already anonymous: origins/races/classes only, no player names).
 * The newest save is the fixture's Act 2 party (4 heroes + 1 summon).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Bg3PartyMember, Bg3SaveMessage } from '@raid-ledger/contract';

export const BG3_SEED_VARIANTS = [
  'default',
  'no-campaign',
  'no-saves',
  'spoilers',
] as const;
export type Bg3SeedVariant = (typeof BG3_SEED_VARIANTS)[number];

export const Bg3SeedHubSchema = z
  .object({
    /** Scopes the fixture (hub name + users) to one spec × project × worker. */
    tag: z.string().regex(/^[a-z0-9-]{1,32}$/),
    variant: z.enum(BG3_SEED_VARIANTS).optional(),
  })
  .strict();
export type Bg3SeedHubInput = z.infer<typeof Bg3SeedHubSchema>;

/** The seeded people; `visitor` is a user who is NOT a hub member. */
export const BG3_SEED_ROLES = [
  'host',
  'officer',
  'member',
  'claimer',
  'visitor',
] as const;
export type Bg3SeedRole = (typeof BG3_SEED_ROLES)[number];

/** Sessions seeded — more than one 20-row History page. */
export const BG3_SEED_SESSIONS = 24;
/** Start-to-start spacing; minus the 30-min in-session save stays ≥ 4 h. */
const SESSION_SPACING_MS = 8 * 3_600_000;
const IN_SESSION_STEP_MS = 30 * 60_000;
const CAPTURE_LAG_MS = 5_000;

/** The slot the `claimer` holds: the fixture's Human Wizard. */
export const BG3_SEED_CLAIMED_SLOT = 'Generic:Human:1';
export const BG3_SEED_CAMPAIGN_NAME = 'Tactician run';

/** `bg3-<role>-<tag>`. */
export function bg3SeedUsername(role: Bg3SeedRole, tag: string): string {
  return `bg3-${role}-${tag}`;
}

/** `97` + 16 digits hashed from the username — clear of the 90/91/98 ranges. */
export function bg3SeedDiscordId(username: string): string {
  const hex = createHash('sha256').update(username).digest('hex');
  return `97${String(parseInt(hex.slice(0, 13), 16)).padStart(16, '0')}`;
}

export function bg3SeedHubName(tag: string): string {
  return `BG3 Party #${tag}`;
}

/** A stable 64-hex campaign key per tag (the host's save folder). */
export function bg3SeedCampaignKey(tag: string): string {
  return createHash('sha256').update(`bg3-seed:${tag}`).digest('hex');
}

/** The golden fixture's party: 4 heroes at level 8 + a summon (2nd). */
export const BG3_FIXTURE_PARTY: readonly Bg3PartyMember[] = Object.freeze([
  hero('Elf_WoodElf', 5630, 35630, [
    { main: 'Barbarian', sub: 'BerserkerPath' },
  ]),
  {
    origin: 'DogFamiliar_Scratch_Summon',
    race: 'Beast',
    level: 1,
    xpLevel: 0,
    xpTotal: 0,
    classes: [],
    isSummon: true,
  },
  hero('Human', 5590, 35590, [{ main: 'Wizard', sub: 'NecromancySchool' }]),
  hero('Duergar', 5390, 35390, [
    { main: 'Ranger', sub: 'GloomStalker' },
    { main: 'Rogue', sub: 'Thief' },
  ]),
  hero('Tiefling_Asmodeus', 5630, 35630, [
    { main: 'Paladin', sub: 'Vengeance' },
  ]),
]);

function hero(
  race: string,
  xpLevel: number,
  xpTotal: number,
  classes: Bg3PartyMember['classes'],
): Bg3PartyMember {
  return {
    origin: 'Generic',
    race,
    level: 8,
    xpLevel,
    xpTotal,
    classes,
    isSummon: false,
  };
}

/** The fixture party re-levelled for an older save (summon untouched). */
export function partyAtLevel(level: number): Bg3PartyMember[] {
  if (level >= 8) return BG3_FIXTURE_PARTY.map((m) => ({ ...m }));
  return BG3_FIXTURE_PARTY.map((m) =>
    m.isSummon
      ? { ...m }
      : { ...m, level, xpLevel: 300, xpTotal: level * 4_000 + 300 },
  );
}

/** One planned save, oldest first. */
export interface Bg3SeedSavePlan {
  sessionIndex: number;
  savedAt: Date;
  currentLevel: string;
  level: number;
}

/** Act 1 → Rosymorn → Act 2 across the history; the newest is Act 2. */
function areaFor(k: number, n: number): string {
  if (k < n / 3) return 'WLD_Main_A';
  if (k < (2 * n) / 3) return 'CRE_Main_A';
  return 'SCL_Main_A';
}

/** Session k (0 = oldest) has 1 + (k % 2) saves; the newest ends 30 min before `now`. */
export function planSeedSaves(
  now: Date,
  sessions: number = BG3_SEED_SESSIONS,
): Bg3SeedSavePlan[] {
  const plans: Bg3SeedSavePlan[] = [];
  for (let k = 0; k < sessions; k++) {
    const start =
      now.getTime() - (sessions - 1 - k) * SESSION_SPACING_MS - 3_600_000;
    const level = 3 + Math.floor((5 * k) / Math.max(1, sessions - 1));
    const saves = k === sessions - 1 ? 2 : 1 + (k % 2);
    for (let j = 0; j < saves; j++) {
      plans.push({
        sessionIndex: k,
        savedAt: new Date(start + j * IN_SESSION_STEP_MS),
        currentLevel: areaFor(k, sessions),
        level,
      });
    }
  }
  return plans;
}

/** ISO-8601 without milliseconds, like the companion emits. */
function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A `bg3-save` v1 message for one planned save (no thumbnail: no blob). */
export function seedSaveMessage(
  plan: Bg3SeedSavePlan,
  index: number,
  campaignKey: string,
): Bg3SaveMessage {
  return {
    envelopeVersion: 1,
    contract: 'bg3-save',
    contractVersion: 1,
    capturedAt: isoSeconds(new Date(plan.savedAt.getTime() + CAPTURE_LAG_MS)),
    appVersion: '0.1.0',
    collectorVersion: '0.1.0',
    payload: {
      saveName: `QuickSave_${index + 1}`,
      savedAt: isoSeconds(plan.savedAt),
      campaignKey,
      campaignKeySource: 'save-folder',
      gameVersion: '4.1.1.7631656',
      platform: 'Steam',
      currentLevel: plan.currentLevel,
      difficulty: 'DifficultyHard',
      ruleset: 'RulesetLarian',
      party: partyAtLevel(plan.level),
      thumbnail: null,
    },
  };
}

/** What the variant seeds. */
export function variantShape(variant: Bg3SeedVariant): {
  campaign: boolean;
  assignSaves: boolean;
  claim: boolean;
  spoilers: boolean;
} {
  if (variant === 'no-campaign') {
    return {
      campaign: false,
      assignSaves: false,
      claim: false,
      spoilers: false,
    };
  }
  if (variant === 'no-saves') {
    return {
      campaign: true,
      assignSaves: false,
      claim: false,
      spoilers: false,
    };
  }
  return {
    campaign: true,
    assignSaves: true,
    claim: true,
    spoilers: variant === 'spoilers',
  };
}
