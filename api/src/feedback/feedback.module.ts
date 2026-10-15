import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackScreenshotCleanupListener } from './feedback-screenshot-cleanup.listener';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { SlowQueriesModule } from '../slow-queries/slow-queries.module';

@Module({
  imports: [DrizzleModule, SlowQueriesModule],
  controllers: [FeedbackController],
  providers: [FeedbackScreenshotCleanupListener],
})
export class FeedbackModule {}
