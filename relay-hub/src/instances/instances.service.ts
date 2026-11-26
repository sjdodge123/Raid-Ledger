import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HUB_SCHEMA_VERSION,
  type HubRegisterRequest,
  type HubRegisterResponse,
} from '@raid-ledger/contract';
import { hubError } from '../common/hub-errors';
import { EpochService } from '../health/epoch.service';
import { InstancesRepository } from './instances.repository';
import { hashToken, mintToken } from './tokens';

/** The slice of {@link EpochService} registration needs. */
export type EpochSource = Pick<EpochService, 'current'>;

/**
 * Self-registration (ROK-1671, scope §9): every register — first or repeat —
 * mints a new token and leaves the instance pending until `hub-admin
 * approve`. Pending is answered as `trustTier: 'reader'` (L1). The raw token
 * is returned once and never stored or logged; `enrollmentCode` is ignored (L2).
 */
@Injectable()
export class InstancesService {
  private readonly logger = new Logger('InstancesService');

  constructor(
    private readonly repo: InstancesRepository,
    @Inject(EpochService) private readonly epoch: EpochSource,
  ) {}

  async register(body: HubRegisterRequest): Promise<HubRegisterResponse> {
    if (body.schemaVersion !== HUB_SCHEMA_VERSION) {
      throw hubError(
        426,
        'schema_unsupported',
        `serves schemaVersion ${HUB_SCHEMA_VERSION}`,
      );
    }
    const existing = await this.repo.findById(body.instanceId);
    if (existing?.status === 'revoked') throw hubError(403, 'revoked');
    const epoch = await this.epoch.current();
    if (epoch === undefined) throw hubError(503, 'unknown', 'hub not ready');
    const token = mintToken();
    const stored = await this.repo.upsertPending({
      instanceId: body.instanceId,
      tokenHash: hashToken(token),
      version: body.version,
      schemaVersion: body.schemaVersion,
    });
    if (!stored) throw hubError(403, 'revoked');
    this.logger.log(`Instance ${body.instanceId} registered; pending approval`);
    return {
      token,
      instanceId: body.instanceId,
      trustTier: 'reader',
      schemaVersion: HUB_SCHEMA_VERSION,
      epoch,
    };
  }
}
