/**
 * ROK-2132 — the seed-guild `rosterSuffix` body field. A roster claim hides
 * every same-named row of the game, so parallel claim smoke specs seeding the
 * fixed roster would contend for Corvin/Elowen; a per-run suffix gives each
 * seeded guild its own names.
 */
import { BadRequestException } from '@nestjs/common';
import type { SEED_GUILD_ROSTER } from './demo-test-guild.helpers';

/** One roster row, its name possibly suffixed. */
export type SeedRosterEntry = Omit<
  (typeof SEED_GUILD_ROSTER)[number],
  'char'
> & { char: string };

const ROSTER_SUFFIX_RE = /^[A-Za-z]{1,6}$/;

/** Optional letters-only roster-name suffix (absent = ''); 400 otherwise. */
export function parseRosterSuffix(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || !ROSTER_SUFFIX_RE.test(value)) {
    throw new BadRequestException('rosterSuffix: 1-6 letters');
  }
  return value;
}
