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
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TemplatesService } from './templates.service';
import {
  CreateTemplateSchema,
  TemplateResponseDto,
  TemplateListResponseDto,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';

import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number; role: UserRole };
}

function handleValidationError(error: unknown): never {
  if (error instanceof Error && error.name === 'ZodError') {
    const zodError = error as ZodError;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: zodError.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  throw error;
}

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
