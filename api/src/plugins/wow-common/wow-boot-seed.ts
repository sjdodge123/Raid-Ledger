import type { Logger } from '@nestjs/common';

/**
 * Boot-time WoW reference-data seed gate (ROK-2196).
 *
 * `WowCommonModule.onModuleInit` upserts ~6.6k rows (518 bosses, 6,116 loot
 * items, 377 quests) from ~2.6 MB of JSON on every boot. Prod keeps it on
 * (`useValue: true`). The integration harness overrides the token to `false`:
 * its setup-file `beforeAll` runs `truncateAllTables` straight after
 * `app.init()`, so the boot-seeded rows were deleted before any test could
 * read them — specs that need the data call the seeder themselves.
 */
export const WOW_BOOT_SEED_ENABLED = Symbol('WOW_BOOT_SEED_ENABLED');

/**
 * Run `seed` only when the boot seed is enabled.
 * @returns whether the seed ran.
 */
export async function runWowBootSeed(
  enabled: boolean,
  seed: () => Promise<void>,
): Promise<boolean> {
  if (!enabled) return false;
  await seed();
  return true;
}

/** Run one seed; a missing table is an error, anything else a warning. */
async function safeSeed(
  label: string,
  logger: Logger,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const msg = String(err);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      logger.error(
        `${label} seed FAILED — table does not exist. Migrations may not have run: ${msg}`,
      );
    } else {
      logger.warn(`${label} seed skipped (may already exist): ${msg}`);
    }
  }
}

/**
 * Seed dungeon quests then boss encounters + loot (non-fatal on failure).
 * Moved verbatim from `WowCommonModule.seedOnBoot` / `safeSeed`.
 */
export async function seedWowReferenceData(
  quests: { seedQuests(): Promise<unknown> },
  bosses: { seedBosses(): Promise<unknown> },
  logger: Logger,
): Promise<void> {
  await safeSeed('Dungeon quest', logger, () => quests.seedQuests());
  await safeSeed('Boss encounter', logger, () => bosses.seedBosses());
}
