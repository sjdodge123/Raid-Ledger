import { Injectable } from '@nestjs/common';
import {
  CompanionDeviceRenameRequestSchema,
  CompanionDeviceSelfSchema,
  type CompanionDevice,
  type CompanionDeviceListResponse,
  type CompanionDeviceSelf,
} from '@raid-ledger/contract';
import { handleValidationError } from '../../common/validation.util';
import { toCompanionDeviceDto } from './companion-device-dto.helpers';
import {
  deviceNotFound,
  deviceUnauthorized,
} from './companion-device-link.errors';
import type { CompanionDeviceAuth } from './companion-device-request';
import { CompanionDevicesRepository } from './companion-devices.repository';

/**
 * ROK-1955 D-12 / D-13: the signed-in user's Devices list (owner-only
 * rename, soft revoke) and the device's own "who am I". Ownership is the
 * repository's `WHERE user_id` — another user's id and an already-revoked
 * device answer the same 404 `not_found`.
 */
@Injectable()
export class CompanionDevicesService {
  constructor(private readonly repo: CompanionDevicesRepository) {}

  /** Live devices first, then those revoked in the last 30 days. */
  async list(userId: number): Promise<CompanionDeviceListResponse> {
    const rows = await this.repo.listForUser(userId);
    return { data: rows.map(toCompanionDeviceDto) };
  }

  /** Rename one of the user's live devices. */
  async rename(
    userId: number,
    deviceId: number,
    body: unknown,
  ): Promise<CompanionDevice> {
    const parsed = CompanionDeviceRenameRequestSchema.safeParse(body);
    if (!parsed.success) handleValidationError(parsed.error);
    const row = await this.repo.rename(userId, deviceId, parsed.data.name);
    if (!row) throw deviceNotFound();
    return toCompanionDeviceDto(row);
  }

  /** Soft-revoke: the guard refuses the token from the next request on. */
  async revoke(userId: number, deviceId: number): Promise<void> {
    if (!(await this.repo.revoke(userId, deviceId))) throw deviceNotFound();
  }

  /** The authenticated device's identity (the app's start-up check). */
  async self(auth: CompanionDeviceAuth): Promise<CompanionDeviceSelf> {
    const row = await this.repo.findById(auth.deviceId);
    if (!row) throw deviceUnauthorized();
    return CompanionDeviceSelfSchema.parse({
      deviceId: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
    });
  }
}
