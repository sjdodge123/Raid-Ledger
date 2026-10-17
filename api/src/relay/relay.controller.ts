import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { RelayService, RelayStatus, RelaySettings } from './relay.service';

/**
 * Admin Relay Controller (ROK-273)
 * Provides endpoints for managing relay hub connection.
 */
@Controller('admin/relay')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class RelayController {
  private readonly logger = new Logger(RelayController.name);

  constructor(private readonly relayService: RelayService) {}

  /**
   * GET /admin/relay
   * Returns current relay settings and connection status.
   */
  @Get()
  async getRelayStatus(): Promise<RelayStatus> {
    return this.relayService.getStatus();
  }

  /**
   * PATCH /admin/relay
   * Update relay settings (enabled, relayUrl).
   */
  @Patch()
  @HttpCode(HttpStatus.OK)
  async updateRelaySettings(
    @Body() body: Partial<RelaySettings>,
  ): Promise<{ success: boolean; message: string }> {
    await this.relayService.updateSettings(body);

    this.logger.log('Relay settings updated via admin UI');

    return {
      success: true,
      message: 'Relay settings updated.',
    };
  }

  /**
   * POST /admin/relay/connect
   * Trigger registration with the relay hub.
   */
  @Post('connect')
  @HttpCode(HttpStatus.OK)
  async connect(): Promise<RelayStatus> {
    this.logger.log('Relay connect requested via admin UI');
    return this.relayService.register();
  }

  /**
   * POST /admin/relay/disconnect
   * Deregister from the relay hub.
   */
  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnect(): Promise<{ success: boolean; message: string }> {
    await this.relayService.disconnect();

    this.logger.log('Relay disconnect completed via admin UI');

    return {
      success: true,
      message: 'Disconnected from relay hub.',
    };
  }
}
