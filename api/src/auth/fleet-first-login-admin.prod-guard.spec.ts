/**
 * ROK-1537 AC3 — nothing that ships may set either fleet-only admin variable.
 * Both promotion paths (bootstrap-admin's configured id, the first-Discord-
 * login fallback) are reachable only when rl-infra env-spin injects them into
 * a DEMO_MODE fleet env.
 *
 * Review MINOR: the first cut scanned a fixed file list and missed
 * `render.yaml`, other `.env*.example` files and anything added later. This
 * scans EVERY tracked file against a short allowlist of files permitted to
 * name the variables; a new mention anywhere else fails until it is either
 * removed or deliberately allowlisted here.
 *
 * `#` comments are stripped before scanning so a shell/YAML/dotenv file may
 * still explain why the variables are absent.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  FLEET_ADMIN_ID_ENV,
  FLEET_FIRST_LOGIN_ENV,
} from './fleet-first-login-admin.helpers';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FORBIDDEN = [FLEET_FIRST_LOGIN_ENV, FLEET_ADMIN_ID_ENV];

/** Files (or `dir/` prefixes) allowed to name the variables. Keep it short. */
const ALLOWLIST = [
  'rl-infra/', // the fleet itself: env-spin injects them, docs explain them
  'api/scripts/bootstrap-admin.ts', // gated on DEMO_MODE, reads them
  'api/src/auth/fleet-first-login-admin.helpers.ts', // gated reader
  'api/src/auth/fleet-first-login-admin.spec.ts',
  'api/src/scripts/bootstrap-admin-fleet-operator.spec.ts',
];

function isAllowlisted(file: string): boolean {
  return ALLOWLIST.some((a) =>
    a.endsWith('/') ? file.startsWith(a) : file === a,
  );
}

/** Drop `#` comments (shell, Dockerfile, YAML, dotenv). Keeps shebang-free code. */
function stripHashComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}

/** Every tracked file that names a forbidden variable (raw text). */
function filesMentioningVars(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter((f) => f && fs.existsSync(path.join(REPO_ROOT, f)))
    .filter((f) => {
      const full = path.join(REPO_ROOT, f);
      if (!fs.statSync(full).isFile()) return false;
      const text = fs.readFileSync(full, 'utf8');
      return FORBIDDEN.some((v) => text.includes(v));
    });
}

describe('ROK-1537 AC3 — only allowlisted files name the fleet admin variables', () => {
  const hits = filesMentioningVars();

  it('the scan is live: it finds the allowlisted readers', () => {
    expect(hits).toEqual(
      expect.arrayContaining([
        'api/scripts/bootstrap-admin.ts',
        'api/src/auth/fleet-first-login-admin.helpers.ts',
        'rl-infra/orchestrator/bin/env-spin',
      ]),
    );
  });

  it('no file outside the allowlist sets or names either variable', () => {
    const offenders = hits
      .filter((f) => !isAllowlisted(f))
      .map((f) => {
        const code = stripHashComments(
          fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'),
        );
        return { file: f, found: FORBIDDEN.filter((v) => code.includes(v)) };
      })
      .filter((o) => o.found.length > 0);
    expect(offenders).toEqual([]);
  });

  it('comment stripping ignores explanatory comments but not code', () => {
    const text = `# ${FLEET_FIRST_LOGIN_ENV} is fleet-only\nENV ${FLEET_ADMIN_ID_ENV}=1 # x`;
    const code = stripHashComments(text);
    expect(code).not.toContain(FLEET_FIRST_LOGIN_ENV);
    expect(code).toContain(FLEET_ADMIN_ID_ENV);
  });
});
