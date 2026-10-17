import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Architectural guard: every @OnEvent handler must have error handling.
 *
 * Event listeners that throw unhandled errors can orphan state, miss
 * notifications, or leave embeds out of sync. Each file with @OnEvent
 * must have try/catch or .catch() in the handler body, or be in the
 * allowlist with justification.
 *
 * When this test fails, you added a new @OnEvent handler without error
 * handling. Fix: add try/catch around the handler body, or add to the
 * allowlist with justification.
 */

const SRC_DIR = join(__dirname, '..', '..');

/**
 * Files with @OnEvent that intentionally lack try/catch in the handler.
 * Each entry must include a justification comment.
 */
const KNOWN_SAFE: string[] = [
  // ad-hoc-event.service.ts: cleanup handlers only remove in-memory map
  // entries. Failure leaves stale entries but no data corruption.
  'ad-hoc-event.service.ts',
  // voice-state.listener.ts: gateway handlers manage connection-level
  // state. Failure self-heals on next reconnect.
  'voice-state.listener.ts',
  // discord-sync.listener.ts: handlers only enqueue BullMQ jobs.
  // Failures are retried by BullMQ automatically.
  'discord-sync.listener.ts',
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

describe('@OnEvent listener error handling guard', () => {
  it('every @OnEvent handler has error handling or is allowlisted', () => {
    const files = collectTsFiles(SRC_DIR);
    const violations: string[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      if (!content.includes('@OnEvent(')) continue;

      const fileName = filePath.split('/').pop() ?? '';
      const hasTryCatch = content.includes('try {') || content.includes('try{');
      const hasDotCatch = content.includes('.catch(');
      const isAllowlisted = KNOWN_SAFE.includes(fileName);

      if (!hasTryCatch && !hasDotCatch && !isAllowlisted) {
        violations.push(relative(SRC_DIR, filePath));
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `${violations.length} file(s) have @OnEvent handlers without error handling:\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          '\n\nFix: add try/catch in the handler body, ' +
          'or add to KNOWN_SAFE allowlist with justification.',
      );
    }
  });
});
