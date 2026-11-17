import {
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import { PLUGIN_EVENTS } from '../plugin-host/plugin-manifest.interface';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { ensureMinecraftBedrockGame } from './minecraft-bedrock-game';
import { MINECRAFT_PLUGIN_ID } from './minecraft.constants';
import { MINECRAFT_MANIFEST } from './minecraft.manifest';

/**
 * Minecraft game plugin (ROK-2234). Registers its manifest (no
 * `ensureInstalled`, so an uninstall survives a restart) and, when it is
 * installed or activated, makes sure the Bedrock `games` row exists.
 */
@Module({})
export class MinecraftModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MinecraftModule.name);
  private readonly lifecycleHandler = (payload: { slug: string }): void => {
    if (payload.slug === MINECRAFT_PLUGIN_ID) void this.ensureBedrockRow();
  };

  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  onModuleInit(): void {
    this.pluginRegistry.registerManifest(MINECRAFT_MANIFEST);
    this.eventEmitter.on(PLUGIN_EVENTS.INSTALLED, this.lifecycleHandler);
    this.eventEmitter.on(PLUGIN_EVENTS.ACTIVATED, this.lifecycleHandler);
  }

  onModuleDestroy(): void {
    this.eventEmitter.removeListener(
      PLUGIN_EVENTS.INSTALLED,
      this.lifecycleHandler,
    );
    this.eventEmitter.removeListener(
      PLUGIN_EVENTS.ACTIVATED,
      this.lifecycleHandler,
    );
  }

  /** Logs only after the name-lock transaction has returned (committed). */
  private async ensureBedrockRow(): Promise<void> {
    try {
      const { id, action } = await ensureMinecraftBedrockGame(this.db);
      this.logger.log(`Minecraft Bedrock game row ${action} (id ${id})`);
    } catch (err) {
      this.logger.error(`Failed to ensure the Minecraft Bedrock game: ${err}`);
    }
  }
}
