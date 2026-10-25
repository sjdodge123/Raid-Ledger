import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { HubRenameSchema, type GuildSummary } from '@raid-ledger/contract';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { conflictOnUnique } from './community/community-db-errors';
import { hasNameClash } from './community/community-proposals.queries';
import {
  GuildAccessService,
  isStaff,
  ladderCanManageEditors,
  type GuildActor,
} from './guild-access.service';
import { findGuild, findHubGuild, hubSummaryFor } from './guild-core.queries';
import { HUB_NOT_FOUND } from './hub-hidden.helpers';
import { HubKindRegistry } from './hub-kind.registry';
import {
  RENAME_ERRORS,
  isRenameChange,
  planRename,
  type RenamePlan,
  type RenameSet,
} from './hub-rename.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Applied = Extract<RenamePlan, { ok: true }>;

/** A failed plan → the NestJS exception it names. */
function planError(status: 400 | 404 | 409, message: string): Error {
  if (status === 400) return new BadRequestException(message);
  if (status === 404) return new NotFoundException(message);
  return new ConflictException(message);
}

/**
 * ROK-1950 — rename a hub (`PATCH /guilds/:id/name`), a Core hub behaviour
 * for every kind. Leader (staff, or a community hub's leader) only; the route
 * guard checks first and this re-checks. Per-kind rules: `planRename`. A
 * server hub's source name comes from its kind adapter's `sourceName` hook,
 * so core never imports the Pelican plugin. No notifications (Q3/Q4); the
 * `activity_log` `hub_renamed` row is the audit.
 */
@Injectable()
export class HubRenameService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly hubKinds: HubKindRegistry,
    private readonly activity: ActivityLogService,
  ) {}

  /** Parse, plan, write once, audit when changed; returns the new summary. */
  async rename(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildSummary> {
    const parsed = HubRenameSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const row = await findGuild(this.db, guildId);
    if (!row) throw new NotFoundException(HUB_NOT_FOUND);
    await this.assertLeader(actor, guildId);
    const plan = planRename(row, parsed.data.name, await this.sourceOf(row));
    if (!plan.ok) throw planError(plan.status, plan.message);
    if (isRenameChange(row, plan.set)) {
      await this.write(row, plan.set);
      await this.audit(actor, row, plan);
    }
    return this.summary(actor, guildId);
  }

  private async assertLeader(actor: GuildActor, id: number): Promise<void> {
    const role = await this.access.resolveLadder(actor, id);
    if (!ladderCanManageEditors(role)) {
      throw new ForbiddenException('Hub leader access required');
    }
  }

  /** D5: the server name a reset goes back to; null for other kinds. */
  private async sourceOf(row: schema.GuildSelect): Promise<string | null> {
    if (row.kind !== 'game_server') return null;
    const adapter = this.hubKinds.require(row.kind);
    return (await adapter.sourceName?.(row.id)) ?? null;
  }

  /**
   * ONE UPDATE, scoped to the row's kind and `active` status. A community
   * name is pre-checked under the index's own rules (same game, same key,
   * not archived); a racing insert still maps to 409, never a retry.
   */
  private async write(row: schema.GuildSelect, set: RenameSet): Promise<void> {
    const g = schema.guilds;
    const update = (): Promise<{ id: number }[]> =>
      this.db
        .update(g)
        .set({ ...set, updatedAt: new Date() })
        .where(
          and(eq(g.id, row.id), eq(g.kind, row.kind), eq(g.status, 'active')),
        )
        .returning({ id: g.id });
    if (row.kind !== 'game_community') {
      if ((await update()).length === 0)
        throw new NotFoundException(HUB_NOT_FOUND);
      return;
    }
    if (await hasNameClash(this.db, row.gameId, set.name, row.id)) {
      throw new ConflictException(RENAME_ERRORS.nameTaken);
    }
    const done = await conflictOnUnique(update, RENAME_ERRORS.nameTaken);
    if (done.length === 0) throw new NotFoundException(HUB_NOT_FOUND);
  }

  private async audit(
    actor: GuildActor,
    row: schema.GuildSelect,
    plan: Applied,
  ): Promise<void> {
    const { from, to, reset } = plan;
    const metadata = { from, to, kind: row.kind, reset };
    await this.activity.log('hub', row.id, 'hub_renamed', actor.id, metadata);
  }

  private async summary(actor: GuildActor, id: number): Promise<GuildSummary> {
    const hub = await findHubGuild(this.db, id);
    if (!hub) throw new NotFoundException(HUB_NOT_FOUND);
    return hubSummaryFor(hub, isStaff(actor));
  }
}
