/**
 * DemoTestQuickPlayVoiceController — DEMO_MODE-only Quick Play voice join for
 * a `game-voice-monitor` binding (ROK-1390), or for a `general-lobby` binding
 * with an explicit game (ROK-1766).
 *
 * The lobby branch exists because a lobby binding has no stored game: a real
 * lobby spawn takes its game from the members' presence groups, and the
 * listener filters bots out of those groups, so the companion bot can never
 * form one. The body's `gameId` (+ optional `gameName`) stands in for the
 * group's game and reaches `handleVoiceJoin` as `resolvedGameId` /
 * `resolvedGameName`, exactly where the listener would pass it.
 *
 * The series quick-play smoke (`series-dual-binding.test.ts`) used to trigger
 * the spawn by joining voice with the companion bot under a /playing override.
 * That can never mint an event: a bot counts toward the threshold but is never
 * rostered (ROK-1445 AC9), so a bot-only room ends at the `no-human-members`
 * gate trace. CI cannot open a voice connection at all either
 * (`SMOKE_SKIP_VOICE_JOIN=1`). This endpoint records a SEEDED, Discord-linked
 * human joining instead.
 *
 * What runs for real: the ROK-959 suppression guard (`ensureNotSuppressed`,
 * whose clearance rides into the join exactly as on the listener's immediate
 * spawn), the event mint in `handleVoiceJoin`, and the LIVE embed post through
 * the series routing tier. What it SKIPS: the gateway → gate routing above it
 * (`handleChannelJoin`, `resolveAllBindings`, the threshold count) and the
 * `isBotMember` roster filter. Those are pinned by
 * `voice-state.bot-filter.spec.ts` and `voice-state.rok-697.spawn.spec.ts`.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { AdHocEventService } from '../discord-bot/services/ad-hoc-event.service';
import { ChannelBindingsService } from '../discord-bot/services/channel-bindings.service';
import type { VoiceMemberInfo } from '../discord-bot/services/ad-hoc-participant.service';
import type { ResolvedBinding } from '../discord-bot/listeners/voice-state.helpers';
import {
  loadLinkedDemoMember,
  parseDemoBody,
  snowflakeSchema,
} from './demo-test.utils';

/**
 * `{ userId, bindingId, channelId }` — a seeded user, the bind, its voice
 * channel. `gameId`/`gameName` are the lobby group's game: required for a
 * `general-lobby` bind, refused for a monitor (its game is the bind's own).
 */
const QuickPlayVoiceSchema = z.object({
  userId: z.number().int().positive(),
  bindingId: z.string().uuid(),
  channelId: snowflakeSchema,
  gameId: z.number().int().positive().optional(),
  gameName: z.string().min(1).max(200).optional(),
});
type QuickPlayVoiceBody = z.infer<typeof QuickPlayVoiceSchema>;

const VOICE_PURPOSES: ReadonlySet<string> = new Set([
  'game-voice-monitor',
  'general-lobby',
]);

/** `eventId` is the minted (or joined) event; null when nothing was recorded. */
export interface QuickPlayVoiceResult {
  spawned: boolean;
  eventId: number | null;
  reason?: 'suppressed';
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestQuickPlayVoiceController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly adHocEventService: AdHocEventService,
    private readonly channelBindingsService: ChannelBindingsService,
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

  /** Record `userId` joining the bind's voice channel, as the listener would. */
  @Post('quick-play/voice-join')
  @HttpCode(HttpStatus.OK)
  async voiceJoin(@Body() body: unknown): Promise<QuickPlayVoiceResult> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(QuickPlayVoiceSchema, body);
    const { channelId } = parsed;
    const binding = await this.loadVoiceBinding(parsed.bindingId, channelId);
    const gameId = this.effectiveGameId(binding, parsed);
    const member = await this.loadMember(parsed.userId);
    const svc = this.adHocEventService;
    const clearance = await svc.ensureNotSuppressed(
      binding.bindingId,
      gameId,
      channelId,
    );
    if (!clearance)
      return { spawned: false, eventId: null, reason: 'suppressed' };
    const spawned = await svc.handleVoiceJoin(
      binding.bindingId,
      member,
      binding,
      parsed.gameId,
      parsed.gameName,
      channelId,
      clearance,
    );
    const state = svc.getActiveState(binding.bindingId, gameId);
    return { spawned, eventId: spawned ? (state?.eventId ?? null) : null };
  }

  /** A lobby needs the body's game; a monitor keeps its own and refuses one. */
  private effectiveGameId(
    binding: ResolvedBinding,
    body: QuickPlayVoiceBody,
  ): number | null {
    const lobby = binding.bindingPurpose === 'general-lobby';
    if (lobby && body.gameId === undefined) {
      throw new BadRequestException(
        `Binding ${binding.bindingId} is a general-lobby: pass gameId`,
      );
    }
    if (!lobby && (body.gameId !== undefined || body.gameName !== undefined)) {
      throw new BadRequestException(
        `Binding ${binding.bindingId} is a game-voice-monitor: gameId/gameName are lobby-only`,
      );
    }
    return lobby ? (body.gameId ?? null) : binding.gameId;
  }

  /**
   * The bind as the listener resolves it (`mapToResolvedBinding`). A real join
   * reaches a binding only through its own channel, and suppression is
   * channel-scoped, so a `channelId` other than the bind's is refused.
   */
  private async loadVoiceBinding(
    id: string,
    channelId: string,
  ): Promise<ResolvedBinding> {
    const row = await this.channelBindingsService.getBindingById(id);
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    if (!VOICE_PURPOSES.has(row.bindingPurpose)) {
      throw new BadRequestException(
        `Binding ${id} is not a game-voice-monitor or general-lobby`,
      );
    }
    if (row.channelId !== channelId) {
      throw new BadRequestException(
        `Binding ${id} monitors channel ${row.channelId}, not ${channelId}`,
      );
    }
    // jsonb never holds `undefined`; `mapToResolvedBinding` takes the column
    // as `unknown` and casts it the same way.
    const config: unknown = row.config;
    return {
      bindingId: row.id,
      gameId: row.gameId,
      gameName: null,
      bindingPurpose: row.bindingPurpose,
      recurrenceGroupId: row.recurrenceGroupId ?? null,
      config: config as ResolvedBinding['config'],
    };
  }

  /** The Discord member a real voice state would carry, rostered as `userId`. */
  private async loadMember(userId: number): Promise<VoiceMemberInfo> {
    const linked = await loadLinkedDemoMember(this.usersService, userId);
    return { ...linked, userId };
  }
}
