// ROK-1568 review BLOCKER 2 — the remote script must actually PARSE.
//
// v1 inlined the script into `bash -c '…'`; the nested single quotes in
// `'{{json .}}'` and `'[]'` closed the wrapper early, so every rl_fleet_prune
// call died remotely with "unexpected EOF while looking for matching `)'" and
// returned failed_to_parse_response. The old spec only did `.contains()` on the
// joined argv, which a syntactically broken command passes happily.
//
// This file deliberately does NOT mock node:child_process: it runs the real
// `bash -n` over the generated script and over the base64 wrapper.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRemoteCommand, buildRemoteScript } from '../fleet-prune.js';

const parseCheck = (script: string): void => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-prune-script-'));
  const file = join(dir, 'remote.sh');
  writeFileSync(file, script, 'utf8');
  execFileSync('bash', ['-n', file], { stdio: 'pipe' });
};

describe('rl_fleet_prune remote script', () => {
  it.each([false, true])('is valid bash (dry_run=%s)', (dryRun) => {
    expect(() => parseCheck(buildRemoteScript(dryRun))).not.toThrow();
  });

  it.each([false, true])('survives the base64 wrapper (dry_run=%s)', (dryRun) => {
    // `bash -n -c` parses the wrapper without running it, so the command
    // substitution is checked for syntax, not executed.
    expect(() =>
      execFileSync('bash', ['-n', '-c', buildRemoteCommand(dryRun)], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('round-trips the encoded script byte-for-byte', () => {
    const cmd = buildRemoteCommand(true);
    const m = /echo ([A-Za-z0-9+/=]+) \| base64 -d/.exec(cmd);
    expect(m).not.toBeNull();
    const decoded = Buffer.from(m![1], 'base64').toString('utf8');
    expect(decoded).toBe(buildRemoteScript(true));
    expect(decoded).toContain("docker system df --format '{{json .}}'");
  });
});
