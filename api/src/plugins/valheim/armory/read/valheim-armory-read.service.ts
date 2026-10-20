/**
 * ROK-1835 L4 — armory reads for members (every member sees every character,
 * R4) and the admin owner-management list. 404 for unknown ids.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ValheimCharacterDetail,
  ValheimCharacterListResponse,
  ValheimCharacterSummary,
  ValheimMapMeta,
} from '@raid-ledger/contract';
import {
  toAdminSummary,
  toDetail,
  toMapMeta,
  toSummary,
  type ValheimAdminCharacterSummary,
} from './valheim-armory-read.mappers';
import {
  projectCatalog,
  referencedPrefabs,
} from './valheim-armory-catalog.helpers';
import type { ArmoryListQuery } from './valheim-armory-read.query';
import {
  isStaff,
  type GuildActor,
} from '../../../../guilds/guild-access.service';
import {
  assertCharacterHubVisible,
  assertServerHubVisible,
  refuseHiddenHub,
} from './valheim-armory-hub-visibility.helpers';
import { containedBlobPath } from './valheim-armory-map-bytes.service';
import {
  ValheimArmoryReadRepository,
  type ArmoryListFilter,
} from './valheim-armory-read.repository';

/** `GET /admin/plugins/valheim/armory/characters` — includes `steamId64`. */
export interface ValheimAdminCharacterListResponse {
  data: ValheimAdminCharacterSummary[];
  total: number;
}

@Injectable()
export class ValheimArmoryReadService {
  constructor(private readonly repo: ValheimArmoryReadRepository) {}

  /**
   * Member list page, sorted by name; never includes a SteamID64. Non-staff
   * lose characters on a hidden hub's server (ROK-1856, L-5 list filter).
   */
  async list(
    q: ArmoryListQuery,
    actor: GuildActor,
  ): Promise<ValheimCharacterListResponse> {
    const [rows, total] = await this.page({
      ...q,
      hideHiddenHubs: !isStaff(actor),
    });
    return { data: rows.map(toSummary), total };
  }

  /** Admin owner-management list page (`unclaimed` filter honoured). */
  async adminList(
    q: ArmoryListQuery,
  ): Promise<ValheimAdminCharacterListResponse> {
    const [rows, total] = await this.page(q);
    return { data: rows.map(toAdminSummary), total };
  }

  /** One page plus the filtered total (same filters, one COUNT). */
  private page(
    q: ArmoryListFilter,
  ): Promise<
    [Awaited<ReturnType<ValheimArmoryReadRepository['listProfiles']>>, number]
  > {
    return Promise.all([this.repo.listProfiles(q), this.repo.countProfiles(q)]);
  }

  /** ROK-1856: 404 `Guild not found` when the character's hub is hidden. */
  assertCharacterVisible(id: number, actor: GuildActor): Promise<void> {
    return assertCharacterHubVisible(this.repo, actor, id);
  }

  /** One character's member summary (claim/owner responses); 404 when unknown. */
  async summary(id: number): Promise<ValheimCharacterSummary> {
    const row = await this.repo.findProfile(id);
    if (!row) throw new NotFoundException('Character not found');
    return toSummary(row);
  }

  /**
   * Character sheet + map refs + the catalogue subset the sheet references
   * (ROK-1836 D4, by `(server, game version)`); 404 when unknown.
   */
  async detail(id: number, actor: GuildActor): Promise<ValheimCharacterDetail> {
    const row = await this.repo.findProfile(id);
    if (!row) throw new NotFoundException('Character not found');
    // ROK-1856: a hidden hub hides the whole sheet from non-staff (L-5).
    const hub = await this.repo.findServerHub(row.pelicanServerId);
    refuseHiddenHub(hub, actor);
    const prefabs = referencedPrefabs(row);
    const [maps, catalog] = await Promise.all([
      this.repo.listMapRefs(id),
      this.repo.findCatalog(row.pelicanServerId, row.gameVersion, prefabs),
    ]);
    const sheet = toDetail(row, maps);
    const hubId = hub?.id ?? null;
    return { ...sheet, ...projectCatalog(prefabs, catalog), hubId };
  }

  /**
   * Absolute path of a server's stored PNG (D5); 404 when unknown or when
   * its `storage_path` would escape the blob root (a tampered row).
   */
  async blobPath(
    serverId: number,
    sha256: string,
    actor: GuildActor,
  ): Promise<string> {
    await assertServerHubVisible(this.repo, actor, serverId);
    const rel = await this.repo.findBlobPath(serverId, sha256);
    const abs = rel === null ? null : containedBlobPath(rel);
    if (abs === null) throw new NotFoundException('Blob not found');
    return abs;
  }

  /** Map metadata; 404 unless the map belongs to the character. */
  async map(
    id: number,
    mapId: number,
    actor: GuildActor,
  ): Promise<ValheimMapMeta> {
    await this.assertCharacterVisible(id, actor);
    const row = await this.repo.findMap(id, mapId);
    if (!row) throw new NotFoundException('Map not found');
    return toMapMeta(row);
  }
}
