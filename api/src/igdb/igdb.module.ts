import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IgdbService } from './igdb.service';
import { IgdbController } from './igdb.controller';
import { DrizzleModule } from '../drizzle/drizzle.module';

@Module({
  imports: [ConfigModule, DrizzleModule],
  controllers: [IgdbController],
  providers: [IgdbService],
  exports: [IgdbService],
})
export class IgdbModule {}
