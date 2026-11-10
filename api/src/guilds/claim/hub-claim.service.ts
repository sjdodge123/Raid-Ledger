import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
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
 * the single active provider for the hub (none ⇒ 404 `HUB_CLAIM_UNAVAILABLE`),
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
    const { candidates } = capCandidates(raw.candidates);
    const parsed = HubClaimStatusSchema.safeParse({
      provider: provider.pluginSlug,
      viewerIsMember: ctx.viewerIsMember,
      viewerHasClaim: raw.viewerHasClaim,
      unclaimedCount: raw.unclaimedCount,
      suggested: pickSuggested(candidates),
      candidates,
      truncated: raw.unclaimedCount > candidates.length,
      claimOptions: raw.claimOptions,
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
    const provider = hub ? this.registry.forHub(hub) : undefined;
    const kind = hub ? this.hubKinds.resolve(hub.kind) : undefined;
    if (!hub || !provider || !kind) {
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
