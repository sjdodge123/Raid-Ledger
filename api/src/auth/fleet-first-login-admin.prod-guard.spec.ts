/**
 * ROK-1537 AC3 — the production images, entrypoint and compose files must
 * never set either fleet-only admin variable. Both promotion paths
 * (bootstrap-admin's configured id, the first-Discord-login fallback) are
 * reachable only when env-spin injects them into a DEMO_MODE fleet env.
 *
 * Comments are stripped before scanning so a file may still explain why the
 * variables are absent.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  FLEET_ADMIN_ID_ENV,
  FLEET_FIRST_LOGIN_ENV,
} from './fleet-first-login-admin.helpers';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FORBIDDEN = [FLEET_FIRST_LOGIN_ENV, FLEET_ADMIN_ID_ENV];
const FIXED_FILES = [
  'Dockerfile.allinone',
  'api/Dockerfile',
  'api/scripts/docker-entrypoint.sh',
  '.env.docker.example',
];

/** Drop `#` comments (shell, Dockerfile, YAML, dotenv). Keeps shebang-free code. */
function stripHashComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}

function productionFiles(): string[] {
  const compose = fs
    .readdirSync(REPO_ROOT)
    .filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
  return [...FIXED_FILES, ...compose];
}

describe('ROK-1537 AC3 — prod artifacts never set fleet admin variables', () => {
  it('scans the allinone image, api image, entrypoint and every compose file', () => {
    const files = productionFiles();
    expect(files).toEqual(
      expect.arrayContaining(['Dockerfile.allinone', 'docker-compose.yml']),
    );
    for (const f of files) {
      expect(fs.existsSync(path.join(REPO_ROOT, f))).toBe(true);
    }
  });

  it.each(productionFiles())(
    '%s does not mention a fleet admin variable',
    (f) => {
      const code = stripHashComments(
        fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'),
      );
      const found = FORBIDDEN.filter((v) => code.includes(v));
      expect({ file: f, found }).toEqual({ file: f, found: [] });
    },
  );

  it('comment stripping ignores explanatory comments but not code', () => {
    const text = `# ${FLEET_FIRST_LOGIN_ENV} is fleet-only\nENV ${FLEET_ADMIN_ID_ENV}=1 # x`;
    const code = stripHashComments(text);
    expect(code).not.toContain(FLEET_FIRST_LOGIN_ENV);
    expect(code).toContain(FLEET_ADMIN_ID_ENV);
  });
});
