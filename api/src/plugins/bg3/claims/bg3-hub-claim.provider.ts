/**
 * ROK-2153 S6 — Baldur's Gate 3 on the core "claim your character" path
 * (`GET/POST guilds/:id/claim`). The ONLY `game_community` provider. Scope is
 * the hub's ACTIVE campaign only (N5): its newest canonical save's unclaimed,
 * non-summon party slots; no active campaign ⇒ nothing to claim and no
 * dismissal scope. Claims go through `Bg3ClaimsService.claim` (ROK-1957), so
 * the member rule, slot check and race mapping stay in one place.
 */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  Bg3PartyMemberSchema,
  type Bg3PartyMember,
  type HubClaimResult,
} from '@raid-ledger/contract';
import { z } from 'zod';
import { GuildAccessService } from '../../../guilds/guild-access.service';
import { HubClaimError } from '../../../guilds/claim/hub-claim.errors';
import {
  EXTENSION_POINTS,
  type HubClaimContext,
  type HubClaimHubRef,
  type HubClaimProvider,
  type HubClaimProviderStatus,
} from '../../plugin-host/extension-points';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { isBg3Game } from '../bg3-game-match.helpers';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import { Bg3CampaignsRepository } from '../campaigns/bg3-campaigns.repository';
import { pickCanonical } from '../history/bg3-canonical.helpers';
import { assertBg3HubReader } from '../read/bg3-hub-access.helpers';
import { Bg3ReadRepository } from '../read/bg3-read.repository';
import { Bg3ClaimsRepository } from './bg3-claims.repository';
import { Bg3ClaimsService } from './bg3-claims.service';
import {
  bg3Candidates,
  bg3DismissScope,
  bg3Gone,
  bg3Slots,
  NO_CLAIM_STATUS,
  parseBg3CandidateId,
  toBg3Candidate,
  toHubClaimError,
} from './bg3-hub-claim.helpers';

const PartySchema = z.array(Bg3PartyMemberSchema);

@Injectable()
export class Bg3HubClaimProvider implements HubClaimProvider, OnModuleInit {
  readonly pluginSlug = BG3_PLUGIN_ID;

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly access: GuildAccessService,
    private readonly campaigns: Bg3CampaignsRepository,
    private readonly reads: Bg3ReadRepository,
    private readonly claimsRepo: Bg3ClaimsRepository,
    private readonly claims: Bg3ClaimsService,
  ) {}

  onModuleInit(): void {
    this.registry.registerAdapter(
      EXTENSION_POINTS.HUB_CLAIM_PROVIDER,
      BG3_PLUGIN_ID,
      this,
      { ownerPluginId: BG3_PLUGIN_ID },
    );
  }

  supports(hub: HubClaimHubRef): boolean {
    return (
      hub.kind === 'game_community' && isBg3Game(hub.gameSlug, hub.gameIgdbId)
    );
  }

  async status(ctx: HubClaimContext): Promise<HubClaimProviderStatus> {
    await this.assertReader(ctx);
    const active = await this.activeCampaign(ctx.hub.id);
    if (active === null) return NO_CLAIM_STATUS;
    const [party, claimRows] = await Promise.all([
      this.party(active),
      this.reads.claims(active.id),
    ]);
    const claimed = new Set(claimRows.map((c) => c.slotKey));
    const candidates = bg3Candidates(active.id, party, claimed);
    return {
      viewerHasClaim: claimRows.some((c) => c.userId === ctx.actor.id),
      unclaimedCount: candidates.length,
      candidates,
      claimOptions: 'none',
      dismissScope: bg3DismissScope(active.id),
    };
  }

  async claim(
    ctx: HubClaimContext,
    candidateId: string,
  ): Promise<HubClaimResult> {
    const parsed = parseBg3CandidateId(candidateId);
    if (parsed === null) throw bg3Gone();
    await this.assertReader(ctx);
    const active = await this.activeCampaign(ctx.hub.id);
    if (active?.id !== parsed.campaignId) throw bg3Gone();
    const slot = bg3Slots(await this.party(active)).find(
      (s) => s.slotKey === parsed.slotKey,
    );
    if (!slot) throw bg3Gone();
    try {
      await this.claims.claim(active.id, ctx.actor, slot.slotKey);
    } catch (err) {
      throw toHubClaimError(err);
    }
    return {
      claimed: toBg3Candidate(active.id, slot.slotKey, slot.member),
      becameMember: false,
      characterId: null,
    };
  }

  /** Hub member or staff (`assertBg3HubReader`), mapped to core codes. */
  private async assertReader(ctx: HubClaimContext): Promise<void> {
    try {
      await assertBg3HubReader(this.campaigns, this.access, ctx.hub.id, ctx.actor);
    } catch (err) {
      if (err instanceof ForbiddenException)
        throw new HubClaimError('HUB_CLAIM_FORBIDDEN', 'Hub members only');
      if (err instanceof NotFoundException)
        throw new HubClaimError('HUB_CLAIM_UNAVAILABLE', 'Not a BG3 hub');
      throw err;
    }
  }

  /** The hub's active campaign (`bg3_hub_settings`), or null. */
  private async activeCampaign(hubId: number) {
    const { activeCampaignId } = await this.reads.settings(hubId);
    if (activeCampaignId === null) return null;
    const campaign = await this.campaigns.findCampaign(activeCampaignId);
    return campaign?.guildId === hubId ? campaign : null;
  }

  /** The newest canonical save's party — the slots `claim` accepts. */
  private async party(campaign: {
    id: number;
    hostUserId: number | null;
  }): Promise<Bg3PartyMember[]> {
    const rows = await this.claimsRepo.newestSaves(campaign.id);
    const [newest] = pickCanonical(rows, campaign.hostUserId);
    const party = PartySchema.safeParse(newest?.party);
    return party.success ? party.data : [];
  }
}
