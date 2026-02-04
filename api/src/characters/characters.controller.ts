import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CharactersService } from './characters.service';
import {
  CreateCharacterSchema,
  UpdateCharacterSchema,
  CharacterDto,
  CharacterListResponseDto,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';

interface AuthenticatedRequest {
  user: {
    id: number;
    isAdmin: boolean;
  };
}

/**
 * Handle Zod validation errors by converting to BadRequestException.
 */
function handleValidationError(error: unknown): never {
  if (error instanceof ZodError) {
    throw new BadRequestException({
      message: 'Validation failed',
      errors: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  throw error;
}

/**
 * Controller for character management (ROK-130).
 * All endpoints require authentication and operate on the current user's characters.
 */
@Controller('users/me/characters')
@UseGuards(AuthGuard('jwt'))
export class CharactersController {
  constructor(private readonly charactersService: CharactersService) {}

  /**
   * Get all characters for the authenticated user.
   * Optionally filter by gameId for signup confirmation (ROK-131).
   */
  @Get()
  async findAll(
    @Request() req: AuthenticatedRequest,
    @Query('gameId') gameId?: string,
  ): Promise<CharacterListResponseDto> {
    return this.charactersService.findAllForUser(req.user.id, gameId);
  }

  /**
   * Get a single character by ID.
   */
  @Get(':id')
  async findOne(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CharacterDto> {
    return this.charactersService.findOne(req.user.id, id);
  }

  /**
   * Create a new character.
   */
  @Post()
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<CharacterDto> {
    try {
      const dto = CreateCharacterSchema.parse(body);
      return this.charactersService.create(req.user.id, dto);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Update a character.
   */
  @Patch(':id')
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<CharacterDto> {
    try {
      const dto = UpdateCharacterSchema.parse(body);
      return this.charactersService.update(req.user.id, id, dto);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Delete a character.
   */
  @Delete(':id')
  async delete(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    await this.charactersService.delete(req.user.id, id);
    return { message: 'Character deleted successfully' };
  }

  /**
   * Set a character as the main for its game.
   * Automatically demotes any existing main.
   */
  @Patch(':id/set-main')
  async setMain(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CharacterDto> {
    return this.charactersService.setMain(req.user.id, id);
  }
}
