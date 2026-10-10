/**
 * ROK-1744: read-path resolver for WoW: Forever talents. Builds the displayed
 * `ForeverTalentsDto` from the character's LedgerLink `char` snapshot.
 * Read-only on `characters`; `undefined` means "keep the stored talents".
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ForeverTalentsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { DisplayTalentsRow } from '../plugin-host/extension-points';
import { loadForeverCharSnapshot } from './forever-char-snapshot.query';
import { snapshotToForeverTalents } from './forever-talents.adapter';
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

  /** @returns the addon talents, or undefined for "no opinion". */
  async resolve(
    row: DisplayTalentsRow,
  ): Promise<ForeverTalentsDto | undefined> {
    if (row.gameVariant && row.gameVariant !== FOREVER_VARIANT) return;
    const snapshot = await loadForeverCharSnapshot(this.db, row.id);
    if (!snapshot) return undefined;
    const { capturedAt } = snapshot;
    if (storedTalentsAreNewer(row.talents, row.lastSyncedAt, capturedAt)) {
      return undefined;
    }
    const talents = snapshot.data.talents;
    const nodes = toNodeInputs(talents?.nodes);
    if (nodes.length === 0) return undefined;
    this.warnOnOriginDeviation(row.id, nodes);
    return snapshotToForeverTalents({
      capturedAt: capturedAt.toISOString(),
      configId: talents.configId,
      importString: talents.importString,
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
