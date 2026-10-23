/** ROK-1930 — the Deaths card's header action: the server-wide death layer on the Map tab. */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { deathsShowAllHref } from './valheim-deaths.helpers';

export function ValheimDeathsShowAll(): JSX.Element {
    return (
        <Link to={deathsShowAllHref()} data-testid="valheim-deaths-show-all"
            className={`inline-flex min-h-[44px] items-center rounded-sm text-sm font-medium text-success hover:underline ${FOCUS_RING}`}>
            Show all
        </Link>
    );
}
