/**
 * ROK-1957 §5.6 — hub-scoped BG3 reads + the settings write. Every route
 * runs `assertBg3HubReader` (D-15); a campaign or save outside `:hubId` is
 * 404 (no cross-hub read); the spoiler toggle (D-14) nulls area + pictures
 * for everyone and 404s the thumbnail route.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import {
  Bg3PartyMemberSchema,
  type Bg3HubCampaignsResponse,
  type Bg3HubSettings,
  type Bg3HubSettingsBody,
  type Bg3SessionsResponse,
  type Bg3SnapshotResponse,
} from '@raid-ledger/contract';
import { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import {
  encodeHubMediaCursor,
  type HubMediaCursor,
} from '../../../hub-media/hub-media.cursor';
import { Bg3CampaignsRepository } from '../campaigns/bg3-campaigns.repository';
import { pickCanonical } from '../history/bg3-canonical.helpers';
import { clusterSessions } from '../history/bg3-sessions.helpers';
import { assertBg3HubReader } from './bg3-hub-access.helpers';
import {
  pageSessions,
  toPartySlots,
  toSession,
  toSnapshot,
} from './bg3-read.mappers';
import { Bg3ReadRepository } from './bg3-read.repository';
import {
  Bg3SavesReadRepository,
  isCanonicalSave,
} from './bg3-saves.read.repository';
import { encodeBlobOr404, type Bg3ThumbnailSize } from './bg3-thumbnail.encode';

/** Newest rows scanned for the snapshot (twins share `savedAt`, so sit together). */
export const BG3_SNAPSHOT_SCAN = 20;
const PartySchema = z.array(Bg3PartyMemberSchema);
const THUMB_404 = 'Thumbnail not found';

@Injectable()
export class Bg3ReadService {
  private readonly logger = new Logger(Bg3ReadService.name);

  constructor(
    private readonly repo: Bg3ReadRepository,
    private readonly saves: Bg3SavesReadRepository,
    private readonly hubs: Bg3CampaignsRepository,
    private readonly access: GuildAccessService,
    private readonly blobs: CompanionBlobStore,
  ) {}

  async campaigns(
    hubId: number,
    actor: GuildActor,
  ): Promise<Bg3HubCampaignsResponse> {
    await assertBg3HubReader(this.hubs, this.access, hubId, actor);
    const [campaigns, settings, canEdit] = await Promise.all([
      this.repo.hubCampaigns(hubId),
      this.repo.settings(hubId),
      this.access.canEdit(actor, hubId),
    ]);
    return { campaigns, settings, canEdit };
  }

  async snapshot(
    hubId: number,
    actor: GuildActor,
    campaignId: number | undefined,
  ): Promise<Bg3SnapshotResponse> {
    await assertBg3HubReader(this.hubs, this.access, hubId, actor);
    const settings = await this.repo.settings(hubId);
    const id = campaignId ?? settings.activeCampaignId;
    if (id === null) throw new NotFoundException('no_campaign');
    const campaign = await this.campaignIn(hubId, id);
    const rows = await this.repo.snapshotRows(id, BG3_SNAPSHOT_SCAN);
    const claims = await this.repo.claims(id);
    const ctx = {
      hubId,
      campaignId: id,
      hidden: settings.hideLocationAndScreenshots,
    };
    for (const row of pickCanonical(rows, campaign.hostUserId)) {
      const party = PartySchema.safeParse(row.party);
      if (party.success)
        return toSnapshot(row, ctx, toPartySlots(party.data, claims));
      this.logger.warn(`bg3 save ${row.id}: stored party fails re-parse`);
    }
    return { empty: true, campaignId: id };
  }

  async sessions(
    hubId: number,
    campaignId: number,
    actor: GuildActor,
    page: { cursor: HubMediaCursor | null; limit: number },
  ): Promise<Bg3SessionsResponse> {
    await assertBg3HubReader(this.hubs, this.access, hubId, actor);
    const campaign = await this.campaignIn(hubId, campaignId);
    const [rows, settings] = await Promise.all([
      this.repo.sessionRows(campaignId),
      this.repo.settings(hubId),
    ]);
    const canonical = pickCanonical(rows, campaign.hostUserId);
    const thumbs = new Set(
      canonical.filter((r) => r.thumbnailSha256 !== null).map((r) => r.id),
    );
    const { page: items, next } = pageSessions(
      clusterSessions(canonical),
      page.cursor,
      page.limit,
    );
    const hidden = settings.hideLocationAndScreenshots;
    return {
      sessions: items.map((x) =>
        toSession(x, { hubId, hidden, hasThumb: thumbs.has(x.lastSaveId) }),
      ),
      nextCursor: next ? encodeHubMediaCursor(next) : null,
    };
  }

  /** D-12 re-encoded bytes of a canonical save of this hub. */
  async thumbnail(
    hubId: number,
    saveId: number,
    actor: GuildActor,
    size: Bg3ThumbnailSize,
  ): Promise<Buffer> {
    await assertBg3HubReader(this.hubs, this.access, hubId, actor);
    const settings = await this.repo.settings(hubId);
    if (settings.hideLocationAndScreenshots)
      throw new NotFoundException(THUMB_404);
    const save = await this.saves.saveInCampaign(saveId);
    const sha = save?.guildId === hubId ? save.thumbnailSha256 : null;
    if (!save || sha === null || !(await isCanonicalSave(this.saves, save)))
      throw new NotFoundException(THUMB_404);
    return encodeBlobOr404(this.blobs, save.uploaderUserId, sha, size);
  }

  async updateSettings(
    hubId: number,
    actor: GuildActor,
    body: Bg3HubSettingsBody,
  ): Promise<Bg3HubSettings> {
    await assertBg3HubReader(this.hubs, this.access, hubId, actor);
    if (!(await this.access.canEdit(actor, hubId)))
      throw new ForbiddenException('Hub editors only');
    const active = body.activeCampaignId;
    if (active != null) {
      const campaign = await this.repo.campaignInHub(active, hubId);
      if (!campaign) throw new BadRequestException('campaign_not_in_hub');
      // D-11: archived campaigns leave the active switch.
      if (campaign.archivedAt)
        throw new BadRequestException('campaign_archived');
    }
    await this.repo.upsertSettings(hubId, body, actor.id);
    return this.repo.settings(hubId);
  }

  private async campaignIn(hubId: number, campaignId: number) {
    const campaign = await this.repo.campaignInHub(campaignId, hubId);
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }
}
