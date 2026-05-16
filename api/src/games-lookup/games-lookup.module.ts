import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ItadModule } from '../itad/itad.module';
import { IgdbModule } from '../igdb/igdb.module';
import { GamesLookupController } from './games-lookup.controller';
import { GamesLookupService } from './games-lookup.service';

@Module({
  imports: [DrizzleModule, ItadModule, IgdbModule],
  controllers: [GamesLookupController],
  providers: [GamesLookupService],
})
export class GamesLookupModule {}
