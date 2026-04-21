/**
 * Client-side mirror of the server's assertUserCanParticipate (ROK-1065).
 * Authoritative check is still server-side; this lets the UI disable
 * write actions (nominate / vote) for non-invitees on private lineups.
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';

interface ParticipantUser {
  id: number;
  role?: string;
}

/**
 * Returns true when the viewer can nominate / vote on the given lineup:
 * public lineups are always writable; private lineups only by admins,
 * operators, the creator, or explicit invitees.
 */
export function canParticipateInLineup(
  lineup: Pick<
    LineupDetailResponseDto,
    'visibility' | 'createdBy' | 'invitees'
  > | null
    | undefined,
  user: ParticipantUser | null | undefined,
): boolean {
  if (!lineup) return false;
  if (lineup.visibility === 'public') return true;
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'operator') return true;
  if (lineup.createdBy?.id === user.id) return true;
  return (lineup.invitees ?? []).some((i) => i.id === user.id);
}
