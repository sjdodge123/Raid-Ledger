import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  CompanionDevice,
  CompanionDeviceListResponse,
  CompanionDeviceSelf,
} from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../auth/types';
import { CompanionDeviceGuard } from './companion-device.guard';
import type { AuthenticatedCompanionDeviceRequest } from './companion-device-request';
import { CompanionDevicesService } from './companion-devices.service';

/**
 * ROK-1955. `GET device` is the ONLY route behind `CompanionDeviceGuard`
 * (an `rlcd_` bearer; a session JWT is refused). The `devices` routes are
 * the signed-in user's Devices list — session JWT only, owner-scoped.
 */
@Controller('companion/v1')
export class CompanionDevicesController {
  constructor(private readonly devices: CompanionDevicesService) {}

  @Get('device')
  @UseGuards(CompanionDeviceGuard)
  self(
    @Req() req: AuthenticatedCompanionDeviceRequest,
  ): Promise<CompanionDeviceSelf> {
    return this.devices.self(req.companionDevice);
  }

  @Get('devices')
  @UseGuards(AuthGuard('jwt'))
  list(
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<CompanionDeviceListResponse> {
    return this.devices.list(req.user.id);
  }

  @Patch('devices/:id')
  @UseGuards(AuthGuard('jwt'))
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<CompanionDevice> {
    return this.devices.rename(req.user.id, id, body);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'))
  revoke(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<void> {
    return this.devices.revoke(req.user.id, id);
  }
}
