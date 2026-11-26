import { Module } from '@nestjs/common';
import { HubBearerGuard } from '../auth/bearer.guard';
import { InstancesRepository } from '../instances/instances.repository';
import { ContributionsController } from './contributions.controller';
import { ContributorGuard } from './contributor.guard';
import { CrosswalkLock } from './crosswalk-lock';
import { CrosswalkMatcherService } from './crosswalk-matcher.service';

/** Crosswalk store + matcher (ROK-1673) and the contributions endpoint (ROK-1674). */
@Module({
  controllers: [ContributionsController],
  providers: [
    CrosswalkLock,
    CrosswalkMatcherService,
    InstancesRepository,
    HubBearerGuard,
    ContributorGuard,
  ],
  exports: [CrosswalkMatcherService],
})
export class CrosswalkModule {}
