import { Module } from '@nestjs/common';
import { SettingsModule } from '../../../settings/settings.module';
import { GgComputeService } from './gg-compute.service';
import { GgController } from './gg.controller';
import { GgPublicController } from './gg-public.controller';
import { GgShareCardService } from './share/gg-share-card.service';

/**
 * ROK-2187 — Core's GG <year> snapshot compute + owner/public read API.
 * `GgCardRegistry` comes from the global `GgCardModule`.
 */
@Module({
  imports: [SettingsModule],
  controllers: [GgController, GgPublicController],
  providers: [GgComputeService, GgShareCardService],
  exports: [GgComputeService],
})
export class GgModule {}
