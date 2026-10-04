/**
 * DemoTestRenderPugInviteEmbedController — DEMO_MODE-only render seam for the
 * PUG fill-request DM.
 *
 * The companion bot cannot read a DM another bot sends (Discord 50007), so the
 * PUG invite's chrome (amber `needs_you` colour, `FILL NEEDED` author line,
 * role footer, Accept / Decline / View Event row) was assertable at unit tier
 * only. This endpoint composes the invite the way
 * `PugInviteService.sendPugInviteDm` does (`pug-invite.service.ts:278-309`,
 * composition at :285-306): `loadInviteContext` for branding,
 * `loadPugInviteData` for the personalized fields, cover and roster count,
 * then the real `buildPugInviteEmbed`. It returns the rendered embed and
 * button row as Discord API JSON.
 *
 * Two deliberate divergences from the send path:
 * - `voiceChannelId` is always null. Resolving it needs the Discord bot
 *   module's `ChannelResolverService`, and importing that here would add a
 *   forwardRef cycle. So the seam never renders a Voice Channel field, and the
 *   smoke cannot prove anything about one.
 *
 * The personalized-field cap is NOT provable through this seam at smoke tier:
 * `loadPugInviteData` already trims to two (`toFields`,
 * `pug-invite-personalization.helpers.ts`), and the smoke seeds no library
 * rows, so the invitee usually gets none. `buildPugInviteEmbed`'s own cap
 * (`MAX_PERSONALIZED_FIELDS`) is pinned at unit tier only — by
 * `pug-invite.helpers.spec.ts` and this seam's controller spec ("caps three
 * personalized fields at two"), which mocks the loader with three fields.
 * - Pure render: no `pug_slots` row, no DM send, no DB write. The slot id is a
 *   fixed placeholder, so the Accept / Decline custom ids match no real slot.
 *
 * Consumer: the companion-bot smoke suite (`tools/test-bot`).
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { buildPugInviteEmbed } from '../discord-bot/services/pug-invite.helpers';
import { loadInviteContext } from '../discord-bot/services/pug-invite.member-helpers';
import { loadPugInviteData } from '../discord-bot/services/pug-invite-personalization.helpers';
import { RenderPugInviteEmbedSchema } from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';

/** Fixed id: the seam renders, it never creates a `pug_slots` row. */
export const RENDER_PUG_SLOT_ID = 'demo-render-pug-invite';

type EventRow = typeof schema.events.$inferSelect;

/** The rendered PUG invite DM, as the Discord API would receive it. */
export interface RenderedPugInviteEmbed {
  communityName: string;
  embed: ReturnType<EmbedBuilder['toJSON']>;
  components: ReturnType<ActionRowBuilder<ButtonBuilder>['toJSON']>[];
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestRenderPugInviteEmbedController {
  constructor(
    private readonly settingsService: SettingsService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** The full event row: the builder reads duration, title, gameId and cap. */
  private async loadEvent(eventId: number): Promise<EventRow> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    return event;
  }

  /** Render a PUG invite DM embed without sending it (DEMO_MODE only). */
  @Post('render-pug-invite-embed')
  @HttpCode(HttpStatus.OK)
  async renderPugInviteEmbed(
    @Body() body: unknown,
  ): Promise<RenderedPugInviteEmbed> {
    await this.assertDemoMode();
    const input = parseDemoBody(RenderPugInviteEmbedSchema, body);
    const event = await this.loadEvent(input.eventId);
    const ctx = await loadInviteContext(this.settingsService);
    const data = await loadPugInviteData(this.db, {
      discordUserId: input.discordUserId ?? null,
      gameId: event.gameId ?? null,
      eventId: event.id,
    });
    const { embed, row } = buildPugInviteEmbed({
      pugSlotId: RENDER_PUG_SLOT_ID,
      eventId: event.id,
      event,
      communityName: ctx.communityName,
      clientUrl: ctx.clientUrl,
      voiceChannelId: null,
      role: input.role ?? null,
      signupCount: data.signupCount,
      personalized: data.fields,
      coverUrl: data.coverUrl,
    });
    return renderedJson(ctx.communityName, embed, row);
  }
}

/** `row` is optional on `InviteDm`: no row renders as no components. */
function renderedJson(
  communityName: string,
  embed: EmbedBuilder,
  row: ActionRowBuilder<ButtonBuilder> | undefined,
): RenderedPugInviteEmbed {
  return {
    communityName,
    embed: embed.toJSON(),
    components: row ? [row.toJSON()] : [],
  };
}
