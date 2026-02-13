import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import * as multer from 'multer';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { PreferencesService } from './preferences.service';
import { GameTimeService } from './game-time.service';
import { UsersController } from './users.controller';
import { CharactersModule } from '../characters/characters.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    forwardRef(() => CharactersModule),
    EventsModule,
    MulterModule.register({ storage: multer.memoryStorage() }),
  ],
  controllers: [UsersController],
  providers: [UsersService, AvatarService, PreferencesService, GameTimeService],
  exports: [UsersService, AvatarService, PreferencesService, GameTimeService],
})
export class UsersModule {}
