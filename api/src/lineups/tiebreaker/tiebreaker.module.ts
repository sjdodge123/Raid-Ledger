/**
 * Tiebreaker NestJS module (ROK-938).
 */
import { Module } from '@nestjs/common';
import { TiebreakerController } from './tiebreaker.controller';
import { TiebreakerService } from './tiebreaker.service';
import { DrizzleModule } from '../../drizzle/drizzle.module';

@Module({
  imports: [DrizzleModule],
  controllers: [TiebreakerController],
  providers: [TiebreakerService],
  exports: [TiebreakerService],
})
export class TiebreakerModule {}
