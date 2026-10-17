import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  HubOnboardingKey,
  HubOnboardingStateDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  GuildAccessService,
  isStaff,
  type GuildActor,
} from './guild-access.service';
import {
  parseOnboardingKey,
  parseOnboardingScope,
} from './hub-onboarding.helpers';
import {
  deleteDismissal,
  guildExists,
  insertDismissal,
  listDismissals,
} from './hub-onboarding.queries';

/**
 * ROK-1830 S5 (D11-B) — server-side dismissals for the hub onboarding
 * prompts. Rows are caller-scoped by construction: the actor always comes
 * from the JWT, so there is no cross-user read or write to guard against.
 *
 * A SCOPED dismissal still needs authorization (PR-3 review): `?guildId=` is
 * caller-supplied, so without a check any signed-in user could probe which
 * guild ids exist (an unknown one hit the FK and answered 500) and write one
 * row per existing guild. The caller must be able to see the guild, and the
 * editor checklist additionally needs edit rights, because only an editor is
 * ever shown it.
 *
 * Every method answers with the WHOLE state, so the web replaces its cache
 * instead of merging a partial response.
 */
@Injectable()
export class HubOnboardingService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  /** The caller's dismissed prompts. */
  getState(userId: number): Promise<HubOnboardingStateDto> {
    return this.state(userId);
  }

  /** Dismiss one prompt; idempotent. Unknown key or bad scope → 400. */
  async dismiss(
    actor: GuildActor,
    rawKey: unknown,
    rawQuery: unknown,
  ): Promise<HubOnboardingStateDto> {
    const { key, guildId } = await this.resolveScope(actor, rawKey, rawQuery);
    await insertDismissal(this.db, actor.id, key, guildId);
    return this.state(actor.id);
  }

  /** Undo a dismissal (the prompt comes back); idempotent. */
  async restore(
    actor: GuildActor,
    rawKey: unknown,
    rawQuery: unknown,
  ): Promise<HubOnboardingStateDto> {
    const { key, guildId } = await this.resolveScope(actor, rawKey, rawQuery);
    await deleteDismissal(this.db, actor.id, key, guildId);
    return this.state(actor.id);
  }

  /** Parse the request, then authorize the hub scope when there is one. */
  private async resolveScope(
    actor: GuildActor,
    rawKey: unknown,
    rawQuery: unknown,
  ): Promise<{ key: HubOnboardingKey; guildId: number | null }> {
    const key = parseOnboardingKey(rawKey);
    const guildId = parseOnboardingScope(rawQuery);
    if (guildId !== null) await this.authorizeScope(actor, key, guildId);
    return { key, guildId };
  }

  /**
   * Cannot view it, or it does not exist → the SAME 404; the checklist then
   * needs edit rights → 403.
   *
   * Authorization runs BEFORE existence on purpose (Codex P3 / PR-3 review):
   * a 404-for-missing + 403-for-inaccessible pair lets any signed-in user read
   * which guild ids exist straight off the status code. Membership implies the
   * row exists, so the existence query is only needed for staff, who pass
   * `canView` for every id and would otherwise reach the insert's FK.
   */
  private async authorizeScope(
    actor: GuildActor,
    key: HubOnboardingKey,
    guildId: number,
  ): Promise<void> {
    const visible = await this.access.canView(actor, guildId);
    if (!visible || (isStaff(actor) && !(await guildExists(this.db, guildId)))) {
      throw new NotFoundException(`Guild ${guildId} not found`);
    }
    if (
      key === 'hub-setup-checklist' &&
      !(await this.access.canEdit(actor, guildId))
    ) {
      throw new ForbiddenException('Only an editor sees the setup checklist');
    }
  }

  private async state(userId: number): Promise<HubOnboardingStateDto> {
    return { dismissed: await listDismissals(this.db, userId) };
  }
}
