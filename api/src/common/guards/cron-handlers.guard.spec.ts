import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Architectural guard: every @Cron handler must use executeWithTracking.
 *
 * The standard pattern for cron handlers is to wrap the body with
 * `cronJobService.executeWithTracking()`. Files in the allowlist have
 * their own error handling strategy (e.g. fire-and-forget queue enqueue,
 * simple cache refresh).
 *
 * When this test fails, you added a new @Cron handler without
 * executeWithTracking. Fix: inject CronJobService and wrap with
 * executeWithTracking, or add the file to the allowlist with justification.
 */

const SRC_DIR = join(__dirname, '..', '..');

/**
 * Files with @Cron that intentionally do NOT use executeWithTracking.
 * Each entry must include a justification comment.
 */
const KNOWN_SELF_GUARDED: string[] = [
  // ActiveEventCacheService: thin cache refresh, errors are non-fatal
  'active-event-cache.service.ts',
  // SteamSyncProcessor: only enqueues a BullMQ job (retries handled by BullMQ)
  'steam-sync.processor.ts',
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

describe('@Cron handler error wrapping guard', () => {
  it('every @Cron handler uses executeWithTracking or is allowlisted', () => {
    const files = collectTsFiles(SRC_DIR);
    const violations: string[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      if (!content.includes('@Cron(')) continue;

      const fileName = filePath.split('/').pop() ?? '';
      const hasTracking = content.includes('executeWithTracking');
      const isAllowlisted = KNOWN_SELF_GUARDED.includes(fileName);

      if (!hasTracking && !isAllowlisted) {
        violations.push(relative(SRC_DIR, filePath));
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `${violations.length} file(s) have @Cron handlers without executeWithTracking:\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          '\n\nFix: inject CronJobService and wrap with ' +
          'this.cronJobService.executeWithTracking(name, async () => { ... }), ' +
          'or add to KNOWN_SELF_GUARDED allowlist with justification.',
      );
    }
  });
});
