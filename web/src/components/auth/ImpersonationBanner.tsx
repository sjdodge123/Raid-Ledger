import { heldTokenExpiry, useAuth } from '../../hooks/use-auth';
import './ImpersonationBanner.css';

/** ROK-1754: the impersonation cap, read from the held token's `exp`. */
function endsAtLabel(): string | null {
    const exp = heldTokenExpiry();
    if (exp === null) return null;
    return new Date(exp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Sticky banner shown when an admin is impersonating another user.
 * Displays at the very top of the page above all other content.
 * ROK-1754: impersonation is server-side — it survives a reload, applies to
 * every tab of this browser session, and ends at the token's capped `exp`.
 */
export function ImpersonationBanner() {
    const { user, isImpersonating, exitImpersonation } = useAuth();

    if (!isImpersonating || !user) {
        return null;
    }

    const endsAt = endsAtLabel();

    return (
        <>
            <div className="impersonation-banner">
                <div className="impersonation-banner__content">
                    <span className="impersonation-banner__icon">⚠️</span>
                    <span className="impersonation-banner__text">
                        Viewing as <strong>{user.username}</strong> · applies to all tabs
                        {endsAt && <> · ends at {endsAt}</>}
                    </span>
                    <button
                        onClick={() => void exitImpersonation()}
                        className="impersonation-banner__exit"
                    >
                        Exit Impersonation
                    </button>
                </div>
            </div>
            {/* Spacer to offset fixed banner height */}
            <div className="impersonation-banner__spacer" />
        </>
    );
}
