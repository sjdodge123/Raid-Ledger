import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { SettingsModule } from '../settings/settings.module';
import { RelayService } from './relay.service';
import { RelayController } from './relay.controller';

@Module({
  imports: [DrizzleModule, SettingsModule],
  controllers: [RelayController],
  providers: [RelayService],
  exports: [RelayService],
})
export class RelayModule {}
