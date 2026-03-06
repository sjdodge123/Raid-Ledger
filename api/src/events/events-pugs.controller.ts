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
import { PugsService } from './pugs.service';
import {
  CreatePugSlotSchema,
  UpdatePugSlotSchema,
  PugSlotResponseDto,
  PugSlotListResponseDto,
} from '@raid-ledger/contract';
import { handleValidationError, isOperatorOrAdmin } from './controller.helpers';

interface AuthenticatedRequest {
  user: { id: number; role: import('@raid-ledger/contract').UserRole };
}

@Controller('events')
export class EventsPugsController {
  constructor(private readonly pugsService: PugsService) {}

  @Post(':id/pugs')
  @UseGuards(AuthGuard('jwt'))
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
  @UseGuards(AuthGuard('jwt'))
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
  @UseGuards(AuthGuard('jwt'))
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
  @UseGuards(AuthGuard('jwt'))
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
