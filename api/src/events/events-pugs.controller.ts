import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import { PugsService } from './pugs.service';
import {
  CreatePugSlotSchema,
  UpdatePugSlotSchema,
  PugSlotResponseDto,
  PugSlotListResponseDto,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { handleValidationError, isOperatorOrAdmin } from './controller.helpers';

@Controller('events')
export class EventsPugsController {
  constructor(private readonly pugsService: PugsService) {}

  @Post(':id/pugs')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async createPug(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<PugSlotResponseDto> {
    try {
      const dto = CreatePugSlotSchema.parse(body);
      return this.pugsService.create(
        eventId,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Get(':id/pugs')
  async listPugs(
    @Param('id', ParseIntPipe) eventId: number,
  ): Promise<PugSlotListResponseDto> {
    return this.pugsService.findAll(eventId);
  }

  @Patch(':id/pugs/:pugId')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async updatePug(
    @Param('id', ParseIntPipe) eventId: number,
    @Param('pugId', ParseUUIDPipe) pugId: string,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<PugSlotResponseDto> {
    try {
      const dto = UpdatePugSlotSchema.parse(body);
      return this.pugsService.update(
        eventId,
        pugId,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Post(':id/pugs/:pugId/regenerate-code')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async regeneratePugInviteCode(
    @Param('id', ParseIntPipe) eventId: number,
    @Param('pugId', ParseUUIDPipe) pugId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<PugSlotResponseDto> {
    return this.pugsService.regenerateInviteCode(
      eventId,
      pugId,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
  }

  @Delete(':id/pugs/:pugId')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async deletePug(
    @Param('id', ParseIntPipe) eventId: number,
    @Param('pugId', ParseUUIDPipe) pugId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    await this.pugsService.remove(
      eventId,
      pugId,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
    return { message: 'PUG slot removed successfully' };
  }
}
