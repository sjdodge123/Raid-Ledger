import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { AiAdminController } from './ai-admin.controller';
import { LlmProviderRegistry } from './llm-provider-registry';
import { OllamaProvider } from './providers/ollama.provider';
import { LlmService } from './llm.service';
import { AiRequestLogService } from './ai-request-log.service';
import { AI_MANIFEST } from './ai-manifest';

/**
 * AI module — registers the AI plugin manifest and wires up
 * the LLM provider infrastructure.
 */
@Module({
  imports: [SettingsModule, DrizzleModule],
  controllers: [AiAdminController],
  providers: [
    LlmProviderRegistry,
    OllamaProvider,
    LlmService,
    AiRequestLogService,
  ],
  exports: [LlmService],
})
export class AiModule implements OnModuleInit {
  private readonly logger = new Logger(AiModule.name);

  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly providerRegistry: LlmProviderRegistry,
    private readonly ollamaProvider: OllamaProvider,
  ) {}

  /** Register manifest and providers on startup. */
  onModuleInit(): void {
    this.pluginRegistry.registerManifest(AI_MANIFEST);
    this.providerRegistry.register(this.ollamaProvider);
    this.logger.log('AI plugin registered (manifest + Ollama provider)');
  }
}
