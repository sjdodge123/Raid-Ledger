import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TaggableHubs } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { resolveGuildCrest } from './crest/hub-crest.resolve';
import {
  GuildAccessService,
  isStaff,
  type GuildActor,
} from './guild-access.service';
import { HubKindRegistry } from './hub-kind.registry';

/**
 * ROK-2071 — the Core "Hub" event field's options. A hub is offered when the
 * Core tagger (`HubEventTagger.assertCanTag`) would accept it: its kind has a
 * live adapter, it is the event's game, and the viewer `canEdit` it. Hidden
 * hubs are offered to staff only; proposed/archived community hubs never.
 */
@Injectable()
export class HubTaggableService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
    private readonly hubKinds: HubKindRegistry,
  ) {}

  async listForGame(actor: GuildActor, gameId: number): Promise<TaggableHubs> {
    const g = schema.guilds;
    const rows = await this.db
      .select()
      .from(g)
      .where(and(eq(g.gameId, gameId), eq(g.status, 'active')))
      .orderBy(asc(g.name));
    const staff = isStaff(actor);
    const live = rows.filter(
      (r) =>
        this.hubKinds.resolve(r.kind) !== undefined &&
        (staff || r.hiddenAt === null),
    );
    const editable = staff ? live : await this.filterEditable(actor, live);
    return {
      hubs: editable.map((r) => ({
        id: r.id,
        gameId: r.gameId,
        kind: r.kind,
        name: r.name,
        crest: resolveGuildCrest(r),
      })),
    };
  }

  private async filterEditable(
    actor: GuildActor,
    rows: schema.GuildSelect[],
  ): Promise<schema.GuildSelect[]> {
    const rights = await Promise.all(
      rows.map((r) => this.access.canEditOfKind(actor, r.id, r.kind)),
    );
    return rows.filter((_, i) => rights[i] === true);
  }
}
