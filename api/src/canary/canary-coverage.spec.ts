import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Enforces that every plugin with `integrations[]` in its manifest
 * has a corresponding `.canary.ts` file in `api/src/canary/`.
 *
 * This test fails CI if a new integration is added without a canary probe.
 */
function describeCanaryCoverage() {
  const pluginsDir = join(__dirname, '..', 'plugins');
  const canaryDir = __dirname;

  /** Read all manifest files and extract integration keys */
  function getPluginIntegrationKeys(): Array<{
    pluginId: string;
    integrationKey: string;
  }> {
    const results: Array<{ pluginId: string; integrationKey: string }> = [];

    if (!existsSync(pluginsDir)) return results;

    const pluginDirs = readdirSync(pluginsDir, { withFileTypes: true }).filter(
      (d) => d.isDirectory(),
    );

    for (const dir of pluginDirs) {
      const manifestPath = join(pluginsDir, dir.name, 'manifest.ts');
      if (!existsSync(manifestPath)) continue;

      const content = readFileSync(manifestPath, 'utf-8');

      // Extract integration keys using regex — avoids importing NestJS modules
      const keyMatches = content.matchAll(/key:\s*['"]([^'"]+)['"]/g);
      for (const match of keyMatches) {
        results.push({ pluginId: dir.name, integrationKey: match[1] });
      }
    }

    return results;
  }

  /** Get all integration keys registered in canary test files */
  function getCanaryIntegrationKeys(): string[] {
    if (!existsSync(canaryDir)) return [];

    const canaryFiles = readdirSync(canaryDir).filter((f) =>
      f.endsWith('.canary.ts'),
    );

    const keys: string[] = [];

    for (const file of canaryFiles) {
      const content = readFileSync(join(canaryDir, file), 'utf-8');
      const keyMatches = content.matchAll(
        /integrationKey:\s*['"]([^'"]+)['"]/g,
      );
      for (const match of keyMatches) {
        keys.push(match[1]);
      }
    }

    return keys;
  }

  it('every plugin integration has a canary test', () => {
    const pluginIntegrations = getPluginIntegrationKeys();
    const canaryKeys = getCanaryIntegrationKeys();

    const missing = pluginIntegrations.filter(
      (pi) => !canaryKeys.includes(pi.integrationKey),
    );

    if (missing.length > 0) {
      const missingList = missing
        .map((m) => `  - ${m.pluginId}: ${m.integrationKey}`)
        .join('\n');
      fail(
        `The following plugin integrations are missing canary tests:\n${missingList}\n\n` +
          'Add a .canary.ts file in api/src/canary/ with a matching integrationKey.',
      );
    }
  });

  it('canary test files exist for discovered integration keys', () => {
    const canaryFiles = existsSync(canaryDir)
      ? readdirSync(canaryDir).filter((f) => f.endsWith('.canary.ts'))
      : [];

    // At minimum, we should have canary files
    expect(canaryFiles.length).toBeGreaterThan(0);
  });
}
describe('Canary coverage', () => describeCanaryCoverage());
