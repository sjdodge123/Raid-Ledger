/**
 * External (Armory) import policy, resolved through the plugin-owned
 * character-identity providers (ROK-1722 on the ROK-1733 extension point).
 * With no active provider declaring a policy, every variant is allowed, every
 * linked row is bulk-synced and a realmless row has no refresh variant —
 * exactly the retail/classic behaviour.
 */
import type { ImportWowCharacterDto } from '@raid-ledger/contract';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { CharacterIdentityProvider } from '../plugins/plugin-host/extension-points';
import type { ExternalImportPolicy } from '../plugins/plugin-host/character-external-import.types';
import type { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

type Registry = Pick<
  PluginRegistryService,
  'getAdaptersForExtensionPoint' | 'isActive'
>;

/** The policy core applies when no provider declares one. */
export const NO_EXTERNAL_POLICY: ExternalImportPolicy = {
  assertAllowed: () => undefined,
  includeInBulkSync: () => true,
};

/** Distinct identity providers with external-import hooks, owning plugin active. */
export function externalImportProviders(
  registry: Registry,
): CharacterIdentityProvider[] {
  const all = registry.getAdaptersForExtensionPoint<CharacterIdentityProvider>(
    EXTENSION_POINTS.CHARACTER_IDENTITY,
  );
  const out = new Set<CharacterIdentityProvider>();
  for (const [, provider] of all) {
    if (typeof provider.externalImportPolicy !== 'function') continue;
    if (registry.isActive(provider.pluginSlug)) out.add(provider);
  }
  return [...out];
}

/** Combine several policies: every gate applies, every exclusion holds. */
export function combinePolicies(
  policies: readonly ExternalImportPolicy[],
): ExternalImportPolicy {
  const realmless = policies.find((p) => p.realmlessVariant)?.realmlessVariant;
  return {
    ...(realmless ? { realmlessVariant: realmless } : {}),
    assertAllowed: (variant) =>
      policies.forEach((p) => p.assertAllowed(variant)),
    includeInBulkSync: (variant) =>
      policies.every((p) => p.includeInBulkSync(variant)),
  };
}

/** Read the current policy of every active external-import provider. */
export async function loadExternalPolicy(
  registry: Registry,
): Promise<ExternalImportPolicy> {
  const providers = externalImportProviders(registry);
  if (providers.length === 0) return NO_EXTERNAL_POLICY;
  const policies = await Promise.all(
    providers.map(async (p) =>
      p.externalImportPolicy ? p.externalImportPolicy() : NO_EXTERNAL_POLICY,
    ),
  );
  return combinePolicies(policies);
}

/** The active provider that owns this import's identity, if any. */
export function externalImportOwner(
  registry: Registry,
  dto: ImportWowCharacterDto,
): CharacterIdentityProvider | undefined {
  return externalImportProviders(registry).find(
    (p) => p.ownsExternalImport?.(dto) === true,
  );
}
