/**
 * ROK-2039 — `POST /events` no longer accepts `schedulingMatchId`.
 *
 * The old lock-in was two calls (`POST /events {schedulingMatchId}` then
 * `POST /scheduling-polls/:matchId/complete`), and two organizers could both
 * create + announce an event for one poll before either `/complete` landed.
 * The claim-first `POST /scheduling-polls/:matchId/lock-in` (ROK-2032) is the
 * only door now; it still stamps the provenance through `EventsService.create`
 * directly, so this guard sits at the HTTP boundary only.
 */
import { BadRequestException } from '@nestjs/common';
import type { CreateEventDto } from '@raid-ledger/contract';

/** Throws 400 when a public create carries `schedulingMatchId`. */
export function rejectSchedulingMatchOnCreate(dto: CreateEventDto): void {
  const matchId = dto.schedulingMatchId;
  if (matchId === undefined) return;
  throw new BadRequestException(
    `schedulingMatchId is not accepted on POST /events; lock the poll in ` +
      `with POST /scheduling-polls/${matchId}/lock-in instead`,
  );
}
