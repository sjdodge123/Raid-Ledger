/**
 * ROK-1946 D7 — the Map tab's scanned-portal layer. Audience = everyone who
 * can open the Map: staff, or any signed-in viewer of a hub not hidden from
 * them — members AND non-members (no membership check, unlike Deaths/pins).
 * No hub → the hub 404 for staff too (own null check, spec "Note").
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ValheimServerPortalsResponse } from '@raid-ledger/contract';
import type { AuthenticatedUser } from '../../../../auth/types';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import type * as schema from '../../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import {
  findLatestPortalScan,
  findPortalScan,
  listScanPortals,
} from '../valheim-portals.repository';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import { refuseHiddenHub } from './valheim-armory-hub-visibility.helpers';
import { toServerPortalsResponse } from './valheim-server-portals.mappers';

@Injectable()
export class ValheimServerPortalsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly hubs: ValheimArmoryReadRepository,
  ) {}

  /** `GET …/servers/:serverId/portals?worldUid=` (absent → newest scan). */
  async portals(
    serverId: number,
    worldUid: string | undefined,
    user: AuthenticatedUser,
  ): Promise<ValheimServerPortalsResponse> {
    const hub = await this.hubs.findServerHub(serverId);
    if (!hub) throw new NotFoundException(HUB_NOT_FOUND);
    refuseHiddenHub(hub, user);
    const scan = worldUid
      ? await findPortalScan(this.db, serverId, worldUid)
      : await findLatestPortalScan(this.db, serverId);
    const rows = scan ? await listScanPortals(this.db, scan.id) : [];
    return toServerPortalsResponse(worldUid ?? null, scan, rows);
  }
}
