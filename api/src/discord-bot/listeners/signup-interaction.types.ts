import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { SignupsService } from '../../events/signups.service';
import type { EventsService } from '../../events/events.service';
import type { CharactersService } from '../../characters/characters.service';
import type { IntentTokenService } from '../../auth/intent-token.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { DiscordEmbedFactory } from '../services/discord-embed.factory';
import type { DiscordEmojiService } from '../services/discord-emoji.service';
import type { SettingsService } from '../../settings/settings.service';

/**
 * Shared dependency bag for signup interaction handlers.
 * Avoids deep constructor injection coupling while keeping handlers testable.
 */
export interface SignupInteractionDeps {
  db: PostgresJsDatabase<typeof schema>;
  logger: Logger;
  clientService: DiscordBotClientService;
  signupsService: SignupsService;
  eventsService: EventsService;
  charactersService: CharactersService;
  intentTokenService: IntentTokenService;
  embedFactory: DiscordEmbedFactory;
  emojiService: DiscordEmojiService;
  settingsService: SettingsService;
  updateEmbedSignupCount: (eventId: number) => Promise<void>;
}
