import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { AiAdminController } from './ai-admin.controller';
import { AiProvidersController } from './ai-providers.controller';
import { LlmProviderRegistry } from './llm-provider-registry';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { GoogleProvider } from './providers/google.provider';
import { OllamaDockerService } from './providers/ollama-docker.service';
import { OllamaModelService } from './providers/ollama-model.service';
import { OllamaSetupService } from './providers/ollama-setup.service';
import { LlmService } from './llm.service';
import { AiRequestLogService } from './ai-request-log.service';
import { AI_MANIFEST } from './ai-manifest';

/**
 * AI module — registers the AI plugin manifest and wires up
 * the LLM provider infrastructure for all 4 providers.
 */
@Module({
  imports: [SettingsModule, DrizzleModule],
  controllers: [AiAdminController, AiProvidersController],
  providers: [
    LlmProviderRegistry,
    OllamaProvider,
    OpenAiProvider,
    ClaudeProvider,
    GoogleProvider,
    OllamaDockerService,
    OllamaModelService,
    OllamaSetupService,
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
    private readonly openaiProvider: OpenAiProvider,
    private readonly claudeProvider: ClaudeProvider,
    private readonly googleProvider: GoogleProvider,
  ) {}

  /** Register manifest and all providers on startup. */
  onModuleInit(): void {
    this.pluginRegistry.registerManifest(AI_MANIFEST);
    this.providerRegistry.register(this.ollamaProvider);
    this.providerRegistry.register(this.openaiProvider);
    this.providerRegistry.register(this.claudeProvider);
    this.providerRegistry.register(this.googleProvider);
    this.logger.log('AI plugin registered (manifest + 4 providers)');
  }
}
