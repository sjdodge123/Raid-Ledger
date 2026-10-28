import { Injectable } from '@nestjs/common';
import type { HubMediaItem } from '@raid-ledger/contract';
import type { HubMediaRow } from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

/** A source's own link for an item, e.g. ROK-1941/1931 "Show on map" (D9). */
export type HubMediaDecorator = (row: HubMediaRow) => HubMediaItem['link'];

/**
 * ROK-1942 D9 — source-specific display stays server-side: a source module
 * registers a decorator; the first non-null link wins. v1 registers none,
 * so the widget never needs source-specific code. ROK-1969 D5: each
 * decorator names its owner plugin and is skipped while that plugin is off.
 * ROK-1941's classifier registry copies this `register(owner, fn)` shape.
 */
interface OwnedDecorator {
  ownerPluginId: string;
  decorate: HubMediaDecorator;
}

@Injectable()
export class HubMediaDecoratorRegistry {
  private readonly decorators: OwnedDecorator[] = [];

  constructor(private readonly plugins: PluginRegistryService) {}

  /** Register `decorator` for `ownerPluginId` (a plugin slug, or `core`). */
  register(ownerPluginId: string, decorator: HubMediaDecorator): void {
    this.decorators.push({ ownerPluginId, decorate: decorator });
  }

  linkFor(row: HubMediaRow): HubMediaItem['link'] {
    for (const { ownerPluginId, decorate } of this.decorators) {
      if (!this.plugins.isActive(ownerPluginId)) continue;
      const link = decorate(row);
      if (link) return link;
    }
    return null;
  }
}
