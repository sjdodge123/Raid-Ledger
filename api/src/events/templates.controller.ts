import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TemplatesService } from './templates.service';
import {
  CreateTemplateSchema,
  TemplateResponseDto,
  TemplateListResponseDto,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { handleValidationError } from '../common/validation.util';

@Controller('event-templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<TemplateResponseDto> {
    try {
      const dto = CreateTemplateSchema.parse(body);
      return this.templatesService.create(req.user.id, dto);
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async findAll(
    @Request() req: AuthenticatedRequest,
  ): Promise<TemplateListResponseDto> {
    return this.templatesService.findAllByUser(req.user.id);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async delete(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.templatesService.delete(id, req.user.id);
  }
}
