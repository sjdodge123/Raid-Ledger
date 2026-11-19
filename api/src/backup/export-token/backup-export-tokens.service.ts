/**
 * ROK-2263 D7/D8: admin management of backup-export tokens — list, mint
 * (cap 5 live, expiry 30/90/365/never) and soft revoke, each audited in
 * `admin_actions`. The plaintext token exists only in the mint response: it
 * is never stored (hash + hint only) and never logged.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  BACKUP_EXPORT_TOKEN_LIVE_CAP,
  type BackupExportToken,
  type BackupExportTokenListResponse,
  type MintBackupExportTokenResponse,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { insertAdminAction } from '../../users/users-admin-actions.helpers';
import { backupExportTokenKit } from './backup-export-token.helpers';
import {
  expiryFrom,
  parseMintRequest,
  toBackupExportTokenDto,
  tokenCapReached,
  tokenNotFound,
} from './backup-export-token-dto.helpers';
import {
  BackupExportTokensRepository,
  type BackupExportTokenTx,
} from './backup-export-tokens.repository';

type Db = PostgresJsDatabase<typeof schema>;

@Injectable()
export class BackupExportTokensService {
  private readonly logger = new Logger(BackupExportTokensService.name);

  constructor(
    private readonly repo: BackupExportTokensRepository,
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
  ) {}

  /** Every token (live, expired, revoked), newest first. */
  async list(): Promise<BackupExportTokenListResponse> {
    const rows = await this.repo.listForDisplay();
    return { tokens: rows.map(toBackupExportTokenDto) };
  }

  /** Mint one token for `actorId`; 409 when the live cap is reached. */
  async mint(
    actorId: number,
    body: unknown,
  ): Promise<MintBackupExportTokenResponse> {
    const request = parseMintRequest(body);
    const token = backupExportTokenKit.generate();
    const row = await this.repo.insertUnderCap(
      {
        label: request.label,
        tokenHash: backupExportTokenKit.hash(token),
        tokenHint: backupExportTokenKit.hintOf(token),
        createdBy: actorId,
        expiresAt: expiryFrom(request.expiresInDays),
      },
      BACKUP_EXPORT_TOKEN_LIVE_CAP,
      // Same transaction as the insert: the token and its audit row commit together.
      (tx, inserted) =>
        this.audit(
          tx,
          'backup_token_mint',
          actorId,
          inserted.id,
          inserted.label,
        ),
    );
    if (!row) throw tokenCapReached();
    this.logger.log(`backup-export token #${row.id} minted by user ${actorId}`);
    return { token, item: await this.displayItem(row.id) };
  }

  /** Soft revoke. Already revoked → no-op (no second audit); unknown → 404. */
  async revoke(actorId: number, id: number): Promise<void> {
    const row = await this.repo.revoke(id);
    if (row) {
      await this.audit(
        this.db,
        'backup_token_revoke',
        actorId,
        row.id,
        row.label,
      );
      this.logger.log(`backup-export token #${id} revoked by user ${actorId}`);
      return;
    }
    if (!(await this.repo.findById(id))) throw tokenNotFound();
  }

  private async displayItem(id: number): Promise<BackupExportToken> {
    const rows = await this.repo.listForDisplay();
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`backup-export token #${id} vanished after mint`);
    return toBackupExportTokenDto(row);
  }

  private audit(
    writer: Db | BackupExportTokenTx,
    action: 'backup_token_mint' | 'backup_token_revoke',
    actorId: number,
    tokenId: number,
    label: string,
  ): Promise<void> {
    return insertAdminAction(writer, {
      action,
      actorId,
      targetId: null,
      metadata: JSON.stringify({ tokenId, label }),
    });
  }
}
