/**
 * ROK-1598 §2.5 + D5 (L2): one Raid Ledger copy → the iCalendar object PUT
 * into the user's Apple calendar.
 *
 * `UID` and `X-RAID-LEDGER-ID` are both the copy id, so the read path
 * recognises the copy (D5 step 1, or step 2 if a client drops the X-prop).
 * Title + Busy/Free come from `copy-presentation.helpers` so Apple, Google
 * and the fake present tentative / bench copies identically. No `METHOD`
 * line (RFC 4791 §4.1); CRLF, escaping and 75-octet folding are the feed
 * writer's (`serializeIcsCalendar`).
 */
import { serializeIcsCalendar } from '../../feed/ics-serialize.helpers';
import type { CopyEventInput } from '../calendar-provider.interface';
import { copyIsBusy, copySummary } from '../copy-presentation.helpers';

export const APPLE_COPY_PRODID = '-//Raid Ledger//Calendar Sync//EN';

export function buildCopyIcs(input: CopyEventInput, now: Date): string {
  return serializeIcsCalendar({
    prodId: APPLE_COPY_PRODID,
    omitMethod: true,
    events: [
      {
        uid: input.copyId,
        raidLedgerId: input.copyId,
        stamp: now,
        start: input.start,
        end: input.end,
        summary: copySummary(input),
        description: input.description,
        url: input.url,
        status: input.tentative ? 'TENTATIVE' : 'CONFIRMED',
        transparency: copyIsBusy(input) ? 'OPAQUE' : 'TRANSPARENT',
      },
    ],
  });
}
