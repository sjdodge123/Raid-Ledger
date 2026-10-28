/**
 * ROK-1957 D-10 / §5.5 — "that's me" party claims. Claim: self only, hub
 * member, slot in the newest canonical save. Clear: claimant, campaign
 * host (still a hub member), hub editor or staff (`canEdit` covers staff).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { isUniqueViolation } from '../../../characters/characters-crud.helpers';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import { isCurrentHost, refuseNonBg3Hub } from '../read/bg3-hub-access.helpers';
import type { Bg3CampaignRow } from '../campaigns/bg3-campaigns.repository';
import { Bg3CampaignsRepository } from '../campaigns/bg3-campaigns.repository';
import { Bg3CampaignsService } from '../campaigns/bg3-campaigns.service';
import { pickCanonical } from '../history/bg3-canonical.helpers';
import { slotKeys } from './bg3-party-slot.helpers';
import { Bg3ClaimsRepository } from './bg3-claims.repository';

/** Only the slot-key fields; a row that fails is skipped (§5.9). */
const SlotPartySchema = z.array(
  z.looseObject({
    origin: z.string(),
    race: z.string(),
    isSummon: z.boolean(),
  }),
);

@Injectable()
export class Bg3ClaimsService {
  private readonly logger = new Logger(Bg3ClaimsService.name);

  constructor(
    private readonly repo: Bg3ClaimsRepository,
    private readonly campaigns: Bg3CampaignsService,
    private readonly campaignRepo: Bg3CampaignsRepository,
    private readonly access: GuildAccessService,
  ) {}

  async claim(campaignId: number, actor: GuildActor, slotKey: string) {
    const campaign = await this.campaigns.memberCampaign(campaignId, actor);
    if (!(await this.currentSlots(campaign)).includes(slotKey))
      throw new BadRequestException('unknown_slot');
    const taken = await this.repo.conflicts(campaignId, slotKey, actor.id);
    if (taken.some((c) => c.slotKey === slotKey))
      throw new ConflictException('slot_taken');
    if (taken.length > 0) throw new ConflictException('already_claimed');
    try {
      await this.repo.insert(campaignId, slotKey, actor.id);
    } catch (err) {
      throw mapClaimRace(err);
    }
  }

  async clear(campaignId: number, actor: GuildActor, slotKey: string) {
    const campaign = await this.campaignRepo.findCampaign(campaignId);
    if (!campaign) throw new NotFoundException('Campaign not found');
    refuseNonBg3Hub(await this.campaignRepo.findHub(campaign.guildId), actor);
    const claim = await this.repo.find(campaignId, slotKey);
    if (!claim) throw new NotFoundException('No claim on that slot');
    const mayClear =
      claim.userId === actor.id ||
      (await isCurrentHost(this.access, campaign, actor)) ||
      (await this.access.canEdit(actor, campaign.guildId));
    if (!mayClear) throw new ForbiddenException('Not your claim');
    await this.repo.delete(campaignId, slotKey);
  }

  /** Slot keys of the newest canonical save (summons excluded). */
  private async currentSlots(campaign: Bg3CampaignRow): Promise<string[]> {
    const rows = await this.repo.newestSaves(campaign.id);
    const [newest] = pickCanonical(rows, campaign.hostUserId);
    if (!newest) return [];
    const party = SlotPartySchema.safeParse(newest.party);
    if (!party.success) {
      this.logger.warn(`bg3 save ${newest.id}: stored party fails re-parse`);
      return [];
    }
    return slotKeys(party.data).filter((k): k is string => k !== null);
  }
}

/** A lost race on either unique index → the matching 409. */
export function mapClaimRace(err: unknown): unknown {
  if (isUniqueViolation(err, 'bg3_party_claims_campaign_slot_uq'))
    return new ConflictException('slot_taken');
  if (isUniqueViolation(err, 'bg3_party_claims_campaign_user_uq'))
    return new ConflictException('already_claimed');
  return err;
}
