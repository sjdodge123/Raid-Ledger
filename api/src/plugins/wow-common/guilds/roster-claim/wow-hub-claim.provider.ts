/**
 * ROK-2153 S5 — WoW on the core "claim your character" path
 * (`GET/POST guilds/:id/claim`). Wraps the existing roster claim (ROK-2128):
 * candidates = `RosterClaimService.listCandidates` narrowed to this guild
 * (the one "unclaimed" rule, `isRowUnclaimed`), the claim =
 * `RosterClaimService.claim`. `viewerHasClaim` = the hub kind's membership
 * fact (`WowHubKindAdapter.isMember`: ≥1 linked roster row in this guild).
 *
 * Authorisation parity with `POST plugins/wow/roster-claim/members/:id/claim`:
 * JWT (core) · plugin active (registered owned by `blizzard`, so the registry
 * hides it while inactive, = `PluginActiveGuard`) · Forever game + claimable
 * guild (here, UNAVAILABLE) · row exists (GONE) · body ruleset (BAD_OPTIONS)
 * · the service's own locked re-check (409 → TAKEN). Stricter than the old
 * route: the row must belong to THIS hub (else GONE) and core's
 * `HubVisibleGuard` applies. No membership check (D4: the join gate claims).
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  RosterClaimRequestSchema,
  type HubClaimResult,
  type RosterClaimRequestDto,
} from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import type * as schema from '../../../../drizzle/schema';
import { HubClaimError } from '../../../../guilds/claim/hub-claim.errors';
import {
  EXTENSION_POINTS,
  type HubClaimContext,
  type HubClaimHubRef,
  type HubClaimProvider,
  type HubClaimProviderStatus,
} from '../../../plugin-host/extension-points';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import { WowHubKindAdapter } from '../wow-hub-kind.adapter';
import { RosterClaimService } from './roster-claim.service';
import { readMember, type ClaimMember } from './roster-claim.tx';
import { parseCandidateId, toCandidate } from './wow-hub-claim.helpers';
import { findClaimableGuildGameId } from './wow-hub-claim.queries';

/** The Blizzard plugin's slug — provider key and owner. */
export const WOW_CLAIM_PROVIDER_SLUG = WOW_COMMON_MANIFEST.id;

const gone = () =>
  new HubClaimError('HUB_CLAIM_CANDIDATE_GONE', 'That roster character is gone');

@Injectable()
export class WowHubClaimProvider implements HubClaimProvider, OnModuleInit {
  readonly pluginSlug = WOW_CLAIM_PROVIDER_SLUG;

  constructor(
    private readonly registry: PluginRegistryService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly rosterClaim: RosterClaimService,
    private readonly hubKind: WowHubKindAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.registerAdapter(
      EXTENSION_POINTS.HUB_CLAIM_PROVIDER,
      WOW_CLAIM_PROVIDER_SLUG,
      this,
      { ownerPluginId: WOW_CLAIM_PROVIDER_SLUG },
    );
  }

  supports(hub: HubClaimHubRef): boolean {
    return hub.kind === 'wow_guild';
  }

  async status(ctx: HubClaimContext): Promise<HubClaimProviderStatus> {
    const guildId = ctx.hub.id;
    const gameId = await this.claimableGame(guildId);
    const [list, viewerHasClaim] = await Promise.all([
      this.rosterClaim.listCandidates({ gameId, guildId }),
      this.hubKind.isMember(ctx.actor.id, guildId),
    ]);
    const section = list.guilds.find((g) => g.guildId === guildId);
    const rows = section?.candidates ?? [];
    return {
      viewerHasClaim,
      // A truncated list means at least one more unclaimed row exists.
      unclaimedCount: rows.length + (list.truncated ? 1 : 0),
      candidates: rows.map((r) => toCandidate(r, guildId)),
      claimOptions: 'wow_ruleset',
    };
  }

  async claim(
    ctx: HubClaimContext,
    candidateId: string,
    options: Record<string, unknown> | undefined,
  ): Promise<HubClaimResult> {
    const guildId = ctx.hub.id;
    await this.claimableGame(guildId);
    const body = parseOptions(options);
    const member = await this.memberOf(candidateId, guildId);
    const hadClaim = await this.hubKind.isMember(ctx.actor.id, guildId);
    const character = await this.claimMapped(ctx.actor.id, member, body);
    return {
      claimed: toCandidate(member, guildId),
      becameMember: !hadClaim,
      characterId: character.id,
    };
  }

  /** The guild's game when its roster can be claimed, else UNAVAILABLE. */
  private async claimableGame(guildId: number): Promise<number> {
    const gameId = await findClaimableGuildGameId(this.db, guildId);
    if (gameId === null) {
      throw new HubClaimError('HUB_CLAIM_UNAVAILABLE', 'Roster not claimable');
    }
    return gameId;
  }

  /** The roster row behind `candidateId`, only when it is THIS guild's. */
  private async memberOf(
    candidateId: string,
    guildId: number,
  ): Promise<ClaimMember> {
    const id = parseCandidateId(candidateId);
    if (id === null) throw gone();
    const member = await readMember(this.db, id).catch((err: unknown) => {
      if (err instanceof NotFoundException) throw gone();
      throw err;
    });
    if (member.guildId !== guildId) throw gone();
    return member;
  }

  /** The existing claim, its 400/404/409 mapped onto the core error codes. */
  private async claimMapped(
    userId: number,
    member: ClaimMember,
    body: RosterClaimRequestDto,
  ): Promise<{ id: string }> {
    try {
      return await this.rosterClaim.claim(userId, member.memberId, body);
    } catch (err) {
      if (err instanceof ConflictException) {
        throw new HubClaimError('HUB_CLAIM_CANDIDATE_TAKEN', 'claimed_first');
      }
      if (err instanceof NotFoundException) throw gone();
      if (err instanceof BadRequestException) throw badOptions();
      throw err;
    }
  }
}

const badOptions = () =>
  new HubClaimError(
    'HUB_CLAIM_BAD_OPTIONS',
    'ruleset must be a selectable ruleset',
  );

/** `options` must carry the roster-claim body (`{ ruleset }`). */
function parseOptions(
  options: Record<string, unknown> | undefined,
): RosterClaimRequestDto {
  const parsed = RosterClaimRequestSchema.safeParse(options ?? {});
  if (!parsed.success) throw badOptions();
  return parsed.data;
}
