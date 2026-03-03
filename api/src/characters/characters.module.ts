import { Module } from '@nestjs/common';
import { CharactersController } from './characters.controller';
import { CharacterDetailController } from './character-detail.controller';
import { CharactersService } from './characters.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { EnrichmentsModule } from '../enrichments/enrichments.module';

@Module({
  imports: [DrizzleModule, EnrichmentsModule],
  controllers: [CharactersController, CharacterDetailController],
  providers: [CharactersService],
  exports: [CharactersService],
})
export class CharactersModule {}
