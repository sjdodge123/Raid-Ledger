import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { GitHubService } from './github.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [DrizzleModule, SettingsModule],
  controllers: [FeedbackController],
  providers: [GitHubService],
  exports: [GitHubService],
})
export class FeedbackModule {}
