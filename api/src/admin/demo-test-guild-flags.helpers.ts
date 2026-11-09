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

export interface RawSeedFlags {
  withContent?: unknown;
  withLockouts?: unknown;
  withDings?: unknown;
  withPresence?: unknown;
  withGear?: unknown;
  withPulls?: unknown;
  withInstalledAddons?: unknown;
  withArmorySnapshots?: unknown;
}

/** The opt-in boolean flags; 400 on a non-boolean. */
export function parseSeedFlags(
  raw: RawSeedFlags,
): Omit<SeedGuildInput, 'name' | 'gameSlug' | 'rosterSuffix'> {
  return {
    withContent: boolFlag(raw.withContent, 'withContent'),
    withLockouts: boolFlag(raw.withLockouts, 'withLockouts'),
    withDings: boolFlag(raw.withDings, 'withDings'),
    withPresence: boolFlag(raw.withPresence, 'withPresence'),
    withGear: boolFlag(raw.withGear, 'withGear'),
    withPulls: boolFlag(raw.withPulls, 'withPulls'),
    withInstalledAddons: boolFlag(
      raw.withInstalledAddons,
      'withInstalledAddons',
    ),
    withArmorySnapshots: boolFlag(
      raw.withArmorySnapshots,
      'withArmorySnapshots',
    ),
  };
}
