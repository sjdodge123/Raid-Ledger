import { Module } from '@nestjs/common';
import { CharactersController } from './characters.controller';
import { CharacterDetailController } from './character-detail.controller';
import { CharactersService } from './characters.service';
import { CharacterSyncService } from './character-sync.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { BlizzardModule } from '../blizzard/blizzard.module';

@Module({
  imports: [DrizzleModule, BlizzardModule],
  controllers: [CharactersController, CharacterDetailController],
  providers: [CharactersService, CharacterSyncService],
  exports: [CharactersService],
})
export class CharactersModule {}
