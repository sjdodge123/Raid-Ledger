import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SetupClaimController } from './setup-claim.controller';
import { SetupClaimService } from './setup-claim.service';
import { ClaimLockService } from './claim-lock.service';

/**
 * ROK-1701: first-visit claim. `ClaimLockService` is in-memory, so it must be
 * ONE instance shared by the endpoint and the DEMO_MODE fixture (AdminModule
 * imports this module). Only AppModule imports SystemModule/AdminModule, so
 * importing AuthModule here adds no cycle.
 */
@Module({
  imports: [AuthModule],
  controllers: [SetupClaimController],
  providers: [SetupClaimService, ClaimLockService],
  exports: [SetupClaimService, ClaimLockService],
})
export class SetupClaimModule {}
