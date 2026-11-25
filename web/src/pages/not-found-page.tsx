/**
 * The catch-all route's page (ROK-2319): an unknown or mistyped URL (an old share link,
 * `/event/123`) used to render the layout with an empty main area. It is outside the
 * AuthGuard, so a signed-out visitor gets the same page; "Go home" lands on `/`, which
 * is the sign-in page for them and their default page for a member.
 */
import type { JSX } from 'react';
import { NotFoundState } from '../components/common/not-found-state';

export const NOT_FOUND_TITLE = 'Page not found';

export function NotFoundPage(): JSX.Element {
    return (
        <div className="max-w-5xl mx-auto px-4 pt-8">
            <NotFoundState
                testId="route-not-found"
                title={NOT_FOUND_TITLE}
                message="We couldn't find that page. The link may be old or mistyped."
                action={{ to: '/', label: 'Go home' }}
            />
        </div>
    );
}
