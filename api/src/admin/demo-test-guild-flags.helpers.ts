/**
 * Opt-in boolean flags of the seed-guild fixture body (`POST
 * /admin/test/seed-guild`). Split out of demo-test-guild.helpers.ts for the
 * 300-line limit.
 */
import { BadRequestException } from '@nestjs/common';
import type { SeedGuildInput } from './demo-test-guild.helpers';

/** An optional boolean body flag (absent = false). */
function boolFlag(value: unknown, name: string): boolean {
  const flag = value ?? false;
  if (typeof flag !== 'boolean') {
    throw new BadRequestException(`${name} must be a boolean`);
  }
  return flag;
}

/** The flag half of the parsed body. */
export type SeedFlags = Omit<
  SeedGuildInput,
  | 'name'
  | 'gameSlug'
  | 'rosterSuffix'
  | 'foundedAt'
  | 'blizzardSummaryStatus'
  | 'armoryProfessions'
>;

export interface RawSeedFlags {
  withContent?: unknown;
  withLockouts?: unknown;
  withDings?: unknown;
  withPresence?: unknown;
  withGear?: unknown;
  withPulls?: unknown;
  withInstalledAddons?: unknown;
  withArmorySnapshots?: unknown;
  withRecruitment?: unknown;
  withActivity?: unknown;
  asCaller?: unknown;
  memberCount?: unknown;
}

/**
 * The fixed five-row roster; `memberCount` pads it with filler rows. A
 * literal (demo-test-guild.helpers.ts imports this file, so deriving it from
 * `SEED_GUILD_ROSTER.length` is an import cycle); `SEED_GUILD_ROSTER`'s
 * `satisfies` clause makes tsc fail if the two ever drift.
 */
export const SEED_GUILD_BASE_ROWS = 5;
export const SEED_GUILD_MAX_ROWS = 60;
/** `withActivity` without a `memberCount` pads to this (B9 showcase). */
export const SEED_GUILD_SHOWCASE_ROWS = 50;

/** ROK-1789 B9: optional roster size, 5..60 (absent = 5, or 50 with `withActivity`). */
export function parseMemberCount(
  value: unknown,
  withActivity: boolean,
): number {
  if (value === undefined) {
    return withActivity ? SEED_GUILD_SHOWCASE_ROWS : SEED_GUILD_BASE_ROWS;
  }
  const ok =
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SEED_GUILD_BASE_ROWS &&
    value <= SEED_GUILD_MAX_ROWS;
  if (!ok || typeof value !== 'number') {
    throw new BadRequestException(
      `memberCount must be an integer ${SEED_GUILD_BASE_ROWS}-${SEED_GUILD_MAX_ROWS}`,
    );
  }
  return value;
}

/** The opt-in flags; 400 on a non-boolean. `withActivity` implies `withPulls` + `withDings` (B9). */
export function parseSeedFlags(raw: RawSeedFlags): SeedFlags {
  const withActivity = boolFlag(raw.withActivity, 'withActivity');
  return {
    ...parseBaseFlags(raw),
    withDings: withActivity || boolFlag(raw.withDings, 'withDings'),
    withPulls: withActivity || boolFlag(raw.withPulls, 'withPulls'),
    withActivity,
    asCaller: boolFlag(raw.asCaller, 'asCaller'),
    memberCount: parseMemberCount(raw.memberCount, withActivity),
  };
}

/** The flags `withActivity` does not touch. */
function parseBaseFlags(
  raw: RawSeedFlags,
): Omit<
  SeedFlags,
  'withDings' | 'withPulls' | 'withActivity' | 'asCaller' | 'memberCount'
> {
  return {
    withContent: boolFlag(raw.withContent, 'withContent'),
    withLockouts: boolFlag(raw.withLockouts, 'withLockouts'),
    withPresence: boolFlag(raw.withPresence, 'withPresence'),
    withGear: boolFlag(raw.withGear, 'withGear'),
    withInstalledAddons: boolFlag(
      raw.withInstalledAddons,
      'withInstalledAddons',
    ),
    withArmorySnapshots: boolFlag(
      raw.withArmorySnapshots,
      'withArmorySnapshots',
    ),
    withRecruitment: boolFlag(raw.withRecruitment, 'withRecruitment'),
  };
}
