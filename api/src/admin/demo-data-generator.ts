/**
 * Demo Data Generator (ROK-233)
 *
 * Deterministic data generator using seeded PRNG (mulberry32).
 * Repeated installs produce identical data for reproducible demos.
 *
 * This barrel re-exports all generator functions, types, and data pools
 * from their split module files.
 */

// ─── PRNG ────────────────────────────────────────────────────────────────────
export type { Rng } from './demo-data-rng';
export {
  createRng,
  pick,
  pickN,
  randInt,
  shuffle,
  weightedPick,
} from './demo-data-rng';

// ─── Data Pools ──────────────────────────────────────────────────────────────
export type { WowClassDef, FfxivJobDef } from './demo-data-generator-pools';
export { WOW_CLASSES, FFXIV_JOBS } from './demo-data-generator-pools';

export type { IgdbGameWeight } from './demo-data-generator-templates';
export { IGDB_GAME_WEIGHTS } from './demo-data-generator-templates';

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  GeneratedUser,
  GeneratedEvent,
  GeneratedCharacter,
  GeneratedSignup,
  GeneratedGameTime,
  GeneratedAvailability,
  GeneratedNotification,
  GeneratedNotifPreference,
  GeneratedGameInterest,
} from './demo-data-generator-types';

// ─── Core Generators ─────────────────────────────────────────────────────────
export {
  generateUsernames,
  generateEvents,
  generateCharacters,
} from './demo-data-gen-core';

export { generateSignups } from './demo-data-gen-signups';

// ─── Support Generators ──────────────────────────────────────────────────────
export {
  generateGameTime,
  generateAvailability,
  generateNotifications,
  generateNotifPreferences,
  generateGameInterests,
  getAllNotificationTitles,
} from './demo-data-gen-support';
