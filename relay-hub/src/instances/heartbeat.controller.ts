import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  HUB_SCHEMA_VERSION,
  HubHeartbeatRequestSchema,
  type HubHeartbeatRequest,
  type HubHeartbeatResponse,
} from '@raid-ledger/contract';
import {
  HubBearerGuard,
  invalidToken,
  type HubAuth,
} from '../auth/bearer.guard';
import { HubInstance } from '../auth/hub-instance.decorator';
import { hubError } from '../common/hub-errors';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { EpochService } from '../health/epoch.service';
import { InstancesLifecycleRepository } from './instances-lifecycle.repository';
import type { EpochSource } from './instances.service';

/** `POST /api/v1/instances/:id/heartbeat` and `DELETE /api/v1/instances/:id` (ROK-1672). */
@Controller('v1/instances/:id')
@UseGuards(HubBearerGuard)
export class HeartbeatController {
  constructor(
    private readonly lifecycle: InstancesLifecycleRepository,
    @Inject(EpochService) private readonly epoch: EpochSource,
  ) {}

  /** Liveness (pending instances included, L3); usage stats are stripped, never stored. */
  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(
    @HubInstance() auth: HubAuth,
    @Body(new ZodBodyPipe(HubHeartbeatRequestSchema)) body: HubHeartbeatRequest,
  ): Promise<HubHeartbeatResponse> {
    const epoch = await this.epoch.current();
    if (epoch === undefined) throw hubError(503, 'unknown', 'hub not ready');
    const { instanceId, tokenHash } = auth;
    if (
      !(await this.lifecycle.touchHeartbeat(
        instanceId,
        tokenHash,
        body.version,
      ))
    ) {
      throw invalidToken();
    }
    return {
      schemaVersion: HUB_SCHEMA_VERSION,
      epoch,
      serverTime: new Date().toISOString(),
    };
  }

  /** L4: the token stops working; a re-register brings the instance back as pending. */
  @Delete()
  @HttpCode(204)
  async disconnect(@HubInstance() auth: HubAuth): Promise<void> {
    if (!(await this.lifecycle.disconnect(auth.instanceId, auth.tokenHash))) {
      throw invalidToken();
    }
  }
}
