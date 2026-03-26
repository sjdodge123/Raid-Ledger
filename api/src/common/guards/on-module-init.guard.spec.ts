import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Architectural guard: every `async onModuleInit` must be classified.
 *
 * Each file with `async onModuleInit` must EITHER:
 *   1. Use `bestEffortInit` (best-effort, guarded)
 *   2. Contain a `STARTUP-CRITICAL` comment (intentionally unguarded)
 *   3. Be in the KNOWN_INLINE_GUARDED allowlist (already has try/catch)
 *
 * When this test fails, you added a new onModuleInit hook.
 * Fix: wrap with bestEffortInit or add a STARTUP-CRITICAL comment.
 */

const SRC_DIR = join(__dirname, '..', '..');

/**
 * Inline-guarded allowlist cleared in ROK-972 — all hooks now use bestEffortInit.
 */
const KNOWN_INLINE_GUARDED: string[] = [];

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

/** Format violations into an actionable error message. */
function formatViolations(label: string, items: string[], fix: string): string {
  return (
    `${items.length} file(s) have ${label}:\n` +
    items.map((v) => `  - ${v}`).join('\n') +
    `\n\nFix: ${fix}`
  );
}

describe('onModuleInit classification guard', () => {
  it('every async onModuleInit is classified', () => {
    const files = collectTsFiles(SRC_DIR);
    const violations: string[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      if (!content.includes('async onModuleInit')) continue;

      const fileName = filePath.split('/').pop() ?? '';

      const hasBestEffort = content.includes('bestEffortInit');
      const hasStartupCritical = content.includes('STARTUP-CRITICAL');
      const isInlineGuarded = KNOWN_INLINE_GUARDED.includes(fileName);

      if (!hasBestEffort && !hasStartupCritical && !isInlineGuarded) {
        violations.push(relative(SRC_DIR, filePath));
      }
    }

    if (violations.length > 0) {
      throw new Error(
        formatViolations(
          'unclassified onModuleInit hooks',
          violations,
          'wrap with bestEffortInit (best-effort) or add // STARTUP-CRITICAL ' +
            'comment (intentionally unguarded) or add to KNOWN_INLINE_GUARDED.',
        ),
      );
    }
  });
});
