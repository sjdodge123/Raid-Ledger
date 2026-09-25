/**
 * ROK-1527 — source-scanning guard: every `setInterval` owner must also
 * clear it.
 *
 * Why this exists
 * ---------------
 * The integration suite's monotonic heap climb (heap OOM in CI shards) was
 * NOT a socket leak — the ROK-1250 socket audit stayed green throughout.
 * It was an un-cleared interval timer.
 *
 * `SteamLinkListener` started a dedup sweeper in its constructor whose
 * callback is an arrow function. An arrow captures `this`, and `this` held
 * an injected `ModuleRef` — a handle on the whole Nest DI container. The
 * timer was `unref()`'d, so it never blocked process exit and never showed
 * up in `--detectOpenHandles` output, but `unref()` only drops the
 * event-loop keep-alive; libuv still owns the handle, the handle owns the
 * callback, and the callback owns the container. Every
 * `*.integration.spec.ts` boots its own AppModule, so each spec file left
 * one entire DI graph pinned for the remainder of the Jest process.
 *
 * This guard encodes the invariant so a new timer owner inherits it instead
 * of having to remember it: if a source file calls `setInterval`, that same
 * file must also call `clearInterval`. It is deliberately file-scoped
 * rather than trying to prove the clear runs from a lifecycle hook —
 * cheap, deterministic, and sufficient to have caught the regression above.
 *
 * The same leak class reappeared as a one-shot timer: VersionCheckService
 * started a 10 s `setTimeout` in `onModuleInit` and never cleared it, so it
 * fired after `app.close()` and its GitHub fetch inherited the finished
 * spec's async context (ROK-1527). The second rule therefore flags a file
 * that calls `setTimeout` directly inside a lifecycle-start body
 * (`constructor`, `onModuleInit`, `onApplicationBootstrap`) without also
 * calling `clearTimeout` somewhere in the file. Same file-scoped trade-off
 * as above; a timer started from a helper the hook calls is not seen.
 *
 * Comments are stripped before scanning (ROK-1314): otherwise this file's
 * own prose, and explanatory comments in the files being scanned, would
 * trip the guard.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

/**
 * Files exempt from the pairing rule, each with the reason it is safe.
 * Keep this list short and justified — an entry is a standing leak.
 */
const ALLOWLIST = new Map<string, string>([
  // Empty since ROK-1527: `event-link.dedup.ts` was exempt as a "tiny"
  // module-scope sweeper, but a module-scope interval is re-created per
  // Jest module registry and pins that spec file's whole realm. It now
  // expires entries lazily with no timer at all.
]);

const LIFECYCLE_START =
  /\b(?:constructor|onModuleInit|onApplicationBootstrap)\s*\([^)]*\)[^{;]*\{/g;

/** Bodies of every lifecycle-start method (brace-matched) in `code`. */
function lifecycleStartBodies(code: string): string[] {
  const bodies: string[] = [];
  for (const match of code.matchAll(LIFECYCLE_START)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let i = start;
    while (i < code.length && depth > 0) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
      i++;
    }
    bodies.push(code.slice(start, i));
  }
  return bodies;
}

/** Strip block and line comments so prose cannot satisfy or trip the scan. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Recursively collect non-spec `.ts` files under `dir`. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'testing') continue;
      collectSourceFiles(full, acc);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.spec.ts') || entry.endsWith('.d.ts')) continue;
    acc.push(full);
  }
  return acc;
}

describe('ROK-1527 timer teardown guard', () => {
  const files = collectSourceFiles(SRC_ROOT);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('every setInterval owner also calls clearInterval', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (!code.includes('setInterval(')) continue;

      const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
      if (ALLOWLIST.has(rel)) continue;

      if (!code.includes('clearInterval(')) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it('every setTimeout started in a constructor/onModuleInit/onApplicationBootstrap is also cleared', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (!code.includes('setTimeout(') || code.includes('clearTimeout(')) {
        continue;
      }
      const startsTimer = lifecycleStartBodies(code).some((body) =>
        body.includes('setTimeout('),
      );
      if (startsTimer) {
        offenders.push(path.relative(SRC_ROOT, file).split(path.sep).join('/'));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest — every entry still exists and still sets an interval', () => {
    for (const rel of ALLOWLIST.keys()) {
      const full = path.join(SRC_ROOT, rel);
      const code = stripComments(readFileSync(full, 'utf8'));
      expect(code).toContain('setInterval(');
    }
  });
});
