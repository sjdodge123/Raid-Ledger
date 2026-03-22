import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  CreateLineupSchema,
  UpdateLineupStatusSchema,
  type LineupDetailResponseDto,
} from '@raid-ledger/contract';
import { LineupsService } from './lineups.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string };
}

@Controller('lineups')
@UseGuards(AuthGuard('jwt'))
export class LineupsController {
  constructor(private readonly lineupsService: LineupsService) {}

  /** POST /lineups — create a new lineup (operator/admin). */
  @Post()
  @UseGuards(RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = CreateLineupSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.create(parsed.data, req.user.id);
  }

  /** GET /lineups/active — current active lineup. */
  @Get('active')
  async getActive(): Promise<LineupDetailResponseDto> {
    return this.lineupsService.findActive();
  }

  /** GET /lineups/:id — lineup detail by ID. */
  @Get(':id')
  async getById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LineupDetailResponseDto> {
    return this.lineupsService.findById(id);
  }

  /** PATCH /lineups/:id/status — transition status (operator/admin). */
  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('operator')
  async transitionStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<LineupDetailResponseDto> {
    const parsed = UpdateLineupStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.transitionStatus(id, parsed.data);
  }
}
