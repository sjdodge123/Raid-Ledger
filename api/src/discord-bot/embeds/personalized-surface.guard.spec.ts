/**
 * ROK-1462 (slice D) — D10 source-scan guards.
 *
 * Two holes the type system cannot close on its own:
 *
 * 1. `addPersonalizedFields` only accepts a `DmEmbed`, but a builder that
 *    constructs a bare `new EmbedBuilder()` and is never chromed as a channel
 *    embed sits outside BOTH the compile-time brand and the write-time
 *    `ChannelEmbedBuilder` guard (documented at
 *    `embed-personalized.helpers.ts`). So: scan for the call and allowlist the
 *    DM path explicitly, which turns "a new caller appeared" into a red test.
 *
 * 2. The three commands this slice migrated must not grow their own chrome
 *    back — a `.setColor` in one of them means a reply has escaped the shared
 *    palette again (D9).
 *
 * Comments are stripped before scanning: the guard's OWN prose names the very
 * tokens it forbids, and a naive scan trips on itself (ROK-1314, twice).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const API_SRC = join(__dirname, '..', '..');

/**
 * Strip block and line comments before scanning.
 *
 * String literals are deliberately LEFT IN: stripping them would need a regex
 * that also understands regex literals (which contain quotes), and a scan that
 * over-reports a forbidden token inside a string is the safe direction to err.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every `.ts` file under `api/src`, excluding specs. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') sourceFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.includes('.spec.')) {
      acc.push(full);
    }
  }
  return acc;
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles(API_SRC)
    .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
    .map((file) => relative(API_SRC, file).replace(/\\/g, '/'))
    .sort();
}

describe('D10 — personalized fields never reach a non-DM surface', () => {
  // The stripper is the load-bearing half of every scan below, so prove it on
  // the hardest input available: this file, whose prose names the tokens the
  // scans forbid. The sentinel is assembled at runtime so the literal form
  // exists ONLY in the header comment -- spelling it out here would make the
  // assertion pass for the wrong reason.
  it('proves the comment-stripper works on this very file', () => {
    const self = readFileSync(join(__dirname, basename()), 'utf8');
    const sentinel = ['ROK', '1314'].join('-');

    expect(self).toContain(sentinel);
    expect(stripComments(self)).not.toContain(sentinel);
    expect(stripComments(self)).toContain('addPersonalizedFields');
  });

  it('is called only from the invite-DM builder', () => {
    expect(filesMatching(/\baddPersonalizedFields\s*\(/)).toEqual([
      'discord-bot/embeds/embed-personalized.helpers.ts',
      'discord-bot/services/pug-invite.helpers.ts',
    ]);
  });

  it('only the DM builder names a personalized field', () => {
    expect(filesMatching(/\bpersonalizedFieldName\s*\(/)).toEqual([
      'discord-bot/embeds/embed-personalized.helpers.ts',
      'discord-bot/services/pug-invite-personalization.helpers.ts',
    ]);
  });
});

describe('D10 — migrated commands own no chrome', () => {
  const MIGRATED = [
    'discord-bot/commands/bind.helpers.ts',
    'discord-bot/commands/bind.confirmation.ts',
    'discord-bot/commands/bind.command.ts',
    'discord-bot/commands/unbind.command.ts',
    'discord-bot/commands/events-list.command.ts',
    'discord-bot/commands/events-list.helpers.ts',
  ];

  it.each(MIGRATED)('%s never calls .setColor', (relPath) => {
    const source = stripComments(readFileSync(join(API_SRC, relPath), 'utf8'));
    expect(source).not.toMatch(/\.setColor\s*\(/);
  });
});

/** This spec's own filename, so the self-check cannot go stale on a rename. */
function basename(): string {
  return 'personalized-surface.guard.spec.ts';
}
