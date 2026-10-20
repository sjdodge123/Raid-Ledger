/**
 * ROK-1856 — the ROK-1831 L-5 hidden-hub rule for the armory routes. They are
 * keyed by character or server id, never by guild id, so `HubVisibleGuard`
 * cannot apply; these resolve the hub first. Hidden → the same 404 body as
 * the core hub routes (`HUB_NOT_FOUND`); staff always pass; a character or
 * server with no hub passes (the handler owns any "not found").
 */
import { NotFoundException } from '@nestjs/common';
import {
  isStaff,
  type GuildActor,
} from '../../../../guilds/guild-access.service';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import type { ValheimArmoryReadRepository } from './valheim-armory-read.repository';

/** A server's hub as the read repository resolves it. */
export type ArmoryHub = { id: number; hidden: boolean } | null;

type HubLookup = Pick<
  ValheimArmoryReadRepository,
  'findServerHub' | 'findProfileHub'
>;

/** True when the hub is hidden and the actor is not staff (`isHiddenFrom`). */
export function hubHiddenFrom(hub: ArmoryHub, actor: GuildActor): boolean {
  return hub !== null && hub.hidden && !isStaff(actor);
}

/** 404 `Guild not found` when the hub is hidden from the actor. */
export function refuseHiddenHub(hub: ArmoryHub, actor: GuildActor): void {
  if (hubHiddenFrom(hub, actor)) throw new NotFoundException(HUB_NOT_FOUND);
}

/** L-5 for a server-keyed route (blobs). */
export async function assertServerHubVisible(
  repo: HubLookup,
  actor: GuildActor,
  serverId: number,
): Promise<void> {
  if (isStaff(actor)) return;
  refuseHiddenHub(await repo.findServerHub(serverId), actor);
}

/** L-5 for a character-keyed route (detail, maps, map bytes, claim). */
export async function assertCharacterHubVisible(
  repo: HubLookup,
  actor: GuildActor,
  characterId: number,
): Promise<void> {
  if (isStaff(actor)) return;
  refuseHiddenHub(await repo.findProfileHub(characterId), actor);
}
