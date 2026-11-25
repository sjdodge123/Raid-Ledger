/**
 * ROK-2370: the login card's body. Order (operator ruling 2026-11-25):
 * [L3b: last-used card] → top-level provider buttons → "Try another way"
 * disclosure (Discord-app code, then username/password). With no providers
 * the password form shows on its own, as before.
 */
import type { JSX } from 'react';
import type { LoginMethodDto } from '@raid-ledger/contract';
import type { User } from '../../hooks/use-auth';
import { DiscordIcon } from '../../components/icons/DiscordIcon';
import { Button } from '../../components/ui/button';
import { clearPendingSigninCode, readPendingSigninCode } from '../../lib/signin-code';
import { LocalLoginForm } from './LocalLoginForm';
import { SigninCodePanel } from './SigninCodePanel';
import { SignInAnotherWay, type SignInSection, type SignInSectionId } from './SignInAnotherWay';

export const ANOTHER_WAY_INTRO = 'If the button above doesn’t work in your browser, get a code and confirm it in Discord.';
export const CODE_SECTION_TITLE = 'Get a code to confirm in Discord';
export const PASSWORD_SECTION_TITLE = 'Sign in with username';

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
    /** A code sign-in finished (route from here; L3b records the last-used marker here). */
    onCodeSignedIn: (user: User) => void;
}

/** Top-level provider buttons (Discord today; ROK-2371 adds Google as another entry). */
export function ProviderButtons({ providers, isRedirecting, onLogin }: {
    providers: LoginMethodDto[]; isRedirecting: boolean; onLogin: (provider: LoginMethodDto) => void;
}): JSX.Element {
    return (
        <div className="space-y-3">
            {providers.map((provider) => (
                <Button key={provider.key} onClick={() => onLogin(provider)} size="lg" fullWidth
                    brandColor={provider.color ?? '#5865F2'} loading={isRedirecting} loadingLabel="Redirecting...">
                    {provider.icon === 'discord' && <DiscordIcon className="w-5 h-5" />}{provider.label}
                </Button>
            ))}
        </div>
    );
}

/** The ordered workaround sections; the code panel only when the server offers it. */
function buildSections(props: LoginBodyProps): SignInSection[] {
    const password: SignInSection = {
        id: 'password', title: PASSWORD_SECTION_TITLE, showHeading: true,
        node: <LocalLoginForm onSubmit={props.onLocalLogin} isLoading={props.isLoading} error={props.error} />,
    };
    if (!props.discordSigninCode) return [password];
    const code: SignInSection = {
        id: 'discord-app-code', title: CODE_SECTION_TITLE, showHeading: false,
        node: <SigninCodePanel onSignedIn={props.onCodeSignedIn} />,
    };
    return [code, password];
}

/** Open on a code resumed from this tab (back from Discord), else on first run's password section. */
function initialDisclosure(props: LoginBodyProps): { open: boolean; section: SignInSectionId | undefined } {
    if (props.discordSigninCode && readPendingSigninCode(Date.now())) return { open: true, section: 'discord-app-code' };
    if (props.isFirstRun) return { open: true, section: 'password' };
    return { open: false, section: undefined };
}

/** Main login body — provider buttons + disclosure, or the local form alone. */
export function LoginBody(props: LoginBodyProps): JSX.Element {
    if (props.authProviders.length === 0) {
        return <LocalLoginForm onSubmit={props.onLocalLogin} isLoading={props.isLoading} error={props.error} />;
    }
    const initial = initialDisclosure(props);
    return (
        <>
            {/* L3b (ROK-2370): LastUsedSigninCard renders here; with a marker, the two blocks below sit behind its "Sign in another way". */}
            <ProviderButtons providers={props.authProviders} isRedirecting={props.isRedirecting} onLogin={props.onProviderLogin} />
            <SignInAnotherWay sections={buildSections(props)} intro={props.discordSigninCode ? ANOTHER_WAY_INTRO : null}
                defaultOpen={initial.open} initialSection={initial.section} onClose={clearPendingSigninCode} />
        </>
    );
}
