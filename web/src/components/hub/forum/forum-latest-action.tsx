/** ROK-1175 — the "Latest threads" card's header action, "Open the Forum" → `#forum` (eager, no query). */
import type { JSX } from 'react';
import { JumpLink } from '../card-bits';

export function ForumLatestAction(): JSX.Element {
    return <JumpLink testId="forum-latest-open" href="#forum">Open the Forum</JumpLink>;
}
