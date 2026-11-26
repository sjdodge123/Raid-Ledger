/**
 * Post-commit side effects of a server-born Quick Play spawn, extracted from
 * `AdHocServerPresenceService` (ROK-2355) to keep it under the line cap.
 */
import type { Logger } from '@nestjs/common';
import type { AdHocEventService } from './ad-hoc-event.service';
import { enrolGame, type EnrolDeps } from './ad-hoc-server-enrol.helpers';
import {
  announceServerSpawn,
  type SpawnPlan,
} from './ad-hoc-server-presence.effects';
import { serverSourceKey } from './ad-hoc-server-presence.helpers';
import type { ServerSpawnInput } from './ad-hoc-server-spawn.helpers';
import {
  emitServerSpawn,
  type SpawnEmitter,
} from './ad-hoc-spawn-events.helpers';

export interface AfterServerSpawnDeps {
  enrol: EnrolDeps;
  adHocEventService: Pick<AdHocEventService, 'adoptEvent'>;
  eventEmitter: SpawnEmitter;
  logger: Pick<Logger, 'log'>;
}

export interface ServerSpawnResult {
  eventId: number;
  plan: SpawnPlan;
  input: ServerSpawnInput;
  joined: (number | null)[];
}

export async function afterServerSpawn(
  deps: AfterServerSpawnDeps,
  { eventId, plan, input, joined }: ServerSpawnResult,
): Promise<void> {
  if (input.bindingId)
    deps.adHocEventService.adoptEvent(input.bindingId, input.gameId, eventId);
  // Post-commit (Codex r9 P2): the Quick Play itself, then its joiners.
  emitServerSpawn(deps.eventEmitter, eventId, input.gameId, joined);
  await announceServerSpawn(deps.enrol.fx, eventId, plan, input.ids);
  const live = {
    id: eventId,
    channelBindingId: input.bindingId,
    adHocStatus: 'live',
  };
  await enrolGame(deps.enrol, input.gameId, live, input.pelicanServerId);
  deps.logger.log(
    `Server ${serverSourceKey(input.pelicanServerId)} spawned Quick Play ${eventId}`,
  );
}
