import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminSettingsController } from './settings.controller';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SettingsModule, AuthModule],
  controllers: [AdminController, AdminSettingsController],
})
export class AdminModule {}
