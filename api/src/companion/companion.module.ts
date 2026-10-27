import { Module } from '@nestjs/common';
import { CompanionBlobsModule } from './blobs/companion-blobs.module';
import { CompanionConfigModule } from './config/companion-config.module';
import { CompanionDevicesModule } from './devices/companion-devices.module';
import { CompanionIngestModule } from './ingest/companion-ingest.module';

/** ROK-1955 / ROK-1969: Companion is Core platform, not a game plugin. */
@Module({
  imports: [
    CompanionDevicesModule,
    CompanionIngestModule,
    CompanionBlobsModule,
    CompanionConfigModule,
  ],
})
export class CompanionModule {}
