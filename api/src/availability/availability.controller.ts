import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AvailabilityService } from './availability.service';
import {
  CreateAvailabilityInputSchema,
  UpdateAvailabilityDtoSchema,
  AvailabilityQuerySchema,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { handleValidationError } from '../common/validation.util';

/**
 * Controller for user availability management (ROK-112).
 * All endpoints are scoped to the authenticated user.
 */
@Controller('users/me/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  /**
   * List all availability windows for the current user.
   */
  @Get()
  @UseGuards(AuthGuard('jwt'))
  async findAll(
    @Request() req: AuthenticatedRequest,
    @Query() query: Record<string, string>,
  ) {
    try {
      const parsed = AvailabilityQuerySchema.parse(query);
      return this.availabilityService.findAllForUser(req.user.id, parsed);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Get a specific availability window.
   */
  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  async findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.availabilityService.findOne(req.user.id, id);
  }

  /**
   * Create a new availability window.
   */
  @Post()
  @UseGuards(AuthGuard('jwt'))
  async create(@Request() req: AuthenticatedRequest, @Body() body: unknown) {
    try {
      const dto = CreateAvailabilityInputSchema.parse(body);
      return this.availabilityService.create(req.user.id, dto);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Update an existing availability window.
   */
  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    try {
      const dto = UpdateAvailabilityDtoSchema.parse(body);
      return this.availabilityService.update(req.user.id, id, dto);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Delete an availability window.
   */
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async delete(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.availabilityService.delete(req.user.id, id);
    return { success: true };
  }
}
