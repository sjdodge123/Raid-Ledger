/**
 * ROK-1743: read-path resolver for WoW: Forever saved instances. Builds the
 * displayed `CharacterLockoutsDto` from the character's LedgerLink `char`
 * snapshot. Read-only; `undefined` means "no lockouts key on the DTO".
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterLockoutsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { DisplayLockoutsRow } from '../plugin-host/extension-points';
import { loadForeverCharSnapshot } from './forever-char-snapshot.query';
import { snapshotToLockouts } from './forever-lockouts.adapter';

const FOREVER_VARIANT = 'wow_forever';

@Injectable()
export class ForeverDisplayLockoutsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** @returns the unexpired addon lockouts, or undefined when none. */
  async resolve(
    row: DisplayLockoutsRow,
  ): Promise<CharacterLockoutsDto | undefined> {
    if (row.gameVariant && row.gameVariant !== FOREVER_VARIANT) return;
    const snapshot = await loadForeverCharSnapshot(this.db, row.id);
    if (!snapshot) return undefined;
    return snapshotToLockouts(snapshot, Date.now());
  }
}
