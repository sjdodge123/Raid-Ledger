import { Injectable, Logger } from '@nestjs/common';
import {
  EXTENSION_POINTS,
  type HubClaimHubRef,
  type HubClaimProvider,
} from '../../plugins/plugin-host/extension-points';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';

const POINT = EXTENSION_POINTS.HUB_CLAIM_PROVIDER;

/**
 * ROK-2153 D2: core's view of the claim providers (one per plugin, keyed by
 * plugin slug). Only a provider whose owner plugin is ACTIVE can serve —
 * `getAdapter` hides suspended adapters. Two live providers claiming the same
 * hub is a misconfiguration: logged, and the hub gets none (404).
 */
@Injectable()
export class HubClaimRegistry {
  private readonly logger = new Logger(HubClaimRegistry.name);

  constructor(private readonly plugins: PluginRegistryService) {}

  /** The single live provider serving `hub`, or undefined. */
  forHub(hub: HubClaimHubRef): HubClaimProvider | undefined {
    const matches = this.liveProviders().filter((p) => p.supports(hub));
    if (matches.length <= 1) return matches[0];
    const slugs = matches.map((p) => p.pluginSlug).join(', ');
    this.logger.error(
      `Hub ${hub.id}: ${matches.length} claim providers (${slugs}); serving none`,
    );
    return undefined;
  }

  private liveProviders(): HubClaimProvider[] {
    const keys = this.plugins
      .getAdaptersForExtensionPoint<HubClaimProvider>(POINT)
      .keys();
    const live: HubClaimProvider[] = [];
    for (const key of keys) {
      const provider = this.plugins.getAdapter<HubClaimProvider>(POINT, key);
      if (provider !== undefined) live.push(provider);
    }
    return live;
  }
}
