/**
 * Tiebreaker NestJS module (ROK-938).
 *
 * Imports `LineupsModule` (forwardRef'd to break the cycle with
 * lineups → tiebreaker) so `TiebreakerService` can inject
 * `LineupNotificationService` and `LineupsGateway` for the open-
 * notification dispatch path (ROK-1117).
 */
import { Module, forwardRef } from '@nestjs/common';
import { TiebreakerController } from './tiebreaker.controller';
import { TiebreakerService } from './tiebreaker.service';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { LineupsModule } from '../lineups.module';

@Module({
  imports: [DrizzleModule, forwardRef(() => LineupsModule)],
  controllers: [TiebreakerController],
  providers: [TiebreakerService],
  exports: [TiebreakerService],
})
export class TiebreakerModule {}
