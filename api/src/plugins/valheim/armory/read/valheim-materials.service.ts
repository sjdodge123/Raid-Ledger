/**
 * ROK-1853 L3 — the hub Materials tab's reads: shared totals, the viewer's
 * personal chests (D5/D6), the chest list and one chest's contents. Order in
 * every handler: no hub → 404 (A4) → hidden hub → 404 (ROK-1856) → newest
 * scan (D4; none → the empty state, or 404 for one chest) → queries. The
 * scan lookup and its queries share one read-only REPEATABLE READ
 * transaction (`repo.read`), so a concurrent import cannot mix snapshots.
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
import { projectCatalog } from './valheim-armory-catalog.helpers';
import {
  toChestFocus,
  type ChestFocusQuery,
  type ValheimChestFocus,
} from './valheim-chest-focus.helpers';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import { assertServerHubVisible } from './valheim-hub-guard.helpers';
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
import {
  ValheimMaterialsRepository,
  type MaterialsReader,
} from './valheim-materials.repository';
import {
  materialsBases,
  placeOf,
  toBaseView,
  withMaterialsTrend,
} from './valheim-materials-bases.service-helpers';

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
    await this.assertHub(serverId, user);
    return this.repo.read((r) =>
      this.materialsIn(r, serverId, user, includeVehicles),
    );
  }

  private async materialsIn(
    r: MaterialsReader,
    serverId: number,
    user: AuthenticatedUser,
    includeVehicles: boolean,
  ): Promise<ValheimMaterialsResponse> {
    const scan = await r.latestScan(serverId);
    if (!scan) return emptyMaterials();
    const viewer = toMaterialsViewer(user);
    const veh = vehicleSql(includeVehicles);
    const shared = both(sharedSql, veh);
    const personal = both(personalVisibleSql(viewer), veh);
    // ROK-1859: bases + per-chest sums over everything this viewer may see.
    const visible = both(visibleSql(viewer), veh);
    const [sTotals, sCounts, pTotals, pCounts, inputs, sums, trend] =
      await Promise.all([
        r.totals(scan.id, shared),
        r.counts(scan.id, shared),
        r.totals(scan.id, personal),
        r.counts(scan.id, personal),
        r.baseInputs(scan.id, visible),
        r.stackSums(scan.id, visible),
        // ROK-2014: play-day trend of the scan's world, same viewer rules.
        r.trendInputs(serverId, scan.worldUid, viewer, includeVehicles),
      ]);
    const prefabs = distinctPrefabs(sTotals, pTotals);
    const catalog = await r.findCatalog(serverId, scan.gameVersion, prefabs);
    const hasPersonal = viewer.isAdmin || pCounts.chestCount > 0;
    const order = {
      shared: sTotals.map(toMaterialStack),
      personal: pTotals.map(toMaterialStack),
    };
    const { bases, byBase } = materialsBases(toBaseView(inputs), sums, order);
    return withMaterialsTrend(
      {
        ...scanHeader(scan),
        gameVersion: scan.gameVersion,
        catalogFallback: catalog !== null && !catalog.exact,
        bases,
        shared: {
          totals: order.shared,
          chestCount: sCounts.chestCount,
          warnings: {
            unreadable: sCounts.unreadable,
            omittedEntries: sCounts.omittedEntries,
            omittedShared: scan.omittedShared,
          },
        },
        personal: hasPersonal
          ? {
              totals: order.personal,
              chestCount: pCounts.chestCount,
              byBase,
              omittedPrivate: viewer.isAdmin ? scan.omittedPrivate : null,
            }
          : null,
        ...projectCatalog(prefabs, catalog),
      },
      trend,
    );
  }

  /**
   * `GET …/servers/:serverId/containers` — shared ∪ personal-visible;
   * `holding` (a prefab) keeps only the chests holding that item.
   */
  async containers(
    serverId: number,
    user: AuthenticatedUser,
    includeVehicles: boolean,
    holding: string | null = null,
  ): Promise<ValheimContainerListResponse> {
    await this.assertHub(serverId, user);
    const scope = this.scope(user, includeVehicles);
    return this.repo.read((r) =>
      this.containersIn(r, serverId, scope, holding),
    );
  }

  private async containersIn(
    r: MaterialsReader,
    serverId: number,
    scope: SQL,
    holding: string | null,
  ): Promise<ValheimContainerListResponse> {
    const scan = await r.latestScan(serverId);
    if (!scan) return emptyContainerList();
    // Numbering reads the whole scope, never `holding`-filtered (D5).
    const [rows, inputs] = await Promise.all([
      r.listContainers(scan.id, scope, holding),
      r.baseInputs(scan.id, scope),
    ]);
    const view = toBaseView(inputs);
    const prefabs = distinctPrefabs(rows);
    const catalog = await r.findCatalog(serverId, scan.gameVersion, prefabs);
    return {
      ...scanHeader(scan),
      containers: rows.map((row) =>
        toContainerSummary(row, placeOf(view, row.key)),
      ),
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
    await this.assertHub(serverId, user);
    const scope = this.scope(user, includeVehicles);
    const found = await this.repo.read(async (r) => {
      const scan = await r.latestScan(serverId);
      const hit = scan ? await r.findContainer(scan.id, key, scope) : null;
      if (!scan || !hit) return null;
      const view = toBaseView(await r.baseInputs(scan.id, scope));
      return { ...hit, place: placeOf(view, key) };
    });
    if (!found) throw new NotFoundException(CONTAINER_NOT_FOUND);
    const summary = toContainerSummary(found.summary, found.place);
    return { ...summary, stacks: found.stacks };
  }

  /**
   * ROK-1889 `GET …/chest-focus` — the Map tab's chest marker, through the
   * list's visibility rules (vehicles included): gone OR hidden → the same 404.
   */
  async chestAt(
    serverId: number,
    user: AuthenticatedUser,
    q: ChestFocusQuery,
  ): Promise<ValheimChestFocus> {
    await this.assertHub(serverId, user);
    const scope = this.scope(user, true);
    const row = await this.repo.read(async (r) => {
      const scan = await r.latestScan(serverId);
      return scan ? r.findContainerAt(scan.id, scope, q) : null;
    });
    if (!row) throw new NotFoundException(CONTAINER_NOT_FOUND);
    return toChestFocus(row, q.item);
  }

  private scope(user: AuthenticatedUser, includeVehicles: boolean): SQL {
    const viewer = toMaterialsViewer(user);
    return both(visibleSql(viewer), vehicleSql(includeVehicles));
  }

  /** A4 + ROK-1856: the hub must exist and be visible (before any read). */
  private assertHub(serverId: number, user: AuthenticatedUser): Promise<void> {
    return assertServerHubVisible(this.hubs, serverId, user);
  }
}

function emptyContainerList(): ValheimContainerListResponse {
  return {
    worldUid: null,
    capturedAt: null,
    containers: [],
    items: {},
    atlas: null,
  };
}

function scanHeader(scan: ValheimContainerScan) {
  return {
    worldUid: scan.worldUid,
    capturedAt: toMinuteIso(scan.capturedAt),
  };
}
