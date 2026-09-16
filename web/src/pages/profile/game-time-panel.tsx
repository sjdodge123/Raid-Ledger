/**
 * The profile's game time — one shape per viewport (ROK-1569 → ROK-1584 §3).
 *
 * Below the phone breakpoint the seven-column grid is unusable. ROK-1579 gave
 * the phone a summary card whose one button opened the drawer; the approved
 * second pass drops the card, because every arrival tapped through it: the
 * route MOUNTS the drawer ("My game time", the shared `GameTimeCheckSheet`
 * carrying `PhoneWeekCheckStep`), and × or Save take the viewer back where they
 * came from rather than stranding them on an empty page. The saved week in
 * words now lives where it is actually useful — under "Game Time" in the More
 * drawer's profile menu (`more-drawer-submenus.tsx`).
 *
 * Desktop keeps `GameTimePanel` untouched, plus ROK-1564's "Back to the poll"
 * link for a `?return=` deep link.
 *
 * No new pattern: the drawer is the shipped sheet and every colour is a
 * `--color-*` token.
 */
import type { JSX } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { GameTimePanel } from '../../components/features/game-time';
import { PhoneWeekCheckStep } from '../../components/features/game-time/phone/PhoneWeekCheckStep';
import { PROFILE_HOURS } from '../../components/features/game-time/phone/phone-week-check.helpers';
import { useMediaQuery } from '../../hooks/use-media-query';
import { GameTimeCheckSheet } from '../scheduling/GameTimeCheckSheet';
import { safeReturnPath } from './game-time-return';
import { DESKTOP_MQ } from '../../lib/breakpoints';

/** ROK-1564: "Edit my week" on a scheduling poll lands here with `?return=`. */
function BackToPoll({ to }: { to: string }): JSX.Element {
    return (
        <Link
            to={to}
            data-testid="game-time-return-link"
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
        >
            ← Back to the poll
        </Link>
    );
}

/** True when this document has an in-app entry to go back to (react-router stamps `idx`). */
function hasInAppHistory(): boolean {
    const state = window.history.state as { idx?: number } | null;
    return typeof state?.idx === 'number' && state.idx > 0;
}

/** The phone route: the drawer itself, closing back onto wherever it came from. */
function PhoneGameTimeDrawer({ returnTo }: { returnTo: string | null }): JSX.Element {
    const navigate = useNavigate();
    // × and Save are the same exit: the editor writes on Save and reports done
    // through `useStepOneDone()`, which the sheet turns into a close. A fresh
    // deep link (bookmark, notification) has no in-app entry behind it, so
    // popping history would leave the app (review MAJOR-1): fall back to the
    // poll's `?return=` or the profile shell instead.
    const leave = (): void => {
        if (hasInAppHistory()) { void navigate(-1); return; }
        void navigate(returnTo ?? '/profile', { replace: true });
    };
    return (
        <GameTimeCheckSheet
            isOpen
            title="My game time"
            onClose={leave}
            body={<PhoneWeekCheckStep variant="profile" hours={PROFILE_HOURS} />}
        />
    );
}

/** Profile → Gaming → Game Time. */
export function ProfileGameTimePanel(): JSX.Element {
    const { isAuthenticated } = useAuth();
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const [params] = useSearchParams();
    const returnTo = safeReturnPath(params.get('return'));

    if (!isDesktop) return <PhoneGameTimeDrawer returnTo={returnTo} />;
    return (
        <div className="space-y-6">
            {returnTo && <BackToPoll to={returnTo} />}
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <GameTimePanel mode="profile" rolling enabled={isAuthenticated} />
            </div>
        </div>
    );
}
