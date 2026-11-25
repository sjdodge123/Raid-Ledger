/**
 * ROK-2352 §5 — the blizzard plugin's `lfg-grouping` adapter: one LFG group
 * per WoW dungeon or raid, roles + character per hand. Registered once per
 * WoW slug by `WowLfgRegistration` under the declared id below.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { CreateSignupDto, WowGameVariant } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type {
  LfgGroupDescriptor,
  LfgGroupingAdapter,
  LfgGroupingGameContext,
  LfgGroupingTx,
  LfgHandDetailContext,
  LfgLockInContext,
  LfgLockInPatch,
} from '../../plugin-host/lfg-grouping.adapter';
import { BlizzardService } from '../blizzard.service';
import {
  catalogueInstancesFor,
  toWowGroupDescriptor,
  wowGroupKey,
  wowVariantForSlug,
  WOW_LFG_DEFAULT_REGION,
  type WowLfgInstance,
} from './wow-lfg-catalogue';
import {
  assertOwnCharacter,
  parseWowHandDetail,
  readWowCarryover,
  readWowMemberDetails,
  upsertWowHandDetail,
  type WowLfgDb,
} from './wow-lfg-detail.helpers';
import { buildWowLockInFields } from './wow-lfg-lock-in.helpers';

@Injectable()
export class WowLfgGroupingAdapter implements LfgGroupingAdapter {
  readonly behaviourId = 'wow-instance-lfg';
  private readonly logger = new Logger(WowLfgGroupingAdapter.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: WowLfgDb,
    private readonly blizzard: BlizzardService,
  ) {}

  /** Dungeons then raids of the slug's variant, as groups (no `''`). */
  async listGroups(ctx: LfgGroupingGameContext): Promise<LfgGroupDescriptor[]> {
    const instances = await this.instancesFor(ctx.gameSlug, ctx.region);
    return instances.map(toWowGroupDescriptor);
  }

  /** The group a key names in this game, or null (→ 400 in core). */
  async describeGroup(
    ctx: LfgGroupingGameContext,
    groupKey: string,
  ): Promise<LfgGroupDescriptor | null> {
    const inst = await this.findInstance(ctx.gameSlug, groupKey, ctx.region);
    return inst ? toWowGroupDescriptor(inst) : null;
  }

  /** Validate (roles 1..3, own character on this game) and upsert. */
  async saveHandDetail(
    tx: LfgGroupingTx,
    ctx: LfgHandDetailContext,
    detail: unknown,
  ): Promise<void> {
    const parsed = parseWowHandDetail(detail);
    if (parsed.characterId) {
      await assertOwnCharacter(tx, parsed.characterId, ctx);
    }
    await upsertWowHandDetail(tx, ctx.intentId, parsed);
  }

  /** intentId → `WowLfgMemberDetailDto`. */
  async readMemberDetails(ctx: {
    intentIds: number[];
  }): Promise<Map<number, Record<string, unknown>>> {
    const details = await readWowMemberDetails(this.db, ctx.intentIds);
    return new Map([...details].map(([id, d]) => [id, { ...d }]));
  }

  /** Shape (§3.4), instance, title and carryover for a locking-in group. */
  async buildLockInPatch(
    tx: LfgGroupingTx,
    ctx: LfgLockInContext,
  ): Promise<LfgLockInPatch> {
    const carryover = await readWowCarryover(tx, ctx.memberIntentIds);
    const key = ctx.groupKey || ctx.chosenGroupKey;
    if (!key) return { carryover };
    const [game] = await tx
      .select({ slug: schema.games.slug })
      .from(schema.games)
      .where(eq(schema.games.id, ctx.gameId))
      .limit(1);
    const inst = game ? await this.findInstance(game.slug, key) : null;
    return inst ? { ...buildWowLockInFields(inst), carryover } : { carryover };
  }

  /** userId → {characterId?, preferredRoles} for converted hands (poll exit). */
  async buildCarryover(ctx: {
    intentIds: number[];
  }): Promise<Map<number, CreateSignupDto>> {
    return readWowCarryover(this.db, ctx.intentIds);
  }

  private async findInstance(
    slug: string,
    key: string,
    region?: string,
  ): Promise<WowLfgInstance | null> {
    const all = await this.instancesFor(slug, region);
    return all.find((i) => wowGroupKey(i) === key) ?? null;
  }

  /** Local catalogue when it serves the variant, else the Blizzard journal. */
  private async instancesFor(
    slug: string,
    region?: string,
  ): Promise<WowLfgInstance[]> {
    const variant = wowVariantForSlug(slug);
    if (variant === null) return [];
    return (
      catalogueInstancesFor(variant) ?? this.journalInstances(variant, region)
    );
  }

  private async journalInstances(
    variant: WowGameVariant,
    region = WOW_LFG_DEFAULT_REGION,
  ): Promise<WowLfgInstance[]> {
    try {
      const { dungeons, raids } = await this.blizzard.fetchAllInstances(
        region,
        variant,
      );
      const as =
        (category: 'dungeon' | 'raid') =>
        (i: (typeof dungeons)[number]): WowLfgInstance => ({
          id: i.id,
          name: i.name,
          ...(i.shortName !== undefined ? { shortName: i.shortName } : {}),
          expansion: i.expansion,
          category,
          maxPlayers: null,
          minimumLevel: i.minimumLevel ?? null,
          maximumLevel: i.maximumLevel ?? null,
        });
      return [...dungeons.map(as('dungeon')), ...raids.map(as('raid'))];
    } catch (err) {
      this.logger.warn(
        `WoW LFG journal unavailable (${variant}/${region}): ${String(err)}`,
      );
      return [];
    }
  }
}
