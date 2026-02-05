import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from './drizzle/drizzle.module';
import { ConfigModule } from '@nestjs/config';

import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { IgdbModule } from './igdb/igdb.module';
import { EventsModule } from './events/events.module';
import { GameRegistryModule } from './game-registry/game-registry.module';
import { CharactersModule } from './characters/characters.module';
import { AvailabilityModule } from './availability/availability.module';
import { RedisModule } from './redis/redis.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DrizzleModule,
    RedisModule,
    UsersModule,
    AuthModule,
    AdminModule,
    IgdbModule,
    EventsModule,
    GameRegistryModule,
    CharactersModule,
    AvailabilityModule,
    SystemModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
