/**
 * Dependencies bundle for the voice-state handler functions.
 *
 * ROK-1801 Q10: extracted from `voice-state.handlers.ts` (at the 300-line cap)
 * so new optional collaborators can be added without growing that file.
 */
import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { AdHocParticipantService } from '../services/ad-hoc-participant.service';
import type { AdHocEventService } from '../services/ad-hoc-event.service';
import type { VoiceAttendanceService } from '../services/voice-attendance.service';
import type { DepartureGraceService } from '../services/departure-grace.service';
import type { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import type { GameActivityService } from '../services/game-activity.service';
import type { UsersService } from '../../users/users.service';
import type { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { ChannelPresenceEmbedService } from '../services/channel-presence-embed.service';
import type { ServerRosterSource } from '../services/server-presence-roster.helpers';

/** Dependencies bundle for voice state handler functions. */
export interface VoiceHandlerDeps {
  logger: Logger;
  clientService: DiscordBotClientService;
  adHocEventService: AdHocEventService;
  voiceAttendanceService: VoiceAttendanceService;
  departureGraceService: DepartureGraceService;
  presenceDetector: PresenceGameDetectorService;
  gameActivityService: GameActivityService;
  usersService: UsersService;
  adHocEventsGateway: AdHocEventsGateway;
  voiceGameTracker: Map<string, { gameName: string; userId: number }>;
  userChannelMap: Map<string, string>;
  channelMembers: Map<string, Set<string>>;
  // ROK-1446 D6: the one live message per bound lobby channel. Every hook that
  // changes who is in the room, or which groups are evented, marks it dirty.
  channelPresence: ChannelPresenceEmbedService;
  // ROK-1494 A3: the LFG-born "playing now" roster route. Both are OPTIONAL so
  // every existing handler spec that builds this bundle keeps compiling and a
  // missing provider degrades to "record nothing" rather than throwing into the
  // voice pipeline.
  db?: PostgresJsDatabase<typeof schema> | null;
  adHocParticipantService?: AdHocParticipantService | null;
  // ROK-1801: who is on each game server. Optional — absent means "no server
  // presence", so every lobby count is exactly the voice-only one.
  serverRoster?: ServerRosterSource | null;
}
