import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubOnboardingStateDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  parseOnboardingKey,
  parseOnboardingScope,
} from './hub-onboarding.helpers';
import {
  deleteDismissal,
  insertDismissal,
  listDismissals,
} from './hub-onboarding.queries';

/**
 * ROK-1830 S5 (D11-B) — server-side dismissals for the hub onboarding
 * prompts. Caller-scoped by construction: `userId` always comes from the JWT,
 * so there is no cross-user read or write to guard against.
 *
 * Every method answers with the WHOLE state, so the web replaces its cache
 * instead of merging a partial response.
 */
@Injectable()
export class HubOnboardingService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** The caller's dismissed prompts. */
  getState(userId: number): Promise<HubOnboardingStateDto> {
    return this.state(userId);
  }

  /** Dismiss one prompt; idempotent. Unknown key or bad scope → 400. */
  async dismiss(
    userId: number,
    rawKey: unknown,
    rawQuery: unknown,
  ): Promise<HubOnboardingStateDto> {
    const key = parseOnboardingKey(rawKey);
    const guildId = parseOnboardingScope(rawQuery);
    await insertDismissal(this.db, userId, key, guildId);
    return this.state(userId);
  }

  /** Undo a dismissal (the prompt comes back); idempotent. */
  async restore(
    userId: number,
    rawKey: unknown,
    rawQuery: unknown,
  ): Promise<HubOnboardingStateDto> {
    const key = parseOnboardingKey(rawKey);
    const guildId = parseOnboardingScope(rawQuery);
    await deleteDismissal(this.db, userId, key, guildId);
    return this.state(userId);
  }

  private async state(userId: number): Promise<HubOnboardingStateDto> {
    return { dismissed: await listDismissals(this.db, userId) };
  }
}
