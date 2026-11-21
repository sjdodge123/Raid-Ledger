/**
 * DemoTestSigninReminderController (ROK-2284) — sign-in reminder fixtures for
 * the Discord companion smoke. DEMO_MODE-only, behind the JWT + admin guards.
 *
 * - `POST /admin/test/signin-reminder/tick {botDiscordId}` runs ONE real pass
 *   (switch, roster fetch, account-holder drop, claim, send, stamp) aimed at
 *   that BOT guild member only — never the human roster, so a smoke run can
 *   never DM a person. A non-bot or unknown id is simply not a candidate.
 * - `POST /admin/test/signin-reminder/reset {discordId}` deletes that id's
 *   reminder row, so repeated smoke runs start from "never reminded".
 * - `POST /admin/test/signin-reminder/state {discordId}` returns the row (or
 *   null) and the DM the deployed builder would send (embed + buttons JSON).
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { discordSigninReminders } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { buildSigninReminderDm } from '../plugins/core/signin-reminder/signin-reminder.dm';
import {
  SigninReminderService,
  type SigninReminderOutcome,
} from '../plugins/core/signin-reminder/signin-reminder.service';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody, snowflakeSchema } from './demo-test.utils';

const TickBody = z.object({ botDiscordId: snowflakeSchema });
const IdBody = z.object({ discordId: snowflakeSchema });

export interface SigninReminderStateResponse {
  row: {
    sentCount: number;
    lastSentAt: string | null;
    optedOutAt: string | null;
    lastFailureCode: number | null;
  } | null;
  dm: { embeds: unknown[]; components: unknown[] };
}

@Controller('admin/test/signin-reminder')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestSigninReminderController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly reminders: SigninReminderService,
  ) {}

  @Post('tick')
  @HttpCode(HttpStatus.OK)
  tick(@Body() body: unknown): Promise<SigninReminderOutcome> {
    const { botDiscordId } = parseDemoBody(TickBody, body);
    return this.reminders.runTick(new Date(), { onlyBotId: botDiscordId });
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async reset(@Body() body: unknown): Promise<{ deleted: number }> {
    const { discordId } = parseDemoBody(IdBody, body);
    const rows = await this.db
      .delete(discordSigninReminders)
      .where(eq(discordSigninReminders.discordId, discordId))
      .returning({ discordId: discordSigninReminders.discordId });
    return { deleted: rows.length };
  }

  @Post('state')
  @HttpCode(HttpStatus.OK)
  async state(@Body() body: unknown): Promise<SigninReminderStateResponse> {
    const { discordId } = parseDemoBody(IdBody, body);
    const [row] = await this.db
      .select()
      .from(discordSigninReminders)
      .where(eq(discordSigninReminders.discordId, discordId))
      .limit(1);
    const branding = await this.settings.getBranding();
    const clientUrl = await this.settings.getClientUrl();
    const dm = buildSigninReminderDm(branding.communityName, clientUrl);
    return {
      row: row
        ? {
            sentCount: row.sentCount,
            lastSentAt: row.lastSentAt?.toISOString() ?? null,
            optedOutAt: row.optedOutAt?.toISOString() ?? null,
            lastFailureCode: row.lastFailureCode,
          }
        : null,
      dm: { embeds: [dm.embed.toJSON()], components: [dm.row.toJSON()] },
    };
  }
}
