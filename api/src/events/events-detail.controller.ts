import {
  Controller,
  Get,
  Param,
  Request,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { EventDetailService } from './event-detail.service';
import type {
  EventDetailResponseDto,
  PublicEventDetailResponseDto,
} from '@raid-ledger/contract';
import type { AuthenticatedUser } from '../auth/types';

@Controller('events')
export class EventsDetailController {
  constructor(private readonly eventDetailService: EventDetailService) {}

  @Get(':id/detail')
  @UseGuards(OptionalJwtGuard)
  async findOneDetail(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: AuthenticatedUser },
  ): Promise<EventDetailResponseDto | PublicEventDetailResponseDto> {
    // ROK-1629: the service projects the bundle per viewer (deactivated = anon).
    return this.eventDetailService.findDetail(id, req.user ?? null);
  }
}
