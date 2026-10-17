/**
 * Full-roster tentative displacement predicate (ROK-1729).
 *
 * The web/API signup flow auto-benches a newcomer when the non-bench roster
 * is at capacity. On an MMO event a CONFIRMED newcomer must instead be allowed
 * into allocation when a tentative player occupies a role it prefers, so the
 * ROK-459 displacement path can bump that player. Role-aware: a tentative
 * occupant in a role the newcomer does not want does not count.
 */
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { CreateSignupDto } from '@raid-ledger/contract';
import type { Tx, EventRow } from './signups.service.types';

const DISPLACEABLE_ROLES: readonly string[] = ['tank', 'healer', 'dps'];

/** The incoming signup's roles that a tentative occupant can be bumped from. */
export function displaceableRoles(dto: CreateSignupDto): string[] {
  const prefs = dto.preferredRoles?.length ? dto.preferredRoles : null;
  const raw: string[] = prefs ?? (dto.slotRole ? [dto.slotRole] : []);
  return raw.filter((r) => DISPLACEABLE_ROLES.includes(r));
}

/**
 * True when the incoming signup may bump a tentative occupant: MMO event, not
 * a bench request, at least one tank/healer/dps preference, the incoming user
 * is not themselves tentative on this event (the duplicate re-signup path),
 * and a tentative player holds one of those roles.
 */
export async function hasDisplaceableTentative(
  tx: Tx,
  eventRow: Pick<EventRow, 'slotConfig'>,
  eventId: number,
  dto: CreateSignupDto,
  userId: number,
): Promise<boolean> {
  const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type !== 'mmo' || dto.slotRole === 'bench') return false;
  const roles = displaceableRoles(dto);
  if (roles.length === 0) return false;
  if (await isUserTentative(tx, eventId, userId)) return false;
  return hasTentativeOccupant(tx, eventId, roles);
}

async function isUserTentative(
  tx: Tx,
  eventId: number,
  userId: number,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
        eq(schema.eventSignups.status, 'tentative'),
      ),
    )
    .limit(1);
  return !!row;
}

async function hasTentativeOccupant(
  tx: Tx,
  eventId: number,
  roles: string[],
): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.rosterAssignments.id })
    .from(schema.rosterAssignments)
    .innerJoin(
      schema.eventSignups,
      eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
    )
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        inArray(schema.rosterAssignments.role, roles),
        eq(schema.eventSignups.status, 'tentative'),
      ),
    )
    .limit(1);
  return !!row;
}
