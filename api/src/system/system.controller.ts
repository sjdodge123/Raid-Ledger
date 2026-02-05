import { Controller, Get } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import type { SystemStatusDto } from '@raid-ledger/contract';

/**
 * System status controller (ROK-175).
 * Public endpoint for first-run detection and Discord configuration status.
 */
@Controller('system')
export class SystemController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Get system status for first-run detection (AC-4).
   * Public endpoint - no authentication required.
   */
  @Get('status')
  async getStatus(): Promise<SystemStatusDto> {
    const userCount = await this.usersService.count();

    return {
      isFirstRun: userCount === 0,
      discordConfigured: !!(
        process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET
      ),
    };
  }
}
