/** ROK-1789 Part B — the Raid progress card's header "See all": a jump to the Progression tab. */
import type { JSX } from 'react';
import { SeeAll } from './see-all-actions';

/** Raid progress (boss list) → the Progression tab. */
export function RaidProgressSeeAll(): JSX.Element {
    return <SeeAll href="#progression" testId="forever-see-all-progression" />;
}
