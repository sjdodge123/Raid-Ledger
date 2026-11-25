/**
 * ROK-2352 §5 — registers the WoW instance-LFG adapter once per WoW slug
 * (owner `blizzard`, manifest `lfg-grouping` `wow-instance-lfg`). Called from
 * `WowCommonModule.registerAdapters`, so it re-registers with the others.
 */
import { Injectable } from '@nestjs/common';
import { EXTENSION_POINTS } from '../../plugin-host/extension-points';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { ALL_WOW_GAME_SLUGS, WOW_COMMON_MANIFEST } from '../manifest';
import { WowLfgGroupingAdapter } from './wow-lfg-grouping.adapter';

@Injectable()
export class WowLfgRegistration {
  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly lfgGrouping: WowLfgGroupingAdapter,
  ) {}

  /** One `lfg-grouping` registration per WoW slug; suspends with `blizzard`. */
  register(): void {
    for (const slug of ALL_WOW_GAME_SLUGS) {
      this.pluginRegistry.registerAdapter(
        EXTENSION_POINTS.LFG_GROUPING,
        slug,
        this.lfgGrouping,
        { ownerPluginId: WOW_COMMON_MANIFEST.id },
      );
    }
  }
}
