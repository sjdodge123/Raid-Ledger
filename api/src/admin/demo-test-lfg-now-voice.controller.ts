/**
 * DemoTestLfgNowVoiceController — DEMO_MODE-only voice join/leave for an
 * LFG-born "playing now" event's ephemeral channel.
 *
 * The LFM PLAYING NOW head-count smoke (`lfm-playing.test.ts`) used to move the
 * count by joining voice with the companion bot. That can never work: the join
 * dispatch drops bot members before they reach the roster
 * (`voice-state-join-dispatch.handlers.ts`, `isBotMember`), and CI cannot open
 * a voice connection at all (`SMOKE_SKIP_VOICE_JOIN=1`). These endpoints let a
 * smoke record a SEEDED, Discord-linked human instead.
 *
 * They drive the listener's own path, not a copy of it: `recordLfgNowVoiceJoin`
 * / `recordLfgNowVoiceLeave` with deps narrowed by the same `lfgNowDeps` the
 * voice listener uses, so from `recordLfgNowVoiceJoin` down — the roster
 * write, the PARTICIPANT_JOINED/LEFT emit and the post re-render — they match
 * a real join/leave. What they SKIP is the gateway → unbound-channel routing
 * above it (`handleChannelJoin`, `trackScheduledEventJoin`, the "no binding"
 * branch of `resolveAllBindings`, the `isBotMember` gate); that routing is
 * pinned by `lfg-now-voice.helpers.spec.ts`, and this controller's module
 * wiring by `demo-test-lfg-now-voice.integration.spec.ts`.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { AdHocParticipantService } from '../discord-bot/services/ad-hoc-participant.service';
import {
  lfgNowDeps,
  recordLfgNowVoiceJoin,
  recordLfgNowVoiceLeave,
  type LfgNowVoiceDeps,
} from '../discord-bot/lfg-now/lfg-now-voice.helpers';
import {
  loadLinkedDemoMember,
  parseDemoBody,
  snowflakeSchema,
} from './demo-test.utils';

/** `{ userId, channelId }` — a seeded user and the event's voice channel. */
const LfgNowVoiceSchema = z.object({
  userId: z.number().int().positive(),
  channelId: snowflakeSchema,
});

/** Response for both endpoints: `eventId` is null when no open event matched. */
export interface LfgNowVoiceResult {
  recorded: boolean;
  eventId: number | null;
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestLfgNowVoiceController {
  private readonly logger = new Logger(DemoTestLfgNowVoiceController.name);

  constructor(
    private readonly settingsService: SettingsService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly participantService: AdHocParticipantService,
    private readonly usersService: UsersService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Record `userId` joining `channelId`, as the voice listener would. */
  @Post('lfg-now/voice-join')
  @HttpCode(HttpStatus.OK)
  async voiceJoin(@Body() body: unknown): Promise<LfgNowVoiceResult> {
    await this.assertDemoMode();
    const { userId, channelId } = parseDemoBody(LfgNowVoiceSchema, body);
    const member = await loadLinkedDemoMember(this.usersService, userId);
    const eventId = await recordLfgNowVoiceJoin(this.deps(), channelId, member);
    return { recorded: eventId !== null, eventId };
  }

  /** Record `userId` leaving `channelId`, as the voice listener would. */
  @Post('lfg-now/voice-leave')
  @HttpCode(HttpStatus.OK)
  async voiceLeave(@Body() body: unknown): Promise<LfgNowVoiceResult> {
    await this.assertDemoMode();
    const { userId, channelId } = parseDemoBody(LfgNowVoiceSchema, body);
    const { discordUserId } = await loadLinkedDemoMember(
      this.usersService,
      userId,
    );
    const eventId = await recordLfgNowVoiceLeave(
      this.deps(),
      channelId,
      discordUserId,
    );
    return { recorded: eventId !== null, eventId };
  }

  /** The listener's dependency narrowing, fed this controller's providers. */
  private deps(): LfgNowVoiceDeps {
    return lfgNowDeps({
      db: this.db,
      adHocParticipantService: this.participantService,
      usersService: this.usersService,
      logger: this.logger,
    });
  }
}
