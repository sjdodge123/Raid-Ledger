/**
 * ROK-1957 §5.2 — the `bg3-save` v1 companion contract handler, owned by
 * the `bg3` plugin. C3 has already validated the message, checked its blob
 * refs and applied latest-wins before `handle` runs on the ingest tx.
 */
import { Injectable } from '@nestjs/common';
import type { Bg3SaveMessage, CompanionWebpRef } from '@raid-ledger/contract';
import type {
  CompanionContractHandler,
  CompanionHandlerContext,
} from '../../../companion/ingest/companion-handler.registry';
import type { CompanionIngestVia } from '../../../companion/ingest/companion-ingest-request';
import { GuildAccessService } from '../../../guilds/guild-access.service';
import {
  Bg3SavesWriteRepository,
  type Bg3SaveInsert,
} from './bg3-saves.write.repository';

/** Highest level among the non-summons (summons only as a fallback). */
export function partyMaxLevel(
  party: Bg3SaveMessage['payload']['party'],
): number {
  const heroes = party.filter((m) => !m.isSummon);
  const levels = (heroes.length > 0 ? heroes : party).map((m) => m.level);
  return levels.length > 0 ? Math.max(...levels) : 0;
}

/** The `bg3_saves` row for one accepted message. */
export function toBg3SaveRow(
  ctx: Pick<CompanionHandlerContext, 'userId' | 'deviceId' | 'receivedAt'>,
  msg: Bg3SaveMessage,
  campaignId: number | null,
): Bg3SaveInsert {
  const p = msg.payload;
  return {
    uploaderUserId: ctx.userId,
    deviceId: ctx.deviceId,
    campaignId,
    campaignKey: p.campaignKey,
    campaignKeySource: p.campaignKeySource,
    saveName: p.saveName,
    savedAt: new Date(p.savedAt),
    capturedAt: new Date(msg.capturedAt),
    receivedAt: ctx.receivedAt,
    gameVersion: p.gameVersion,
    platform: p.platform,
    currentLevel: p.currentLevel,
    difficulty: p.difficulty,
    ruleset: p.ruleset,
    party: p.party,
    partyMaxLevel: partyMaxLevel(p.party),
    thumbnailSha256: p.thumbnail?.sha256 ?? null,
    thumbnailWidth: p.thumbnail?.width ?? null,
    thumbnailHeight: p.thumbnail?.height ?? null,
  };
}

@Injectable()
export class Bg3SaveHandler implements CompanionContractHandler<Bg3SaveMessage> {
  /** A literal: the ownership guard's scan reads it (`BG3_SAVE_CONTRACT_ID`). */
  readonly contract = 'bg3-save';
  readonly versions: readonly number[] = [1];
  /** D-5: the browser drag-and-drop path (ROK-1960) posts as a session. */
  readonly sources: readonly CompanionIngestVia[] = ['device', 'session'];

  constructor(
    private readonly repo: Bg3SavesWriteRepository,
    private readonly access: GuildAccessService,
  ) {}

  /** D-4: one latest marker per campaign key. */
  latestWins(msg: Bg3SaveMessage): { key: string; at: Date } {
    return { key: msg.payload.campaignKey, at: new Date(msg.payload.savedAt) };
  }

  blobRefs(msg: Bg3SaveMessage): readonly CompanionWebpRef[] {
    return msg.payload.thumbnail ? [msg.payload.thumbnail] : [];
  }

  async handle(
    ctx: CompanionHandlerContext,
    msg: Bg3SaveMessage,
  ): Promise<void> {
    const campaignId = await this.campaignFor(ctx, msg.payload.campaignKey);
    await this.repo.insertSave(ctx.tx, toBg3SaveRow(ctx, msg, campaignId));
  }

  /** D-6 resolution; a campaign whose hub the uploader left → unassigned. */
  private async campaignFor(
    ctx: CompanionHandlerContext,
    campaignKey: string,
  ): Promise<number | null> {
    const target = await this.repo.resolveCampaign(
      ctx.tx,
      ctx.userId,
      campaignKey,
    );
    if (target === null) return null;
    const member = await this.access.isMember(ctx.userId, target.guildId);
    return member ? target.id : null;
  }
}
