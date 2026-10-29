import { Injectable, Logger } from '@nestjs/common';
import type { HubMediaSource } from '@raid-ledger/contract';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

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
 */
@Injectable()
export class HubMediaSourceGateRegistry {
  private readonly logger = new Logger(HubMediaSourceGateRegistry.name);
  private readonly gates: OwnedGate[] = [];

  constructor(private readonly plugins: PluginRegistryService) {}

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
    const hidden = await Promise.all(
      this.gates.map(async (g) =>
        (await this.hides(g, guildId)) ? g.source : null,
      ),
    );
    return [...new Set(hidden.filter((s): s is HubMediaSource => s !== null))];
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
