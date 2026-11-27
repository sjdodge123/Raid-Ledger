/**
 * ROK-2366 — `api/plugin-boundary-allowlist.json` freezes today's deep imports
 * into `plugins/<x>/**` (lint rule `rl-plugin-boundary/deep-import`, in
 * `eslint-rules/plugin-boundary.mjs`). The rule reports a listed specifier the
 * file no longer imports as stale; this spec covers what the rule cannot see:
 * a listed file that was deleted or renamed, or an entry that is malformed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_DIR = path.resolve(__dirname, '../../..');
const LIST_FILE = path.join(API_DIR, 'plugin-boundary-allowlist.json');

function readAllowlist(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${LIST_FILE} must be a JSON object`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

describe('plugin-boundary allowlist (ROK-2366, shrink-only)', () => {
  const allowlist = readAllowlist();

  it('lists only files that still exist (delete the entry of a removed file)', () => {
    const missing = Object.keys(allowlist).filter(
      (file) => !fs.existsSync(path.join(API_DIR, file)),
    );
    expect(missing).toEqual([]);
  });

  it('lists only lint-checked source files, never specs', () => {
    const specs = Object.keys(allowlist).filter((file) =>
      /\.spec(-helpers)?\.ts$/.test(file),
    );
    expect(specs).toEqual([]);
  });

  it('keeps every entry a non-empty, sorted, unique list of specifiers', () => {
    const bad = Object.entries(allowlist)
      .filter(([, specs]) => {
        if (!Array.isArray(specs) || specs.length === 0) return true;
        const strings = specs.filter((s): s is string => typeof s === 'string');
        const sorted = [...new Set(strings)].sort();
        return strings.length !== specs.length || sorted.join('\n') !== strings.join('\n');
      })
      .map(([file]) => file);
    expect(bad).toEqual([]);
  });
});
