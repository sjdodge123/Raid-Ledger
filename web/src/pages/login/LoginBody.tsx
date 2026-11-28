/**
 * ROK-2370: the login card's body. Order (operator ruling 2026-11-25):
 * last-used card (when this browser remembers a sign-in) → top-level
 * provider buttons (`placement` absent/'primary' — Discord, Google; ROK-2371) → "Try another way" disclosure (Discord-app code, then
 * username/password). With a last-used card, the providers + disclosure sit
 * under an "or" divider behind "Sign in another way". With no providers the
 * password form shows on its own, as before — plus the code disclosure when
 * the bot can confirm codes.
 */
import type { JSX } from 'react';
import type { LoginMethodDto } from '@raid-ledger/contract';
import type { User } from '../../hooks/use-auth';
import { Button } from '../../components/ui/button';
import { clearPendingSigninCode, readPendingSigninCode } from '../../lib/signin-code';
import { LocalLoginForm } from './LocalLoginForm';
import { SigninCodePanel } from './SigninCodePanel';
import { SignInAnotherWay, type SignInSection, type SignInSectionId } from './SignInAnotherWay';
import { LastUsedSigninCard } from './LastUsedSigninCard';
import { ProviderButtons } from './ProviderButtons';
import { splitByPlacement } from './login-providers';
import { useLastUsedSignin, type LastUsedSignin } from './use-last-used-signin';

export const ANOTHER_WAY_INTRO = 'If the button above doesn’t work in your browser, get a code and confirm it in Discord.';
export const NO_PROVIDER_INTRO = 'Have Discord? Get a code and confirm it there instead of using a password.';
export const CODE_SECTION_TITLE = 'Get a code to confirm in Discord';
export const PASSWORD_SECTION_TITLE = 'Sign in with username';
export const SIGN_IN_ANOTHER_WAY_TOGGLE = 'Sign in another way';
export const OTHER_PROVIDERS_TITLE = 'Other sign-in options';

export interface LoginBodyProps {
    authProviders: LoginMethodDto[];
    isRedirecting: boolean;
    onProviderLogin: (p: LoginMethodDto) => void;
    isFirstRun: boolean;
    /** `/system/status` `discordSigninCode`: bot online + guild + trusted client URL. */
    discordSigninCode: boolean;
    onLocalLogin: (u: string, p: string) => Promise<void>;
    isLoading: boolean;
    error: string | null;
    /** A code sign-in finished (the page records the last-used marker and routes). */
    onCodeSignedIn: (user: User) => void;
}

/** The Discord-app code section (only offered when the server reports it). */
function codeSection(props: LoginBodyProps): SignInSection {
    return {
        id: 'discord-app-code', title: CODE_SECTION_TITLE, showHeading: false,
        node: <SigninCodePanel onSignedIn={props.onCodeSignedIn} />,
    };
}

/** ROK-2371: the `placement: 'alternate'` login methods, when the server sends any. */
function alternateSection(props: LoginBodyProps, alternate: LoginMethodDto[]): SignInSection[] {
    if (alternate.length === 0) return [];
    return [{
        id: 'other-providers', title: OTHER_PROVIDERS_TITLE, showHeading: true,
        node: <ProviderButtons providers={alternate} isRedirecting={props.isRedirecting} onLogin={props.onProviderLogin} />,
    }];
}

/** The ordered workaround sections; the code panel only when the server offers it. */
function buildSections(props: LoginBodyProps, alternate: LoginMethodDto[]): SignInSection[] {
    const password: SignInSection = {
        id: 'password', title: PASSWORD_SECTION_TITLE, showHeading: true,
        node: <LocalLoginForm onSubmit={props.onLocalLogin} isLoading={props.isLoading} error={props.error} />,
    };
    const code = props.discordSigninCode ? [codeSection(props)] : [];
    return [...code, password, ...alternateSection(props, alternate)];
}

/**
 * No OAuth provider but the bot can confirm codes (Codex P2): the password
 * form stays primary, with the code behind the disclosure — opened at once
 * when this tab is resuming one.
 */
function NoProviderBody({ props }: { props: LoginBodyProps }): JSX.Element {
    return (
        <>
            <LocalLoginForm onSubmit={props.onLocalLogin} isLoading={props.isLoading} error={props.error} />
            <SignInAnotherWay sections={[codeSection(props)]} intro={NO_PROVIDER_INTRO}
                defaultOpen={hasPendingCode()} initialSection="discord-app-code"
                onClose={clearPendingSigninCode} />
        </>
    );
}

/** True when this tab saved a live sign-in code (back from Discord). Kept out of render for react-hooks/purity. */
function hasPendingCode(): boolean {
    return readPendingSigninCode(Date.now()) !== null;
}

/** Open on a code resumed from this tab (back from Discord), else on first run's password section. */
function initialDisclosure(props: LoginBodyProps): { open: boolean; section: SignInSectionId | undefined } {
    if (props.discordSigninCode && readPendingSigninCode(Date.now())) return { open: true, section: 'discord-app-code' };
    if (props.isFirstRun) return { open: true, section: 'password' };
    return { open: false, section: undefined };
}

/** "or" between the last-used card and the other methods (the Add Character divider idiom). */
function OrDivider(): JSX.Element {
    return (
        <div className="my-4 flex items-center gap-3 text-sm text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-edge" />or<span className="h-px flex-1 bg-edge" />
        </div>
    );
}

/** Provider buttons + disclosure; a card tap remounts the disclosure open on its section. */
function OtherMethods({ props, lastUsed }: { props: LoginBodyProps; lastUsed: LastUsedSignin }): JSX.Element {
    const initial = initialDisclosure(props);
    const req = lastUsed.request;
    const { primary, alternate } = splitByPlacement(props.authProviders);
    return (
        <>
            <ProviderButtons providers={primary} isRedirecting={props.isRedirecting} onLogin={props.onProviderLogin} />
            <SignInAnotherWay key={req ? `${req.section}-${req.n}` : 'initial'} sections={buildSections(props, alternate)}
                intro={props.discordSigninCode ? ANOTHER_WAY_INTRO : null} defaultOpen={req ? true : initial.open}
                initialSection={req ? req.section : initial.section} onClose={clearPendingSigninCode} />
        </>
    );
}

/** Main login body — last-used card, provider buttons + disclosure, or the local form alone. */
export function LoginBody(props: LoginBodyProps): JSX.Element {
    const lastUsed = useLastUsedSignin({
        providers: props.authProviders, codeOffered: props.discordSigninCode, onProviderLogin: props.onProviderLogin,
    });
    if (props.authProviders.length === 0) {
        if (props.discordSigninCode) return <NoProviderBody props={props} />;
        return <LocalLoginForm onSubmit={props.onLocalLogin} isLoading={props.isLoading} error={props.error} />;
    }
    if (!lastUsed.marker) return <OtherMethods props={props} lastUsed={lastUsed} />;
    return (
        <>
            <LastUsedSigninCard marker={lastUsed.marker} onContinue={lastUsed.continueWith} onNotYou={lastUsed.notYou} />
            <OrDivider />
            {lastUsed.expanded ? <OtherMethods props={props} lastUsed={lastUsed} /> : (
                <div className="text-center">
                    <Button variant="ghost" size="sm" aria-expanded={false} onClick={lastUsed.expand}>
                        {SIGN_IN_ANOTHER_WAY_TOGGLE}
                    </Button>
                </div>
            )}
        </>
    );
}
