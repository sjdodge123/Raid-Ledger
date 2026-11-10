import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  HubClaimCandidateIdSchema,
  HubClaimResultSchema,
  HubClaimStatusSchema,
  type HubClaimResult,
  type HubClaimStatus,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import type {
  HubClaimContext,
  HubClaimProvider,
} from '../../plugins/plugin-host/extension-points';
import type { GuildActor } from '../guild-access.service';
import { HUB_NOT_FOUND } from '../hub-hidden.helpers';
import { HubKindRegistry } from '../hub-kind.registry';
import { HubClaimError } from './hub-claim.errors';
import {
  capCandidates,
  parseClaimBody,
  pickSuggested,
} from './hub-claim.helpers';
import { findHubClaimRef } from './hub-claim.queries';
import { HubClaimRegistry } from './hub-claim.registry';

interface Resolved {
  provider: HubClaimProvider;
  ctx: HubClaimContext;
}

/**
 * ROK-2153 — the core "claim your character" path for every hub. Resolves
 * the single active provider for the hub (none ⇒ 404 `HUB_CLAIM_UNAVAILABLE`;
 * a guild that does not exist ⇒ the SAME plain 404 `HubVisibleGuard` gives a
 * hidden hub, so the two cannot be told apart),
 * runs it, and validates what it returns against the contract so a provider
 * bug is a logged 500, never a malformed body.
 */
@Injectable()
export class HubClaimService {
  private readonly logger = new Logger(HubClaimService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly registry: HubClaimRegistry,
    private readonly hubKinds: HubKindRegistry,
  ) {}

  async status(actor: GuildActor, guildId: number): Promise<HubClaimStatus> {
    const { provider, ctx } = await this.resolve(actor, guildId);
    const raw = await provider.status(ctx);
    // Uniqueness of the strong match is judged over the provider's FULL list
    // (a second strong past the cap makes it ambiguous), THEN the list is capped.
    const suggested = pickSuggested(raw.candidates);
    const { candidates } = capCandidates(raw.candidates, suggested);
    const parsed = HubClaimStatusSchema.safeParse({
      provider: provider.pluginSlug,
      viewerIsMember: ctx.viewerIsMember,
      viewerHasClaim: raw.viewerHasClaim,
      unclaimedCount: raw.unclaimedCount,
      suggested,
      candidates,
      truncated: raw.unclaimedCount > candidates.length,
      claimOptions: raw.claimOptions,
      // N4-D5: omitted (never null) when the provider reports no round, so
      // every unscoped hub's body stays byte-identical.
      ...(raw.dismissScope !== undefined
        ? { dismissScope: raw.dismissScope }
        : {}),
    });
    if (parsed.success) return parsed.data;
    throw this.providerBug(provider, 'status', parsed.error.message);
  }

  async claim(
    actor: GuildActor,
    guildId: number,
    candidateId: string,
    body: unknown,
  ): Promise<HubClaimResult> {
    const { provider, ctx } = await this.resolve(actor, guildId);
    const request = parseClaimBody(body);
    if (!HubClaimCandidateIdSchema.safeParse(candidateId).success) {
      throw new HubClaimError('HUB_CLAIM_CANDIDATE_GONE', 'No such candidate');
    }
    const raw = await provider.claim(ctx, candidateId, request.options);
    const parsed = HubClaimResultSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    throw this.providerBug(provider, 'claim', parsed.error.message);
  }

  private async resolve(actor: GuildActor, guildId: number): Promise<Resolved> {
    const hub = await findHubClaimRef(this.db, guildId);
    if (hub === null) throw new NotFoundException(HUB_NOT_FOUND);
    const provider = this.registry.forHub(hub);
    const kind = this.hubKinds.resolve(hub.kind);
    if (!provider || !kind) {
      throw new HubClaimError(
        'HUB_CLAIM_UNAVAILABLE',
        'No character claim is available for this hub',
      );
    }
    const viewerIsMember = await kind.isMember(actor.id, guildId);
    const ctx = {
      actor: { id: actor.id, role: actor.role },
      hub,
      viewerIsMember,
    };
    return { provider, ctx };
  }

  private providerBug(
    provider: HubClaimProvider,
    op: string,
    detail: string,
  ): InternalServerErrorException {
    this.logger.error(
      `Claim provider "${provider.pluginSlug}" ${op} broke the contract: ${detail}`,
    );
    return new InternalServerErrorException('Claim provider error');
  }
}
