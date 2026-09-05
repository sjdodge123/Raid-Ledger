import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ItadModule } from '../itad/itad.module';
import { IgdbModule } from '../igdb/igdb.module';
import { GamesLookupController } from './games-lookup.controller';
import { GamesLookupService } from './games-lookup.service';
import { InstallSizeController } from '../games/install-size.controller';
import { InstallSizeService } from '../games/install-size.service';

@Module({
  imports: [DrizzleModule, ItadModule, IgdbModule],
  // ROK-1374: the manual install-size write is a `/games` route, so it is
  // registered alongside the other `/games` controllers rather than in a
  // second module competing for the same prefix.
  controllers: [GamesLookupController, InstallSizeController],
  providers: [GamesLookupService, InstallSizeService],
})
export class GamesLookupModule {}
