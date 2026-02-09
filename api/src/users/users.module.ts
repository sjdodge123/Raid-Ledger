import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { PreferencesService } from './preferences.service';
import { UsersController } from './users.controller';
import { CharactersModule } from '../characters/characters.module';

@Module({
  imports: [forwardRef(() => CharactersModule)],
  controllers: [UsersController],
  providers: [UsersService, PreferencesService],
  exports: [UsersService, PreferencesService],
})
export class UsersModule { }
