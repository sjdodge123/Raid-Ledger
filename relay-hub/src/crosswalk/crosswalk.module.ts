import { Module } from '@nestjs/common';
import { CrosswalkLock } from './crosswalk-lock';
import { CrosswalkMatcherService } from './crosswalk-matcher.service';

/** Crosswalk store + matcher (ROK-1673); RH-4b adds the endpoint. */
@Module({
  providers: [CrosswalkLock, CrosswalkMatcherService],
  exports: [CrosswalkMatcherService],
})
export class CrosswalkModule {}
