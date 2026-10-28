/** ROK-1958 D-9 — the Session history header action: the Campaign tab's history (`#campaign`). */
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FOCUS_RING } from '../../../components/ui/form-classes';

export function Bg3SeeAllAction(): JSX.Element {
    const { pathname, search } = useLocation();
    return (
        <Link to={{ pathname, search, hash: '#campaign' }} data-testid="bg3-sessions-show-all"
            className={`inline-flex min-h-[44px] items-center rounded-sm text-sm font-medium text-success hover:underline ${FOCUS_RING}`}>
            Show all
        </Link>
    );
}
