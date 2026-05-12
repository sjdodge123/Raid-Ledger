import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// We mock config so PROJECT_DIR / MAIN_REPO / IS_WORKTREE point at tmp dirs.
let projectDir = '';
let mainRepo = '';

vi.mock('../config.js', () => ({
  get PROJECT_DIR() {
    return projectDir;
  },
  get MAIN_REPO() {
    return mainRepo;
  },
  get IS_WORKTREE() {
    return true;
  },
}));

import { execute, propagateDemoMode } from './env-copy.js';

function writeFile(path: string, content: string): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

describe('env-copy: DEMO_MODE propagation (ROK-1267)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(resolve(tmpdir(), 'env-copy-test-'));
    mainRepo = resolve(tmpRoot, 'main');
    projectDir = resolve(tmpRoot, 'worktree');
    mkdirSync(mainRepo, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('propagateDemoMode (unit)', () => {
    it('appends DEMO_MODE to api/.env when missing and root .env has it', () => {
      writeFile(resolve(mainRepo, '.env'), 'CLIENT_URL=http://x\nDEMO_MODE=true\n');
      const apiEnv = resolve(projectDir, 'api/.env');
      writeFile(apiEnv, 'DATABASE_URL=postgres://x\n');

      const status = propagateDemoMode(apiEnv);

      expect(status).toBe('applied');
      const content = readFileSync(apiEnv, 'utf-8');
      expect(content).toContain('DEMO_MODE=true');
      expect(content).toContain('DATABASE_URL=postgres://x');
    });

    it('is idempotent — re-running does not duplicate the line', () => {
      writeFile(resolve(mainRepo, '.env'), 'DEMO_MODE=true\n');
      const apiEnv = resolve(projectDir, 'api/.env');
      writeFile(apiEnv, 'DATABASE_URL=postgres://x\n');

      propagateDemoMode(apiEnv);
      const afterFirst = readFileSync(apiEnv, 'utf-8');
      const second = propagateDemoMode(apiEnv);

      expect(second).toBe('already_present');
      expect(readFileSync(apiEnv, 'utf-8')).toBe(afterFirst);
    });

    it('reports already_present when api/.env already has DEMO_MODE', () => {
      writeFile(resolve(mainRepo, '.env'), 'DEMO_MODE=true\n');
      const apiEnv = resolve(projectDir, 'api/.env');
      writeFile(apiEnv, 'DEMO_MODE=false\nDATABASE_URL=x\n');

      const status = propagateDemoMode(apiEnv);

      expect(status).toBe('already_present');
      // Existing DEMO_MODE value is preserved — we never overwrite.
      expect(readFileSync(apiEnv, 'utf-8')).toMatch(/^DEMO_MODE=false$/m);
    });

    it('reports no_source_value when root .env lacks DEMO_MODE', () => {
      writeFile(resolve(mainRepo, '.env'), 'CLIENT_URL=http://x\n');
      const apiEnv = resolve(projectDir, 'api/.env');
      writeFile(apiEnv, 'DATABASE_URL=x\n');

      expect(propagateDemoMode(apiEnv)).toBe('no_source_value');
    });

    it('reports no_dest_file when api/.env does not exist', () => {
      writeFile(resolve(mainRepo, '.env'), 'DEMO_MODE=true\n');
      const apiEnv = resolve(projectDir, 'api/.env');

      expect(propagateDemoMode(apiEnv)).toBe('no_dest_file');
    });

    it('handles api/.env without a trailing newline', () => {
      writeFile(resolve(mainRepo, '.env'), 'DEMO_MODE=true\n');
      const apiEnv = resolve(projectDir, 'api/.env');
      writeFile(apiEnv, 'DATABASE_URL=x');

      propagateDemoMode(apiEnv);
      const content = readFileSync(apiEnv, 'utf-8');

      expect(content).toMatch(/DATABASE_URL=x\nDEMO_MODE=true\n$/);
    });
  });

  describe('execute (integration with file copy)', () => {
    it('copying api/.env from a main repo without DEMO_MODE still ends with DEMO_MODE applied', async () => {
      // Setup: main repo has DEMO_MODE only in root .env (the real-world bug).
      writeFile(resolve(mainRepo, '.env'), 'DEMO_MODE=true\nCLIENT_URL=http://x\n');
      writeFile(resolve(mainRepo, 'api/.env'), 'DATABASE_URL=postgres://x\n');

      const result = await execute({ file: 'api/.env' });

      expect('copied' in result).toBe(true);
      if (!('copied' in result)) return;
      expect(result.copied[0]).toEqual({
        path: 'api/.env',
        status: 'copied',
        demoModeOverlay: 'applied',
      });
      const dest = resolve(projectDir, 'api/.env');
      expect(readFileSync(dest, 'utf-8')).toContain('DEMO_MODE=true');
    });

    it('skipped_exists api/.env still receives the DEMO_MODE overlay', async () => {
      writeFile(resolve(mainRepo, '.env'), 'DEMO_MODE=true\n');
      writeFile(resolve(mainRepo, 'api/.env'), 'DATABASE_URL=postgres://x\n');
      // Worktree already has api/.env (skipped_exists path).
      writeFile(resolve(projectDir, 'api/.env'), 'DATABASE_URL=postgres://x\n');

      const result = await execute({ file: 'api/.env' });

      if (!('copied' in result)) throw new Error('expected copied[]');
      expect(result.copied[0].status).toBe('skipped_exists');
      expect(result.copied[0].demoModeOverlay).toBe('applied');
      expect(readFileSync(resolve(projectDir, 'api/.env'), 'utf-8')).toContain('DEMO_MODE=true');
    });

    it('non-api .env files do not get demoModeOverlay annotation', async () => {
      writeFile(resolve(mainRepo, '.env'), 'DEMO_MODE=true\nCLIENT_URL=http://x\n');

      const result = await execute({ file: '.env' });

      if (!('copied' in result)) throw new Error('expected copied[]');
      expect(result.copied[0].path).toBe('.env');
      expect(result.copied[0].demoModeOverlay).toBeUndefined();
    });
  });
});
