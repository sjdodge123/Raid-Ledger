import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import {
  EXTENSION_POINTS,
  GAME_SERVER_PROVIDER_KEY,
} from '../plugin-host/extension-points';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import { PelicanCronRegistrar } from './pelican-cron.registrar';
import { PelicanGameServerProvider } from './pelican-game-server.provider';
import { PelicanHubKindAdapter } from './hub/pelican-hub-kind.adapter';

/**
 * Registers Pelican's cron registrar and game-server provider, both owned by
 * the plugin id (ROK-1772 D8) — the registry suspends them on deactivate and
 * restores them on activate. Kept out of `PelicanModule` to keep it small.
 */
@Injectable()
export class PelicanAdapterRegistration implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly cron: PelicanCronRegistrar,
    private readonly provider: PelicanGameServerProvider,
    @Optional()
    @Inject(PelicanHubKindAdapter)
    private readonly hubKind: PelicanHubKindAdapter | null = null,
  ) {}

  onModuleInit(): void {
    const opts = { ownerPluginId: PELICAN_PLUGIN_ID };
    this.registry.registerAdapter(
      EXTENSION_POINTS.CRON_REGISTRAR,
      PELICAN_PLUGIN_ID,
      this.cron,
      opts,
    );
    this.registry.registerMultiAdapter(
      EXTENSION_POINTS.GAME_SERVER_PROVIDER,
      GAME_SERVER_PROVIDER_KEY,
      this.provider,
      opts,
    );
    // ROK-1831 L-1: Pelican owns the `game_server` hub kind.
    if (this.hubKind) {
      this.registry.registerAdapter(
        EXTENSION_POINTS.HUB_KIND,
        this.hubKind.kind,
        this.hubKind,
        opts,
      );
    }
  }
}
