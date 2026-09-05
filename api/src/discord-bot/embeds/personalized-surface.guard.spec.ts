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
 * 2. A builder must not grow its own chrome back — a `.setColor` outside the
 *    chrome means a surface has escaped the shared palette again (D9).
 *
 * ROK-1477 AC4 replaces (2)'s fixed six-file `MIGRATED` allowlist with two
 * PROPERTIES over the whole api source tree. An allowlist of what has already
 * been migrated ratifies a partial migration and is green forever; a property
 * fails the moment a new file constructs or colours an embed itself.
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
    expect(stripComments(self)).toContain('productionFilesMatching');
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

/**
 * The single module allowed to author chrome: it constructs the one legitimate
 * `EmbedBuilder` (`embed-chrome.helpers.ts:178`) and writes the one legitimate
 * `.setColor` (`applyEmbedChrome`).
 */
const CHROME_MODULE = 'discord-bot/embeds/embed-chrome.helpers.ts';

/**
 * `sourceFiles` excludes `.spec.` only, so `*.spec-helpers.ts` survives it.
 * Those are test fixtures — two of them build a bare `new EmbedBuilder()` as a
 * mock message payload, which is legitimate, and is exactly why the sibling
 * guard's walker (`embed-colors.guard.spec.ts::collectTsFiles`) excludes the
 * same suffix. The two properties below are about PRODUCTION chrome, so they
 * scan this narrower set. The call-site pins above keep the wider one.
 */
/**
 * The exact fixture set `productionFiles()` steps around. Pinned so a NEW
 * `*.spec-helpers.ts` cannot slip a `new EmbedBuilder` past the properties by
 * its filename alone — it goes red here and gets a conscious ruling.
 */
const KNOWN_SPEC_HELPER_FIXTURES = [
  'discord-bot/listeners/signup-handlers.spec-helpers.ts',
  'discord-bot/listeners/signup-interaction.spec-helpers.ts',
  'discord-bot/listeners/steam-link.listener.spec-helpers.ts',
  'discord-bot/listeners/voice-state.general-lobby.spec-helpers.ts',
  'discord-bot/listeners/voice-state.rok-1445.spec-helpers.ts',
  'discord-bot/listeners/voice-state.rok-697.spawn.spec-helpers.ts',
  'discord-bot/services/ad-hoc-event.service.spec-helpers.ts',
  'discord-bot/services/scheduled-event.service.spec-helpers.ts',
  'discord-bot/services/voice-attendance.service.spec-helpers.ts',
  'events/og-meta.service.spec-helpers.ts',
  'events/signups.integration.spec-helpers.ts',
  'events/signups.spec-helpers.ts',
  'lfg/lfg-reads.integration.spec-helpers.ts',
  'lfg/lfg.integration.spec-helpers.ts',
  'notifications/recruitment-reminder.service.spec-helpers.ts',
];

function productionFiles(): string[] {
  return sourceFiles(API_SRC).filter(
    (file) => !file.endsWith('.spec-helpers.ts') && !file.endsWith('.d.ts'),
  );
}

/** `filesMatching`, restricted to production sources. */
function productionFilesMatching(pattern: RegExp): string[] {
  return productionFiles()
    .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
    .map((file) => relative(API_SRC, file).replace(/\\/g, '/'))
    .sort();
}

describe('ROK-1477 AC4 — the chrome is the only embed author', () => {
  // Without this, a broken walker (or a rename of the chrome module) makes
  // both properties below pass on an empty set, forever.
  it('walks the whole api source tree and still reaches the chrome', () => {
    expect(productionFiles().length).toBeGreaterThan(100);
    expect(
      productionFiles().map((file) =>
        relative(API_SRC, file).replace(/\\/g, '/'),
      ),
    ).toContain(CHROME_MODULE);
  });

  // `EmbedBuilder.from(...)` does NOT match this pattern, and that is
  // deliberate (D6): `departure-promote.handlers.ts` rehydrates an existing
  // DM's embed to edit it in place. `from()` copies chrome the helper already
  // wrote — it authors none — so it is not a violation.
  it('P1 — only the chrome constructs an EmbedBuilder', () => {
    expect(productionFilesMatching(/\bnew\s+EmbedBuilder\s*\(/)).toEqual([
      CHROME_MODULE,
    ]);
  });

  it('P2 — only the chrome sets a colour', () => {
    expect(productionFilesMatching(/\.setColor\s*\(/)).toEqual([CHROME_MODULE]);
  });
});

/** This spec's own filename, so the self-check cannot go stale on a rename. */
function basename(): string {
  return 'personalized-surface.guard.spec.ts';
}

describe('personalized-surface guard — fixture exclusion is pinned (ROK-1477)', () => {
  it('names every *.spec-helpers.ts the production scan steps around', () => {
    const found = sourceFiles(API_SRC)
      .filter((file) => file.endsWith('.spec-helpers.ts'))
      .map((file) => relative(API_SRC, file))
      .sort();
    expect(found).toEqual(KNOWN_SPEC_HELPER_FIXTURES);
  });
});
