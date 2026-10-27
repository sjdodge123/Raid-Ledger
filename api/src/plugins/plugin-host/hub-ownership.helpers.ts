/**
 * ROK-1969 — hub ownership + built-in plugin rules for PluginRegistryService.
 * Kept out of the service for file size; every rule is a pure function.
 */
import { BadRequestException } from '@nestjs/common';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import {
  HUB_EXTENSION_POINTS,
  type HubExtensionPoint,
} from './extension-points';
import type { AdapterRegistrationOptions } from './plugin-adapter-store';
import type { PluginManifest } from './plugin-manifest.interface';

/** Registration options for a hub extension point: the owner is required. */
export type HubAdapterRegistrationOptions = AdapterRegistrationOptions & {
  ownerPluginId: string;
};

/** The options tuple `registerAdapter` takes for `P` (D5 type overload). */
export type AdapterOptionsFor<P extends string> = P extends HubExtensionPoint
  ? [opts: HubAdapterRegistrationOptions]
  : [opts?: AdapterRegistrationOptions];

/** Who owns one hub adapter registration — checked against the manifests. */
export interface HubOwnerRecord {
  point: string;
  key: string;
  ownerPluginId: string;
}

const HUB_POINTS: ReadonlySet<string> = new Set(HUB_EXTENSION_POINTS);

/** True for a plugin that can never be off (Core, D3). */
export function isAlwaysActive(slug: string): boolean {
  return slug === CORE_PLUGIN_ID;
}

/**
 * The owner record for a hub point registration, `null` for a non-hub point.
 * Throws for a hub point with no owner — the type overload alone cannot stop
 * an `as` cast or a caller passing a plain `string` point.
 */
export function hubOwnerFor(
  point: string,
  key: string,
  opts: AdapterRegistrationOptions | undefined,
): HubOwnerRecord | null {
  if (!HUB_POINTS.has(point)) return null;
  const ownerPluginId = opts?.ownerPluginId;
  if (!ownerPluginId) {
    throw new Error(`Hub extension point "${point}" needs an owner plugin`);
  }
  return { point, key, ownerPluginId };
}

/** Throws naming the first hub owner that has no registered manifest. */
export function assertHubOwnersKnown(
  records: readonly HubOwnerRecord[],
  hasManifest: (pluginId: string) => boolean,
): void {
  for (const { ownerPluginId } of records) {
    if (isAlwaysActive(ownerPluginId) || hasManifest(ownerPluginId)) continue;
    throw new Error(
      `Owner plugin "${ownerPluginId}" has no registered manifest`,
    );
  }
}

/** 400 when `slug` is a built-in plugin (Core is built in even unregistered). */
export function assertNotBuiltIn(
  slug: string,
  manifest: PluginManifest | undefined,
  action: 'deactivated' | 'uninstalled',
): void {
  if (!isAlwaysActive(slug) && manifest?.builtIn !== true) return;
  throw new BadRequestException(
    `Plugin "${slug}" is built in and cannot be ${action}`,
  );
}
