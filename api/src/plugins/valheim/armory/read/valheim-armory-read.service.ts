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
import { containedBlobPath } from './valheim-armory-map-bytes.service';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';

/** `GET /admin/plugins/valheim/armory/characters` — includes `steamId64`. */
export interface ValheimAdminCharacterListResponse {
  data: ValheimAdminCharacterSummary[];
  total: number;
}

@Injectable()
export class ValheimArmoryReadService {
  constructor(private readonly repo: ValheimArmoryReadRepository) {}

  /** Member list page, sorted by name; never includes a SteamID64. */
  async list(q: ArmoryListQuery): Promise<ValheimCharacterListResponse> {
    const [rows, total] = await this.page(q);
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
    q: ArmoryListQuery,
  ): Promise<
    [Awaited<ReturnType<ValheimArmoryReadRepository['listProfiles']>>, number]
  > {
    return Promise.all([this.repo.listProfiles(q), this.repo.countProfiles(q)]);
  }

  /**
   * The server's community hub id (ROK-1831); a hidden hub is null for
   * non-staff — the same L-5 rule the hub routes apply.
   */
  async hubIdFor(serverId: number, actor: GuildActor): Promise<number | null> {
    const hub = await this.repo.findServerHub(serverId);
    if (!hub || (hub.hidden && !isStaff(actor))) return null;
    return hub.id;
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
    const prefabs = referencedPrefabs(row);
    const [maps, catalog, hubId] = await Promise.all([
      this.repo.listMapRefs(id),
      this.repo.findCatalog(row.pelicanServerId, row.gameVersion, prefabs),
      this.hubIdFor(row.pelicanServerId, actor),
    ]);
    const sheet = toDetail(row, maps);
    return { ...sheet, ...projectCatalog(prefabs, catalog), hubId };
  }

  /**
   * Absolute path of a server's stored PNG (D5); 404 when unknown or when
   * its `storage_path` would escape the blob root (a tampered row).
   */
  async blobPath(serverId: number, sha256: string): Promise<string> {
    const rel = await this.repo.findBlobPath(serverId, sha256);
    const abs = rel === null ? null : containedBlobPath(rel);
    if (abs === null) throw new NotFoundException('Blob not found');
    return abs;
  }

  /** Map metadata; 404 unless the map belongs to the character. */
  async map(id: number, mapId: number): Promise<ValheimMapMeta> {
    const row = await this.repo.findMap(id, mapId);
    if (!row) throw new NotFoundException('Map not found');
    return toMapMeta(row);
  }
}
