import { Injectable } from '@nestjs/common';
import type {
  ServerDeathEvent,
  ServerDeathSink,
} from '../../pelican/presence/server-death.sink';
import type { ServerPresenceSource } from '../../pelican/presence/server-presence.sink';
import { SettingsService } from '../../../settings/settings.service';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';
import { deathOccurredAt } from './valheim-deaths.helpers';
import { ValheimDeathsRepository } from './valheim-deaths.repository';
import { resolvePlayTimezone } from './valheim-skill-days.helpers';

/**
 * ROK-1930 D2 — the Valheim plugin's {@link ServerDeathSink}. Ignores any
 * server not mapped to Valheim. `occurred_at` is the line's wall-clock time
 * in the server's timezone (server → community default → UTC, as ROK-1882's
 * play days), clamped to the receive time and falling back to it for an
 * unparseable stamp — see {@link deathOccurredAt}.
 */
@Injectable()
export class ValheimDeathSink implements ServerDeathSink {
  constructor(
    private readonly repo: ValheimDeathsRepository,
    private readonly settings: SettingsService,
  ) {}

  async playerDied(
    source: ServerPresenceSource,
    death: ServerDeathEvent,
  ): Promise<void> {
    const ctx = await this.repo.findServerContext(source.pelicanServerId);
    if (ctx?.gameSlug !== VALHEIM_GAME_SLUG) return;
    const tz = resolvePlayTimezone(
      ctx.timezone,
      await this.settings.getDefaultTimezone(),
    );
    await this.repo.recordLogDeath(source.pelicanServerId, {
      characterName: death.characterName,
      steamId: death.steamId,
      loggedAt: death.loggedAt,
      occurredAt: deathOccurredAt(death.loggedAt, tz, death.at),
    });
  }
}
