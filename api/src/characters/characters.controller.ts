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
  ImportWowCharacterSchema,
  RefreshCharacterSchema,
  CharacterListQuerySchema,
  CharacterDto,
  CharacterListResponseDto,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';
import {
  RequirePlugin,
  PluginActiveGuard,
} from '../plugins/plugin-host/plugin-active.guard';

import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: {
    id: number;
    role: UserRole;
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
 *
 * IMPORTANT: Static routes (import/wow) must be declared before parameterized
 * routes (:id) to prevent NestJS from treating "import" as a UUID parameter.
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
    @Query() query: Record<string, string>,
  ): Promise<CharacterListResponseDto> {
    try {
      const { gameId } = CharacterListQuerySchema.parse(query);
      return this.charactersService.findAllForUser(req.user.id, gameId);
    } catch (error) {
      handleValidationError(error);
    }
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
   * Import a character from an external game API via adapter (ROK-234, ROK-237).
   * Must be declared before :id routes.
   * Requires blizzard plugin active (ROK-242).
   */
  @Post('import/wow')
  @RequirePlugin('blizzard')
  @UseGuards(PluginActiveGuard)
  async importFromWow(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<CharacterDto> {
    try {
      const dto = ImportWowCharacterSchema.parse(body);
      return this.charactersService.importExternal(req.user.id, dto);
    } catch (error) {
      handleValidationError(error);
    }
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
   * Refresh a character's data from an external game API via adapter (ROK-234, ROK-237).
   * Requires blizzard plugin active (ROK-242).
   */
  @Post(':id/refresh')
  @RequirePlugin('blizzard')
  @UseGuards(PluginActiveGuard)
  async refreshFromArmory(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<CharacterDto> {
    try {
      const dto = RefreshCharacterSchema.parse(body);
      return this.charactersService.refreshExternal(req.user.id, id, dto);
    } catch (error) {
      handleValidationError(error);
    }
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
