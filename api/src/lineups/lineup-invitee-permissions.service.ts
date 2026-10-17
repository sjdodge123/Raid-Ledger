/**
 * Authorization for managing a lineup's invitee roster (ROK-1440).
 *
 * Lives in its own tiny service rather than on `LineupsService` because that
 * file sits at 299/300 counted lines against the STRICT `max-lines` cap — a
 * method there would have tripped CI lint. Injected directly by
 * `LineupsController`, which is the only caller.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  assertCallerMayManageInvitees,
  type InviteeManagerCaller,
} from './lineups-invitees.helpers';

@Injectable()
export class LineupInviteePermissionsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Throw unless the caller is the lineup creator or an admin/operator. */
  assertCanManage(
    lineupId: number,
    caller: InviteeManagerCaller,
  ): Promise<void> {
    return assertCallerMayManageInvitees(this.db, lineupId, caller);
  }
}
