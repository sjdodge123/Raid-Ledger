/**
 * ROK-1853 L3 — the hub Materials tab's reads: shared totals, the viewer's
 * personal chests (D5/D6), the chest list and one chest's contents. Order in
 * every handler: no hub → 404 (A4) → hidden hub → 404 (ROK-1856) → newest
 * scan (D4; none → the empty state, or 404 for one chest) → queries.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  ValheimContainerDetail,
  ValheimContainerListResponse,
  ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedUser } from '../../../../auth/types';
import type { ValheimContainerScan } from '../../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import { projectCatalog } from './valheim-armory-catalog.helpers';
import { refuseHiddenHub } from './valheim-armory-hub-visibility.helpers';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import {
  distinctPrefabs,
  emptyMaterials,
  toContainerSummary,
  toMaterialStack,
  toMinuteIso,
} from './valheim-materials.mappers';
import {
  personalVisibleSql,
  sharedSql,
  toMaterialsViewer,
  vehicleSql,
  visibleSql,
} from './valheim-materials.privacy';
import { ValheimMaterialsRepository } from './valheim-materials.repository';

/** Identical body for "missing" and "personal chest you may not see". */
export const CONTAINER_NOT_FOUND = 'Container not found';

const both = (a: SQL, b: SQL): SQL => sql`(${a} AND ${b})`;

@Injectable()
export class ValheimMaterialsService {
  constructor(
    private readonly hubs: ValheimArmoryReadRepository,
    private readonly repo: ValheimMaterialsRepository,
  ) {}

  /** `GET …/servers/:serverId/materials`. */
  async materials(
    serverId: number,
    user: AuthenticatedUser,
    includeVehicles: boolean,
  ): Promise<ValheimMaterialsResponse> {
    const scan = await this.scanFor(serverId, user);
    if (!scan) return emptyMaterials();
    const viewer = toMaterialsViewer(user);
    const veh = vehicleSql(includeVehicles);
    const shared = both(sharedSql, veh);
    const personal = both(personalVisibleSql(viewer), veh);
    const [sTotals, sCounts, pTotals, pCounts] = await Promise.all([
      this.repo.totals(scan.id, shared),
      this.repo.counts(scan.id, shared),
      this.repo.totals(scan.id, personal),
      this.repo.counts(scan.id, personal),
    ]);
    const prefabs = distinctPrefabs(sTotals, pTotals);
    const catalog = await this.repo.findCatalog(
      serverId,
      scan.gameVersion,
      prefabs,
    );
    const hasPersonal = viewer.isAdmin || pCounts.chestCount > 0;
    return {
      ...scanHeader(scan),
      gameVersion: scan.gameVersion,
      catalogFallback: catalog !== null && !catalog.exact,
      shared: {
        totals: sTotals.map(toMaterialStack),
        chestCount: sCounts.chestCount,
        warnings: {
          unreadable: sCounts.unreadable,
          omittedEntries: sCounts.omittedEntries,
          omittedShared: scan.omittedShared,
        },
      },
      personal: hasPersonal
        ? {
            totals: pTotals.map(toMaterialStack),
            chestCount: pCounts.chestCount,
            omittedPrivate: viewer.isAdmin ? scan.omittedPrivate : null,
          }
        : null,
      ...projectCatalog(prefabs, catalog),
    };
  }

  /** `GET …/servers/:serverId/containers` — shared ∪ personal-visible. */
  async containers(
    serverId: number,
    user: AuthenticatedUser,
    includeVehicles: boolean,
  ): Promise<ValheimContainerListResponse> {
    const scan = await this.scanFor(serverId, user);
    if (!scan) {
      return {
        worldUid: null,
        capturedAt: null,
        containers: [],
        items: {},
        atlas: null,
      };
    }
    const scope = this.scope(user, includeVehicles);
    const rows = await this.repo.listContainers(scan.id, scope);
    const prefabs = distinctPrefabs(rows);
    const catalog = await this.repo.findCatalog(
      serverId,
      scan.gameVersion,
      prefabs,
    );
    return {
      ...scanHeader(scan),
      containers: rows.map(toContainerSummary),
      ...projectCatalog(prefabs, catalog),
    };
  }

  /** `GET …/containers/:key` — 404 when missing OR not visible (no leak). */
  async container(
    serverId: number,
    key: string,
    user: AuthenticatedUser,
    includeVehicles: boolean,
  ): Promise<ValheimContainerDetail> {
    const scan = await this.scanFor(serverId, user);
    if (!scan) throw new NotFoundException(CONTAINER_NOT_FOUND);
    const scope = this.scope(user, includeVehicles);
    const found = await this.repo.findContainer(scan.id, key, scope);
    if (!found) throw new NotFoundException(CONTAINER_NOT_FOUND);
    return { ...toContainerSummary(found.summary), stacks: found.stacks };
  }

  private scope(user: AuthenticatedUser, includeVehicles: boolean): SQL {
    const viewer = toMaterialsViewer(user);
    return both(visibleSql(viewer), vehicleSql(includeVehicles));
  }

  /** A4 + ROK-1856 + D4: the hub must exist and be visible; newest scan. */
  private async scanFor(
    serverId: number,
    user: AuthenticatedUser,
  ): Promise<ValheimContainerScan | null> {
    const hub = await this.hubs.findServerHub(serverId);
    if (!hub) throw new NotFoundException(HUB_NOT_FOUND);
    refuseHiddenHub(hub, { id: user.id, role: user.role });
    return this.repo.latestScan(serverId);
  }
}

function scanHeader(scan: ValheimContainerScan) {
  return {
    worldUid: scan.worldUid,
    capturedAt: toMinuteIso(scan.capturedAt),
  };
}
