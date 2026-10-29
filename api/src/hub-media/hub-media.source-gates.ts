import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubMediaSource } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

type Db = PostgresJsDatabase<typeof schema>;
const { hubMedia: M } = schema;

/** ROK-1959 D-5 — `true` hides the source's pictures on this hub for everyone. */
export type HubMediaSourceGate = (guildId: number) => Promise<boolean>;

interface OwnedGate {
  ownerPluginId: string;
  source: HubMediaSource;
  gate: HubMediaSourceGate;
}

/**
 * ROK-1959 D-5 — a plugin hides a whole media source per hub at read time
 * (e.g. a spoiler toggle). Core stays game-agnostic: it only asks each gate
 * whether to hide. Fail closed: a gate whose owner plugin is off, or one
 * that throws, hides its source — nobody can evaluate it then.
 *
 * A gate is only asked when the hub has a live row of its source (one
 * indexed read): a hub without save pictures never runs the BG3 settings
 * query. An absent source is still excluded — a no-op filter that also
 * closes the race with a row landing mid-request.
 */
@Injectable()
export class HubMediaSourceGateRegistry {
  private readonly logger = new Logger(HubMediaSourceGateRegistry.name);
  private readonly gates: OwnedGate[] = [];

  constructor(
    private readonly plugins: PluginRegistryService,
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
  ) {}

  /** Register `gate` for `source`, owned by `ownerPluginId` (a plugin slug, or `core`). */
  register(
    ownerPluginId: string,
    source: HubMediaSource,
    gate: HubMediaSourceGate,
  ): void {
    this.gates.push({ ownerPluginId, source, gate });
  }

  /** Sources hidden on hub `guildId` for this request (deduplicated). */
  async hiddenSources(guildId: number): Promise<HubMediaSource[]> {
    if (this.gates.length === 0) return [];
    const present = await this.presentSources(guildId);
    const hidden = await Promise.all(
      this.gates.map(async (g) =>
        !present.has(g.source) || (await this.hides(g, guildId))
          ? g.source
          : null,
      ),
    );
    return [...new Set(hidden.filter((s): s is HubMediaSource => s !== null))];
  }

  /** Gated sources with a live row on the hub; none on a read error (fail closed). */
  private async presentSources(guildId: number): Promise<Set<string>> {
    const sources = [...new Set(this.gates.map((g) => g.source))];
    try {
      const rows = await this.db
        .selectDistinct({ source: M.source })
        .from(M)
        .where(
          and(
            eq(M.guildId, guildId),
            isNull(M.removedAt),
            inArray(M.source, sources),
          ),
        );
      return new Set(rows.map((r) => r.source));
    } catch (err) {
      this.logger.warn(
        `media gate source read failed on hub ${guildId}; hiding gated sources: ${String(err)}`,
      );
      return new Set();
    }
  }

  private async hides(g: OwnedGate, guildId: number): Promise<boolean> {
    if (!this.plugins.isActive(g.ownerPluginId)) return true;
    try {
      return await g.gate(guildId);
    } catch (err) {
      this.logger.warn(
        `media gate for "${g.source}" (${g.ownerPluginId}) failed on hub ${guildId}; hiding it: ${String(err)}`,
      );
      return true;
    }
  }
}
