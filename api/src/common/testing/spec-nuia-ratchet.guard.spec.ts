/**
 * ROK-1161 — guard: the noUncheckedIndexedAccess ratchet only shrinks.
 *
 * `api/tsconfig.spec-nuia.json` typechecks every spec with the flag on except
 * the subtrees in its `exclude` list. A PR that makes a subtree clean deletes
 * its exclude line. Two such PRs editing that list in parallel conflict, and a
 * resolution that keeps both sides silently re-excludes a subtree that was
 * already clean. Nothing else reports that: the ratchet still passes, it just
 * checks less.
 *
 * Each entry in CONVERTED is a subtree whose exclude line was removed. This
 * guard asks TypeScript itself (same include/exclude semantics as `tsc -p`)
 * which files the ratchet program holds, and fails if any spec under a
 * converted subtree is missing. When you delete an exclude line, add its
 * subtree here. When the ratchet file is deleted (the flag moves into
 * tsconfig.json), delete this guard with it.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const API_ROOT = path.resolve(__dirname, '../../..');
const RATCHET_CONFIG = path.join(API_ROOT, 'tsconfig.spec-nuia.json');

/** A directory (trailing slash, recursive) or a file-name prefix in one dir. */
const CONVERTED = ['src/discord-bot/services/', 'src/notifications/post-event'];

const SPEC_FILE = /\.spec.*\.ts$|\.test-fixtures\.ts$/;

function ratchetProgramFiles(): Set<string> {
  const read = ts.readConfigFile(RATCHET_CONFIG, (p) => ts.sys.readFile(p));
  if (read.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(read.error.messageText, '\n'),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, API_ROOT);
  return new Set(parsed.fileNames.map((f) => path.relative(API_ROOT, f)));
}

function walk(dir: string, recursive: boolean): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return recursive ? walk(full, true) : [];
    return [full];
  });
}

function specFilesUnder(subtree: string): string[] {
  const recursive = subtree.endsWith('/');
  const dir = path.join(API_ROOT, recursive ? subtree : path.dirname(subtree));
  return walk(dir, recursive)
    .map((f) => path.relative(API_ROOT, f))
    .filter((f) => f.startsWith(subtree) && SPEC_FILE.test(f));
}

describe('noUncheckedIndexedAccess ratchet (tsconfig.spec-nuia.json)', () => {
  const inProgram = ratchetProgramFiles();

  it.each(CONVERTED)(
    'keeps every spec under %s in the ratchet program',
    (subtree) => {
      const specs = specFilesUnder(subtree);
      expect(specs.length).toBeGreaterThan(0);
      const reExcluded = specs.filter((f) => !inProgram.has(f));
      expect({ subtree, reExcluded }).toEqual({ subtree, reExcluded: [] });
    },
  );
});
