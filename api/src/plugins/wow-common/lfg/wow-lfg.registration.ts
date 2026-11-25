/**
 * ROK-2352 §5 — the WoW instance-LFG Nest classes, spread into
 * `WowCommonModule` (keeps it under the 300-line limit), and the provider
 * that registers the adapter once per WoW slug (owner `blizzard`, manifest
 * `lfg-grouping` `wow-instance-lfg`).
 *
 * It registers itself in `onModuleInit`, like the GG card: an owner-tagged
 * adapter is suspended on deactivate and restored on activate by the
 * registry (uninstall does not drop it), so one registration is enough.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { EXTENSION_POINTS } from '../../plugin-host/extension-points';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { ALL_WOW_GAME_SLUGS, WOW_COMMON_MANIFEST } from '../manifest';
import { WowLfgGroupingAdapter } from './wow-lfg-grouping.adapter';
import { WowLfgController } from './wow-lfg.controller';

@Injectable()
export class WowLfgRegistration implements OnModuleInit {
  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly lfgGrouping: WowLfgGroupingAdapter,
  ) {}

  onModuleInit(): void {
    this.register();
  }

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

/** The adapter and its self-registration. */
export const PROVIDERS = [WowLfgGroupingAdapter, WowLfgRegistration];

/** `plugins/wow/lfg` — last-detail pre-fill + per-hand detail edit. */
export const CONTROLLERS = [WowLfgController];
