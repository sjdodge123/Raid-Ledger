import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Architectural guard: every @Processor file must have error handling.
 *
 * BullMQ auto-retries failed jobs, so process() methods are allowed to throw.
 * However, fire-and-forget side effects inside process() must have `.catch()`.
 *
 * Each @Processor file must EITHER:
 *   1. Contain `try` (has a try/catch block)
 *   2. Be in the KNOWN_THROW_SAFE allowlist (process throws, BullMQ retries)
 *
 * When this test fails, you added a new @Processor without error handling.
 * Fix: add try/catch for side effects, or add to the allowlist if process()
 * failures are handled by BullMQ retry configuration.
 */

const SRC_DIR = join(__dirname, '..', '..');

/**
 * Processors where process() is allowed to throw freely.
 * BullMQ retry handles failures, and no fire-and-forget side effects exist.
 */
const KNOWN_THROW_SAFE: string[] = [
  // IgdbSyncProcessor: delegates to igdbService.syncAllGames(), BullMQ retries
  'igdb-sync.processor.ts',
  // SteamSyncProcessor: delegates to steamService sync, BullMQ retries
  'steam-sync.processor.ts',
  // EnrichmentsProcessor: delegates to enrichmentsService, BullMQ retries
  'enrichments.processor.ts',
  // DepartureGraceProcessor: delegates to helpers, BullMQ retries on failure
  'departure-grace.processor.ts',
  // BenchPromotionProcessor: promotion logic, BullMQ retries on failure
  'bench-promotion.service.ts',
  // LineupPhaseProcessor: onModuleInit uses bestEffortInit (ROK-972), process() delegates to executeTransition, BullMQ retries
  'lineup-phase.processor.ts',
  // GameTasteRecomputeProcessor: process() delegates to recomputeGameVector, BullMQ retries on failure (ROK-1082)
  'game-taste-recompute.processor.ts',
];

/** Recursively collect all `.ts` source files. */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...collectTsFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.spec-helpers.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('@Processor error handling guard', () => {
  it('every @Processor file has error handling or is allowlisted', () => {
    const files = collectTsFiles(SRC_DIR);
    const violations: string[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      if (!content.includes('@Processor(')) continue;

      const fileName = filePath.split('/').pop() ?? '';
      const hasTryCatch = content.includes('try {') || content.includes('try{');
      const isAllowlisted = KNOWN_THROW_SAFE.includes(fileName);

      if (!hasTryCatch && !isAllowlisted) {
        violations.push(relative(SRC_DIR, filePath));
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `${violations.length} @Processor file(s) lack error handling:\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          '\n\nFix: add try/catch for fire-and-forget side effects in process(), ' +
          'or add to KNOWN_THROW_SAFE allowlist if BullMQ retry is sufficient.',
      );
    }
  });
});
