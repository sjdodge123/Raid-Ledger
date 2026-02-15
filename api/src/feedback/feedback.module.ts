import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { DrizzleModule } from '../drizzle/drizzle.module';

@Module({
  imports: [DrizzleModule],
  controllers: [FeedbackController],
})
export class FeedbackModule {}
