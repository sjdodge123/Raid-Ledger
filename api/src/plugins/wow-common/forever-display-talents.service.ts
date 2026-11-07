/**
 * ROK-1744: read-path resolver for WoW: Forever talents. Builds the displayed
 * `ForeverTalentsDto` from the character's LedgerLink `char` snapshot.
 * ROK-2110: when the stored Blizzard talents win (no snapshot, empty
 * snapshot, or synced at/after the capture — D4 newest-wins) they are
 * converted to the same DTO (`source: 'blizzard'`). Read-only on
 * `characters`; `undefined` means "keep the stored talents".
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ForeverTalentsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { DisplayTalentsRow } from '../plugin-host/extension-points';
import { loadForeverCharSnapshot } from './forever-char-snapshot.query';
import { snapshotToForeverTalents } from './forever-talents.adapter';
import { blizzardToForeverTalents } from './forever-blizzard-talents.adapter';
import {
  originsDeviate,
  storedTalentsAreNewer,
  talentOrigins,
  toNodeInputs,
} from './forever-display-talents.helpers';
import type { ForeverTalentNodeInput } from './forever-talents.adapter';

const FOREVER_VARIANT = 'wow_forever';

@Injectable()
export class ForeverDisplayTalentsService {
  private readonly logger = new Logger(ForeverDisplayTalentsService.name);
  /** Origin sets already warned about (one warning per set per process). */
  private readonly warnedOrigins = new Set<string>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** @returns the addon or Blizzard talents, or undefined for "no opinion". */
  async resolve(
    row: DisplayTalentsRow,
  ): Promise<ForeverTalentsDto | undefined> {
    if (row.gameVariant && row.gameVariant !== FOREVER_VARIANT) return;
    const blizzard =
      row.gameVariant === FOREVER_VARIANT
        ? blizzardToForeverTalents(row.talents, row.lastSyncedAt)
        : undefined;
    const snapshot = await loadForeverCharSnapshot(this.db, row.id);
    if (!snapshot) return blizzard;
    const { capturedAt } = snapshot;
    if (storedTalentsAreNewer(row.talents, row.lastSyncedAt, capturedAt)) {
      return blizzard;
    }
    const talents = snapshot.data.talents;
    const nodes = toNodeInputs(talents?.nodes);
    if (nodes.length === 0) return blizzard;
    this.warnOnOriginDeviation(row.id, nodes);
    return snapshotToForeverTalents({
      capturedAt: capturedAt.toISOString(),
      ...(talents.configId !== undefined ? { configId: talents.configId } : {}),
      ...(talents.importString !== undefined
        ? { importString: talents.importString }
        : {}),
      nodes,
    });
  }

  /** Druid ruling: warn (never bail) when a class's origins deviate. */
  private warnOnOriginDeviation(
    characterId: string,
    nodes: ForeverTalentNodeInput[],
  ): void {
    const origins = talentOrigins(nodes);
    const key = origins.join('/');
    if (!originsDeviate(origins) || this.warnedOrigins.has(key)) return;
    this.warnedOrigins.add(key);
    this.logger.warn(
      `Talent sub-tree origins ${key} for character ${characterId} differ from 1020/5020/9080`,
    );
  }
}
