/**
 * ROK-1170 — optional guild-summary overrides of the seed-guild fixture body
 * (`POST /admin/test/wow/seed-guild`): `foundedAt` (ISO datetime) and
 * `blizzardSummaryStatus`, written to `guilds.founded_at` /
 * `guilds.blizzard_summary_status` so the Founded pill and the disbanded
 * banner can be seeded without a Blizzard call. Absent = null, so a re-seed
 * without them clears both.
 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import {
  BlizzardGuildStateSchema,
  type BlizzardGuildState,
} from '@raid-ledger/contract';

const SummaryOverridesSchema = z.object({
  foundedAt: z.string().datetime({ offset: true }).optional(),
  blizzardSummaryStatus: BlizzardGuildStateSchema.optional(),
});

/** The parsed overrides, null when not given. */
export interface SeedGuildSummaryOverrides {
  foundedAt: Date | null;
  blizzardSummaryStatus: BlizzardGuildState | null;
}

/** Raw body keys this helper reads. */
export interface RawSummaryOverrides {
  foundedAt?: unknown;
  blizzardSummaryStatus?: unknown;
}

/** Validates the two overrides; 400 on a non-ISO date or an unknown status. */
export function parseSummaryOverrides(
  raw: RawSummaryOverrides,
): SeedGuildSummaryOverrides {
  const parsed = SummaryOverridesSchema.safeParse({
    foundedAt: raw.foundedAt,
    blizzardSummaryStatus: raw.blizzardSummaryStatus,
  });
  if (!parsed.success) {
    throw new BadRequestException(
      `foundedAt must be an ISO datetime; blizzardSummaryStatus one of ok|not_found|disbanded|error (${parsed.error.message})`,
    );
  }
  const { foundedAt, blizzardSummaryStatus } = parsed.data;
  return {
    foundedAt: foundedAt ? new Date(foundedAt) : null,
    blizzardSummaryStatus: blizzardSummaryStatus ?? null,
  };
}
