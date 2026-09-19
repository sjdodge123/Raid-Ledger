import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ClientUrlSeederService } from './client-url-seeder.service';
import { SettingsService } from './settings.service';

@Module({
  imports: [DrizzleModule],
  providers: [SettingsService, ClientUrlSeederService],
  exports: [SettingsService],
})
export class SettingsModule {}
