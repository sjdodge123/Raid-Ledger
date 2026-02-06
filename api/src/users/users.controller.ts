import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CharactersService } from '../characters/characters.service';
import { UserProfileDto } from '@raid-ledger/contract';

/**
 * Controller for public user profile endpoints (ROK-181).
 * No authentication required - these are public profiles.
 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly charactersService: CharactersService,
  ) {}

  /**
   * Get a user's public profile by ID.
   * Returns username, avatar, member since, and public characters.
   */
  @Get(':id/profile')
  async getProfile(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ data: UserProfileDto }> {
    const user = await this.usersService.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get user's characters (public data)
    const charactersResult = await this.charactersService.findAllForUser(id);

    return {
      data: {
        id: user.id,
        username: user.username,
        avatar: user.avatar || null,
        createdAt: user.createdAt.toISOString(),
        characters: charactersResult.data,
      },
    };
  }
}
