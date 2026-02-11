import { Module } from '@nestjs/common';
import { BlizzardService } from './blizzard.service';
import { BlizzardController } from './blizzard.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [BlizzardController],
  providers: [BlizzardService],
  exports: [BlizzardService],
})
export class BlizzardModule {}
