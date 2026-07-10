// Banner endpoint moved out of /lineups/* to avoid ParseIntPipe shadow — see ROK-1235.
import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import type { SchedulingBannerDto } from '@raid-ledger/contract';
import { OptionalJwtGuard } from '../../auth/optional-jwt.guard';
import { SchedulingService } from './scheduling.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string } | null;
}

@Controller('scheduling')
export class SchedulingBannerController {
  constructor(private readonly schedulingService: SchedulingService) {}

  /** GET /scheduling/banner — banner for events page. Anonymous returns null. */
  @Get('banner')
  @UseGuards(OptionalJwtGuard)
  async getSchedulingBanner(
    @Req() req: AuthRequest,
  ): Promise<SchedulingBannerDto | null> {
    const userId = req.user?.id ?? null;
    if (userId === null) return null;
    return this.schedulingService.getSchedulingBanner(userId);
  }
}
