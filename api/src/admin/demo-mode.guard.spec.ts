import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { ForbiddenException } from '@nestjs/common';
import { DemoModeGuard } from './demo-mode.guard';
import type { SettingsService } from '../settings/settings.service';

function makeGuard(dbDemoMode: boolean | null): DemoModeGuard {
  if (dbDemoMode === null) return new DemoModeGuard(undefined);
  const settings = {
    getDemoMode: jest.fn().mockResolvedValue(dbDemoMode),
  } as unknown as SettingsService;
  return new DemoModeGuard(settings);
}

describe('DemoModeGuard', () => {
  const original = process.env.DEMO_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = original;
  });

  it('allows when env and DB setting are both on', async () => {
    process.env.DEMO_MODE = 'true';
    await expect(makeGuard(true).canActivate()).resolves.toBe(true);
  });

  it('403s when the env flag is off', async () => {
    process.env.DEMO_MODE = 'false';
    await expect(makeGuard(true).canActivate()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403s when the DB setting is off', async () => {
    process.env.DEMO_MODE = 'true';
    await expect(makeGuard(false).canActivate()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('fails closed when SettingsService is unavailable', async () => {
    process.env.DEMO_MODE = 'true';
    await expect(makeGuard(null).canActivate()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

const SRC_DIR = join(__dirname, '..');

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      out.push(...collectSourceFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block + line comments so a comment mentioning the guard can't satisfy the scan. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('every /admin/test controller carries DemoModeGuard', () => {
  it('has DemoModeGuard in its class-level @UseGuards', () => {
    const controllerRe = /@Controller\(\s*['"`]admin\/test[^)]*\)/;
    const guardedRe =
      /@Controller\(\s*['"`]admin\/test[^)]*\)\s*(?:@\w+\([^)]*\)\s*)*@UseGuards\([^)]*\bDemoModeGuard\b[^)]*\)/;
    const scanned: string[] = [];
    const missing: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const src = stripComments(readFileSync(file, 'utf-8'));
      if (!controllerRe.test(src)) continue;
      scanned.push(file);
      if (!guardedRe.test(src)) missing.push(relative(SRC_DIR, file));
    }
    expect(scanned.length).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });
});
