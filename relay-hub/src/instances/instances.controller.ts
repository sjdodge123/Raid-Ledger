import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  HubRegisterRequestSchema,
  type HubRegisterRequest,
  type HubRegisterResponse,
} from '@raid-ledger/contract';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { InstancesService } from './instances.service';

/** `POST /api/v1/instances/register` (ROK-1671). */
@Controller('v1/instances')
export class InstancesController {
  constructor(private readonly instances: InstancesService) {}

  /** Registers (or re-registers) an instance as pending; returns its token once. */
  @Post('register')
  @HttpCode(200)
  register(
    @Body(new ZodBodyPipe(HubRegisterRequestSchema)) body: HubRegisterRequest,
  ): Promise<HubRegisterResponse> {
    return this.instances.register(body);
  }
}
