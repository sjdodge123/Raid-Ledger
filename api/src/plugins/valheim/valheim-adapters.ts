import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  EXTENSION_POINTS,
  type GameLogParser,
} from '../plugin-host/extension-points';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from './valheim.constants';
import { parseValheimLine } from './valheim-presence.parser';

/** The Valheim `game-log-parser` adapter — a stateless wrapper over the pure parser. */
export const VALHEIM_LOG_PARSER: GameLogParser = {
  pluginSlug: VALHEIM_PLUGIN_ID,
  parse: parseValheimLine,
};

/**
 * Registers the Valheim log parser under its game slug, owned by the plugin
 * id so the registry suspends it while the plugin is inactive (as Pelican's
 * adapters are).
 */
@Injectable()
export class ValheimAdapterRegistration implements OnModuleInit {
  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.registerAdapter(
      EXTENSION_POINTS.GAME_LOG_PARSER,
      VALHEIM_GAME_SLUG,
      VALHEIM_LOG_PARSER,
      { ownerPluginId: VALHEIM_PLUGIN_ID },
    );
  }
}
