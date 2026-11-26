/**
 * Sign-in patterns for /dev/design-system (ROK-2370): the "Last used" sign-in
 * card for each method and the Discord-app code panel's states (waiting,
 * expired, signed in). Renders the real login components with fake data and
 * no-op handlers. Tokens only — check both colour families here.
 */
import type { JSX } from 'react';
import { LastUsedSigninCard } from '../../pages/login/LastUsedSigninCard';
import {
    EXPIRED_COPY, SigninCodeMessage, SigninCodeSignedIn, SigninCodeWaiting,
} from '../../pages/login/signin-code-panel-parts';
import type { LastSignin } from '../../lib/last-signin';
import { Section, StateFrame, StateGrid } from './design-system-bits';

const NOOP = (): void => undefined;
const DEMO_CODE = 'K7QD-2M9X';
const FAR_EXPIRY = '2099-01-01T00:00:00.000Z';

const MARKERS: LastSignin[] = [
    { method: 'discord', name: 'Mirelle', avatarUrl: null, at: 0 },
    { method: 'discord-app-code', name: 'Thornwick', avatarUrl: null, at: 0 },
    { method: 'password', name: 'admin', avatarUrl: null, at: 0 },
];

/** One frame per remembered method. */
function LastUsedFrames(): JSX.Element {
    return (
        <>
            {MARKERS.map((marker) => (
                <StateFrame key={marker.method} label={`Last used — ${marker.method}`}
                    note="LastUsedSigninCard: avatar, name, method, neutral Last used Pill, arrow; Not you? outside the button.">
                    <div className="w-full max-w-sm">
                        <LastUsedSigninCard marker={marker} onContinue={NOOP} onNotYou={NOOP} />
                    </div>
                </StateFrame>
            ))}
        </>
    );
}

/** The code panel's waiting, expired and signed-in states. */
function CodePanelFrames(): JSX.Element {
    return (
        <>
            <StateFrame label="Code panel — waiting" note="Code tile + Copy code, the /login instruction, countdown, Cancel.">
                <div className="w-full max-w-sm"><SigninCodeWaiting code={DEMO_CODE} expiresAt={FAR_EXPIRY} onCancel={NOOP} /></div>
            </StateFrame>
            <StateFrame label="Code panel — expired" note="One line + Get a new code.">
                <div className="w-full max-w-sm"><SigninCodeMessage message={EXPIRED_COPY} action="Get a new code" onAction={NOOP} /></div>
            </StateFrame>
            <StateFrame label="Code panel — signed in" note="Names the account; Not you? Sign out.">
                <div className="w-full max-w-sm"><SigninCodeSignedIn name="Thornwick" onSignOut={NOOP} /></div>
            </StateFrame>
        </>
    );
}

/** Sign-in section: last-used card + Discord-app code panel samples. */
export function SigninSection(): JSX.Element {
    return (
        <Section id="signin" title="Sign-in"
            blurb="ROK-2370: the login page's Last used card (one per method) and the Discord-app code panel states. The real components with fake data.">
            <div data-testid="ds-signin">
                <StateGrid>
                    <LastUsedFrames />
                    <CodePanelFrames />
                </StateGrid>
            </div>
        </Section>
    );
}
