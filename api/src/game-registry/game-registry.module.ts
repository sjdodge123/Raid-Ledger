import { Module } from '@nestjs/common';
import { GameRegistryService } from './game-registry.service';
import { GameRegistryController } from './game-registry.controller';

@Module({
  controllers: [GameRegistryController],
  providers: [GameRegistryService],
  exports: [GameRegistryService],
})
export class GameRegistryModule {}
