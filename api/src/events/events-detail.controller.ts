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
import type { EventDetailResponseDto } from '@raid-ledger/contract';

@Controller('events')
export class EventsDetailController {
  constructor(private readonly eventDetailService: EventDetailService) {}

  @Get(':id/detail')
  @UseGuards(OptionalJwtGuard)
  async findOneDetail(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: { id: number } },
  ): Promise<EventDetailResponseDto> {
    return this.eventDetailService.findDetail(id, req.user?.id ?? null);
  }
}
