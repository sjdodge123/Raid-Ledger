/**
 * Plugin registry query helpers.
 * Extracted from plugin-registry.service.ts for file size compliance (ROK-711).
 */
import { eq, inArray } from 'drizzle-orm';
import { BadRequestException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { plugins, appSettings } from '../../drizzle/schema';
import type { PluginManifest } from './plugin-manifest.interface';
import type { PluginIntegrationInfoDto } from '@raid-ledger/contract';

/** Resolve integration info for a plugin manifest, batch-fetching credential keys. */
export async function resolveIntegrationInfo(
  db: PostgresJsDatabase<typeof schema>,
  manifest: PluginManifest,
): Promise<PluginIntegrationInfoDto[]> {
  if (!manifest.integrations?.length) return [];

  const allCredentialKeys = manifest.integrations.flatMap(
    (i) => i.credentialKeys,
  );
  const existingKeys = new Set<string>();
  if (allCredentialKeys.length > 0) {
    const rows = await db
      .select({ key: appSettings.key })
      .from(appSettings)
      .where(inArray(appSettings.key, allCredentialKeys));
    for (const row of rows) existingKeys.add(row.key);
  }

  return manifest.integrations.map((integration) => ({
    key: integration.key,
    name: integration.name,
    description: integration.description,
    icon: integration.icon,
    configured: integration.credentialKeys.every((k) => existingKeys.has(k)),
    credentialLabels: integration.credentialLabels,
  }));
}

/** Clean up settings and credential keys for an uninstalled plugin. */
export async function cleanupPluginSettings(
  db: PostgresJsDatabase<typeof schema>,
  manifest: PluginManifest,
): Promise<number> {
  const keysToDelete: string[] = [...(manifest.settingKeys ?? [])];
  if (manifest.integrations) {
    for (const integration of manifest.integrations)
      keysToDelete.push(...integration.credentialKeys);
  }
  for (const key of keysToDelete) {
    await db.delete(appSettings).where(eq(appSettings.key, key));
  }
  return keysToDelete.length;
}

/** Validate that all plugin dependencies are installed. */
export async function validateDependencies(
  db: PostgresJsDatabase<typeof schema>,
  manifest: PluginManifest,
  slug: string,
): Promise<void> {
  if (!manifest.dependencies?.length) return;
  for (const dep of manifest.dependencies) {
    const depRecord = await db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, dep))
      .limit(1);
    if (depRecord.length === 0)
      throw new BadRequestException(
        `Dependency "${dep}" must be installed before "${slug}"`,
      );
  }
}
