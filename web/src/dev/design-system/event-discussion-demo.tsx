/**
 * ROK-2226 — event discussion bits for /dev/design-system (docs/design-system.md
 * §4.35): the forum event header (open, cancelled, locked) and the row pills.
 * The event-page Discussion card itself is data-driven (`useEventDiscussion`);
 * its states are pinned by `EventDiscussionCard.test.tsx`. Tokens only.
 */
import type { JSX } from 'react';
import type { HubForumLock, HubForumThreadEvent } from '@raid-ledger/contract';
import { ForumEventHeader, ForumEventPills, ForumLockBar } from '../../components/hub/forum/forum-event-header';
import { StateFrame } from './design-system-bits';

const EVENT: HubForumThreadEvent = {
    id: 42, title: 'Molten Core', startTime: '2026-11-22T19:00:00.000Z', endTime: '2026-11-22T22:00:00.000Z', cancelled: false,
};
const LOCK: HubForumLock = { at: '2026-11-23T22:00:00.000Z', reason: 'event-ended' };

/** One frame: header open / cancelled / locked, the list-row pills, and the card's lock line. */
export function EventDiscussionDemo(): JSX.Element {
    return (
        <StateFrame label="Event discussion — forum event header + pills" note="forum-event-header.tsx (ROK-2226): above an event thread; the pills sit on Forum list and Latest rows; ForumLockBar is shared with the event-page Discussion card.">
            <div className="flex w-full flex-col gap-3" data-testid="ds-event-discussion">
                <ForumEventHeader event={EVENT} lock={null} />
                <ForumEventHeader event={{ ...EVENT, cancelled: true }} lock={null} />
                <ForumEventHeader event={EVENT} lock={LOCK} />
                <span className="flex flex-wrap gap-2"><ForumEventPills event={EVENT} lock={null} /><ForumEventPills event={EVENT} lock={LOCK} /></span>
                <ForumLockBar lock={{ ...LOCK, reason: 'event-deleted' }} />
            </div>
        </StateFrame>
    );
}
