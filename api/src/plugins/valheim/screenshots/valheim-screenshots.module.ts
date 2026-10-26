import { Module, type OnModuleInit } from '@nestjs/common';
import { DrizzleModule } from '../../../drizzle/drizzle.module';
import { HubMediaPostClassifierRegistry } from '../../../hub-media/hub-media-classifier.registry';
import { HubMediaModule } from '../../../hub-media/hub-media.module';
import { ValheimDeathLinkRepository } from './valheim-death-link.repository';
import { ValheimScreenshotClassifier } from './valheim-screenshot.classifier';

/**
 * ROK-1941 — the Valheim screenshot mod's side of hub media: registers its
 * classifier on the core port (D3) so core never imports this plugin.
 */
@Module({
  imports: [DrizzleModule, HubMediaModule],
  providers: [ValheimDeathLinkRepository, ValheimScreenshotClassifier],
  exports: [ValheimDeathLinkRepository],
})
export class ValheimScreenshotsModule implements OnModuleInit {
  constructor(
    private readonly registry: HubMediaPostClassifierRegistry,
    private readonly classifier: ValheimScreenshotClassifier,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.classifier);
  }
}
