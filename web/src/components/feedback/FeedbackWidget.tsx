import { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { useSubmitFeedback } from '../../hooks/use-feedback';
import { Button } from '../ui/button';
// Eager, not via the lazy panel: console + uncaught-error capture must run from
// page load, so the logs a bug report attaches include what led up to it.
import './feedback-console-capture';

/**
 * The dialog, its form state, the screenshot field and the submit flow load
 * only when the widget first opens (ROK-1313: kept out of the entry chunk).
 */
const FeedbackPanel = lazy(() => import('./FeedbackPanel').then((m) => ({ default: m.FeedbackPanel })));

const FeedbackIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
        <path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 00-1.032-.211 50.89 50.89 0 00-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 002.433 3.984L7.28 21.53A.75.75 0 016 21v-4.03a48.527 48.527 0 01-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979z" />
        <path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 001.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0015.75 7.5z" />
    </svg>
);

/**
 * The wrapper owns position, visibility and the round shape: Button has no
 * FAB mode and no tailwind-merge, so `hidden`/`rounded-full` on the button
 * itself would fight its own `inline-flex`/`rounded-lg`. The `[&>button]:`
 * variants out-rank the button's single-class utilities. 48px (`h-12 w-12`)
 * is what `ui/fab-position.ts` stacks other FABs against.
 */
const FAB_WRAPPER_CLS = 'hidden md:block fixed bottom-6 right-6 z-40 transition-transform hover:scale-110 '
    + 'active:scale-95 [&>button]:rounded-full [&>button]:p-0';

const FeedbackButton = ({ onClick }: { onClick: () => void }) => (
    <div className={FAB_WRAPPER_CLS}>
        <Button iconOnly aria-label="Send Feedback" title="Send Feedback" onClick={onClick} className="h-12 w-12 shadow-lg">
            <FeedbackIcon />
        </Button>
    </div>
);

/**
 * Floating feedback widget — available to all authenticated users.
 * ROK-186: User Feedback Widget.
 *
 * On mobile the floating trigger is hidden; the MoreDrawer
 * opens the dialog via the onRegisterOpen callback instead.
 */
export function FeedbackWidget({ onRegisterOpen }: { onRegisterOpen?: (openFn: () => void) => void }) {
    const { isAuthenticated } = useAuth();
    // Owned here, not by the lazy panel: the widget stays mounted, so a
    // submit's onSuccess (the Sentry notify) still runs if the dialog closes.
    const submitFeedback = useSubmitFeedback();
    const [isOpen, setIsOpen] = useState(false);
    const handleOpen = useCallback(() => setIsOpen(true), []);
    const handleClose = useCallback(() => setIsOpen(false), []);

    useEffect(() => { onRegisterOpen?.(handleOpen); }, [handleOpen, onRegisterOpen]);

    if (!isAuthenticated) return null;

    return (
        <div data-feedback-widget>
            <FeedbackButton onClick={handleOpen} />
            {isOpen && (
                <Suspense fallback={null}>
                    <FeedbackPanel submitFeedback={submitFeedback} onClose={handleClose} />
                </Suspense>
            )}
        </div>
    );
}
