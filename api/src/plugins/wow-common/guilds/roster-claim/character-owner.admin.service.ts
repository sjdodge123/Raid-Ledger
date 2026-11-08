import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  AdminCharacterOwnerRequestSchema,
  type AdminCharacterOwnerResultDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import type * as schema from '../../../../drizzle/schema';
import { NotificationService } from '../../../../notifications/notification.service';
import { reassignWithin } from './character-owner.admin.tx';
import {
  gainedNotice,
  movedNotice,
  sendOwnerNotices,
} from './character-owner.notify';

/**
 * ROK-2128 (D6) — admin "Change owner" for a WoW character. One tx moves the
 * row, fixes both players' mains, detaches the old owner's future signups
 * (FLAG 10) and audits `admin_reassigned`; both players are notified after
 * commit (FLAG 7).
 */
@Injectable()
export class CharacterOwnerAdminService {
  private readonly logger = new Logger(CharacterOwnerAdminService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationService,
  ) {}

  /** Move `characterId` to the body's `userId`; 400/404/409 per the tx. */
  async reassign(
    adminId: number,
    characterId: string,
    body: unknown,
  ): Promise<AdminCharacterOwnerResultDto> {
    const parsed = AdminCharacterOwnerRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid body');
    const toUserId = parsed.data.userId;
    const out = await this.db.transaction((tx) =>
      reassignWithin(tx, {
        adminId,
        characterId,
        toUserId,
        logger: this.logger,
      }),
    );
    const { row } = out;
    await sendOwnerNotices(
      this.notifications,
      [
        movedNotice(row.userId, row.name, out.toName, row.id),
        gainedNotice(toUserId, row.name, row.id),
      ],
      this.logger,
    );
    this.logger.log(
      `Admin ${adminId} moved character ${row.id} from ${row.userId} to ${toUserId}`,
    );
    return { characterId: row.id, fromUserId: row.userId, toUserId };
  }
}
