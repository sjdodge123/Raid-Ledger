/**
 * ROK-2153 S4 — Valheim on the core "claim your character" path
 * (`GET/POST guilds/:id/claim`). Wraps the existing armory reads and
 * `ValheimArmoryClaimsService.claim` (ROK-1835): same rule as
 * `POST plugins/valheim/armory/characters/:id/claim` — any signed-in viewer
 * of a visible hub (core's `HubVisibleGuard`) may claim an unclaimed
 * character; no membership or Steam check. Registered under the plugin's
 * slug and owned by it, so the registry hides it while Valheim is inactive.
 */
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { HubClaimCandidate, HubClaimResult } from '@raid-ledger/contract';
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
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { ValheimArmoryReadRepository } from '../read/valheim-armory-read.repository';
import { ValheimArmoryClaimsService } from './valheim-armory-claims.service';
import {
  NO_VIEWER,
  parseCandidateId,
  toCandidate,
} from './valheim-hub-claim.helpers';
import { findHubServerId, findViewerFacts } from './valheim-hub-claim.queries';

/** Unclaimed rows read per status call; core caps the response at 50. */
export const VALHEIM_CLAIM_SCAN_LIMIT = 500;

/**
 * A scan that hit its limit may hide a second strong match (Codex P2), so core
 * must not decide "exactly one strong" on it: demote strong to possible (same
 * reason) and the member picks from the list instead.
 */
function capStrength(
  candidates: HubClaimCandidate[],
  partial: boolean,
): HubClaimCandidate[] {
  if (!partial) return candidates;
  return candidates.map((c): HubClaimCandidate =>
    c.match === 'strong' ? { ...c, match: 'possible' } : c,
  );
}

const gone = () =>
  new HubClaimError('HUB_CLAIM_CANDIDATE_GONE', 'No such character');

@Injectable()
export class ValheimHubClaimProvider implements HubClaimProvider, OnModuleInit {
  readonly pluginSlug = VALHEIM_PLUGIN_ID;

  constructor(
    private readonly registry: PluginRegistryService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly reads: ValheimArmoryReadRepository,
    private readonly claims: ValheimArmoryClaimsService,
  ) {}

  onModuleInit(): void {
    this.registry.registerAdapter(
      EXTENSION_POINTS.HUB_CLAIM_PROVIDER,
      VALHEIM_PLUGIN_ID,
      this,
      { ownerPluginId: VALHEIM_PLUGIN_ID },
    );
  }

  supports(hub: HubClaimHubRef): boolean {
    return hub.kind === 'game_server' && hub.gameSlug === VALHEIM_GAME_SLUG;
  }

  async status(ctx: HubClaimContext): Promise<HubClaimProviderStatus> {
    const serverId = await this.serverOf(ctx.hub.id);
    const [counts, rows, viewer] = await Promise.all([
      this.reads.claimStatus(serverId, ctx.actor.id),
      this.reads.listProfiles({
        serverId,
        unclaimed: true,
        limit: VALHEIM_CLAIM_SCAN_LIMIT,
        offset: 0,
      }),
      findViewerFacts(this.db, ctx.actor.id),
    ]);
    return {
      viewerHasClaim: counts.viewerHasClaim,
      // Two reads: never report fewer unclaimed than the list we return.
      unclaimedCount: Math.max(counts.unclaimedCount, rows.length),
      candidates: capStrength(
        rows.map((r) => toCandidate(r, viewer)),
        rows.length >= VALHEIM_CLAIM_SCAN_LIMIT,
      ),
      claimOptions: 'none',
    };
  }

  async claim(
    ctx: HubClaimContext,
    candidateId: string,
  ): Promise<HubClaimResult> {
    const id = parseCandidateId(candidateId);
    if (id === null) throw gone();
    const serverId = await this.serverOf(ctx.hub.id);
    const row = await this.reads.findProfile(id);
    if (!row || row.pelicanServerId !== serverId) throw gone();
    await this.claimMapped(id, ctx.actor.id);
    return {
      claimed: toCandidate(row, NO_VIEWER),
      becameMember: false,
      characterId: null,
    };
  }

  /** The hub's Pelican server; a Valheim hub without one has nothing to claim. */
  private async serverOf(guildId: number): Promise<number> {
    const serverId = await findHubServerId(this.db, guildId);
    if (serverId === null) {
      throw new HubClaimError('HUB_CLAIM_UNAVAILABLE', 'Hub has no server');
    }
    return serverId;
  }

  /** The existing claim, its 404/409 mapped onto the core error codes. */
  private async claimMapped(id: number, userId: number): Promise<void> {
    try {
      await this.claims.claim(id, userId);
    } catch (err) {
      if (err instanceof ConflictException) {
        throw new HubClaimError('HUB_CLAIM_CANDIDATE_TAKEN', 'already_claimed');
      }
      if (err instanceof NotFoundException) throw gone();
      throw err;
    }
  }
}
