import { Module } from '@nestjs/common';
import { CompanionDevicesModule } from './devices/companion-devices.module';
import { CompanionIngestModule } from './ingest/companion-ingest.module';

/** ROK-1955 / ROK-1969: Companion is Core platform, not a game plugin. */
@Module({ imports: [CompanionDevicesModule, CompanionIngestModule] })
export class CompanionModule {}
