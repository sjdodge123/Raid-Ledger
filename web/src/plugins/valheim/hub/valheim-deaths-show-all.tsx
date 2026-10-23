/** ROK-1930 — the Deaths card's header action: the server-wide death layer on the Map tab. */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { DEATHS_SHOW_ALL_HREF } from '../map/pin-filter-params';

export function ValheimDeathsShowAll(): JSX.Element {
    return (
        <Link to={DEATHS_SHOW_ALL_HREF} data-testid="valheim-deaths-show-all"
            className={`inline-flex min-h-[44px] items-center rounded-sm text-sm font-medium text-success hover:underline ${FOCUS_RING}`}>
            Show all
        </Link>
    );
}
