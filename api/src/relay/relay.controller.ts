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
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { RelayService, RelayStatus, RelaySettings } from './relay.service';

/** Body for PATCH /admin/relay — unknown keys and non-http(s) URLs are rejected. */
const UpdateRelaySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    relayUrl: z
      .string()
      .trim()
      .max(2048)
      .refine(isHttpUrl, 'relayUrl must be an http(s) URL')
      .optional(),
  })
  .strict();

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validate the PATCH body; conditional spreads keep absent keys absent. */
function parseRelaySettings(body: unknown): Partial<RelaySettings> {
  const result = UpdateRelaySettingsSchema.safeParse(body);
  if (!result.success) {
    const messages = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw new BadRequestException(`Validation failed: ${messages}`);
  }
  const { enabled, relayUrl } = result.data;
  return {
    ...(enabled !== undefined && { enabled }),
    ...(relayUrl !== undefined && { relayUrl }),
  };
}

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
    @Body() body: unknown,
  ): Promise<{ success: boolean; message: string }> {
    await this.relayService.updateSettings(parseRelaySettings(body));

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
