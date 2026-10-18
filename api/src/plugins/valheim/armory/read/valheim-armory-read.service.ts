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
import type { ArmoryListQuery } from './valheim-armory-read.query';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';

/** `GET /admin/plugins/valheim/armory/characters` — includes `steamId64`. */
export interface ValheimAdminCharacterListResponse {
  data: ValheimAdminCharacterSummary[];
}

@Injectable()
export class ValheimArmoryReadService {
  constructor(private readonly repo: ValheimArmoryReadRepository) {}

  /** Member list page, sorted by name; never includes a SteamID64. */
  async list(q: ArmoryListQuery): Promise<ValheimCharacterListResponse> {
    const rows = await this.repo.listProfiles(q);
    return { data: rows.map(toSummary) };
  }

  /** Admin owner-management list page (`unclaimed` filter honoured). */
  async adminList(
    q: ArmoryListQuery,
  ): Promise<ValheimAdminCharacterListResponse> {
    const rows = await this.repo.listProfiles(q);
    return { data: rows.map(toAdminSummary) };
  }

  /** One character's member summary (claim/owner responses); 404 when unknown. */
  async summary(id: number): Promise<ValheimCharacterSummary> {
    const row = await this.repo.findProfile(id);
    if (!row) throw new NotFoundException('Character not found');
    return toSummary(row);
  }

  /** Character sheet + map refs; 404 when unknown. */
  async detail(id: number): Promise<ValheimCharacterDetail> {
    const row = await this.repo.findProfile(id);
    if (!row) throw new NotFoundException('Character not found');
    return toDetail(row, await this.repo.listMapRefs(id));
  }

  /** Map metadata; 404 unless the map belongs to the character. */
  async map(id: number, mapId: number): Promise<ValheimMapMeta> {
    const row = await this.repo.findMap(id, mapId);
    if (!row) throw new NotFoundException('Map not found');
    return toMapMeta(row);
  }
}
