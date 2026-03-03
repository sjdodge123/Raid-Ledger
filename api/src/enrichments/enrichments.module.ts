import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { PluginHostModule } from '../plugins/plugin-host/plugin-host.module';
import { ENRICHMENT_QUEUE } from './enrichments.constants';
import { EnrichmentsService } from './enrichments.service';
import { EnrichmentsProcessor } from './enrichments.processor';

@Module({
  imports: [
    DrizzleModule,
    PluginHostModule,
    BullModule.registerQueue({ name: ENRICHMENT_QUEUE }),
  ],
  providers: [EnrichmentsService, EnrichmentsProcessor],
  exports: [EnrichmentsService],
})
export class EnrichmentsModule {}
