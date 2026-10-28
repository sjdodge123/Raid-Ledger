/**
 * ROK-1957 §5.4 — campaign create/edit and the per-uploader key binding +
 * default campaign (D-6). Hub rules come from `assertBg3HubReader` (D-15).
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Bg3CampaignSummary,
  Bg3CreateCampaignBody,
  Bg3UpdateCampaignBody,
} from '@raid-ledger/contract';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import {
  assertBg3HubReader,
  isCurrentHost,
  refuseNonBg3Hub,
} from '../read/bg3-hub-access.helpers';
import {
  Bg3CampaignsRepository,
  type Bg3CampaignRow,
} from './bg3-campaigns.repository';

@Injectable()
export class Bg3CampaignsService {
  constructor(
    private readonly repo: Bg3CampaignsRepository,
    private readonly access: GuildAccessService,
  ) {}

  /** Hub member / staff; caller = creator + host. */
  async create(
    hubId: number,
    actor: GuildActor,
    body: Bg3CreateCampaignBody,
  ): Promise<Bg3CampaignSummary> {
    await assertBg3HubReader(this.repo, this.access, hubId, actor);
    const id = await this.repo.createCampaign(hubId, body.name, actor.id);
    return this.summaryOf(id);
  }

  /** Live host, hub editor or staff; a new host must be a hub member (400). */
  async update(
    campaignId: number,
    actor: GuildActor,
    body: Bg3UpdateCampaignBody,
  ): Promise<Bg3CampaignSummary> {
    const campaign = await this.findCampaign(campaignId);
    refuseNonBg3Hub(await this.repo.findHub(campaign.guildId), actor);
    const isHost = await isCurrentHost(this.access, campaign, actor);
    if (!isHost && !(await this.access.canEdit(actor, campaign.guildId)))
      throw new ForbiddenException('Only the host or a hub editor');
    const { name, hostUserId } = body;
    if (
      hostUserId !== undefined &&
      !(await this.access.isMember(hostUserId, campaign.guildId))
    )
      throw new BadRequestException('host_not_member');
    await this.repo.updateCampaign(campaignId, {
      ...(name !== undefined ? { name } : {}),
      ...(hostUserId !== undefined ? { hostUserId } : {}),
    });
    return this.summaryOf(campaignId);
  }

  /** Bind one of the caller's keys; retro-assigns their rows with it. */
  async bindKey(actor: GuildActor, key: string, campaignId: number) {
    await this.memberCampaign(campaignId, actor);
    await this.repo.bindKey(actor.id, key, campaignId);
  }

  /** Drop the caller's binding; their rows with the key go unassigned. */
  async unbindKey(actor: GuildActor, key: string): Promise<void> {
    await this.repo.unbindKey(actor.id, key);
  }

  /** Set (member of that hub) or clear the caller's default campaign. */
  async setDefault(actor: GuildActor, campaignId: number | null) {
    if (campaignId !== null) await this.memberCampaign(campaignId, actor);
    await this.repo.setDefault(actor.id, campaignId);
  }

  /** The campaign, its hub a BG3 hub the actor is a member of. */
  async memberCampaign(
    campaignId: number,
    actor: GuildActor,
  ): Promise<Bg3CampaignRow> {
    const campaign = await this.findCampaign(campaignId);
    await assertBg3HubReader(this.repo, this.access, campaign.guildId, actor);
    return campaign;
  }

  private async findCampaign(campaignId: number): Promise<Bg3CampaignRow> {
    const campaign = await this.repo.findCampaign(campaignId);
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  private async summaryOf(campaignId: number): Promise<Bg3CampaignSummary> {
    const summary = await this.repo.summary(campaignId);
    if (!summary) throw new NotFoundException('Campaign not found');
    return summary;
  }
}
