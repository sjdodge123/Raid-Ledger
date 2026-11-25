/**
 * ROK-2352 §3.4 / AC5 — what a WoW instance group's lock-in adds to the
 * event: an `mmo` roster in the instance's shape, the instance as the event's
 * content, and the instance name as the title.
 */
import { wowRosterShapeForSize, type SlotConfigDto } from '@raid-ledger/contract';
import type { WowLfgInstance } from './wow-lfg-catalogue';

/** The non-carryover half of a WoW `LfgLockInPatch`. */
export interface WowLockInFields {
  slotConfig: SlotConfigDto;
  contentInstances: Record<string, unknown>[];
  title: string;
}

/**
 * Roster, content and title for a lock-in of `inst`'s group.
 *
 * @param inst - The instance the group is about.
 */
export function buildWowLockInFields(inst: WowLfgInstance): WowLockInFields {
  const shape = wowRosterShapeForSize(inst.maxPlayers, inst.category);
  const size = shape.tank + shape.healer + shape.dps;
  // Same shape as the event-create content browser's `WowInstanceDetailDto`.
  const content: Record<string, unknown> = {
    id: inst.id,
    name: inst.name,
    ...(inst.shortName !== undefined ? { shortName: inst.shortName } : {}),
    expansion: inst.expansion,
    minimumLevel: inst.minimumLevel,
    maximumLevel: inst.maximumLevel,
    maxPlayers: inst.maxPlayers ?? size,
    category: inst.category,
  };
  return {
    slotConfig: { type: 'mmo', ...shape },
    contentInstances: [content],
    title: inst.name,
  };
}
