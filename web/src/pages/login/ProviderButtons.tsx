/**
 * The login page's provider buttons. ROK-2371: a login method's `placement`
 * decides where it renders — absent or `'primary'` is a top-level button
 * (Discord, Google), `'alternate'` sits behind "Try another way".
 *
 * New pattern: Google sign-in button — `Button variant="secondary"` (the
 * neutral surface) with the four-colour `GoogleIcon`; Google's branding rules
 * forbid a coloured fill, so `brandColor` (Discord's `#5865F2`) does not apply.
 */
import type { JSX } from 'react';
import type { LoginMethodDto } from '@raid-ledger/contract';
import { DiscordIcon } from '../../components/icons/DiscordIcon';
import { GoogleIcon } from '../../components/icons/GoogleIcon';
import { Button } from '../../components/ui/button';
import { isGoogleMethod } from './login-providers';

/** Discord's runtime brand fill when the server sends no `color`. */
const DISCORD_BRAND = '#5865F2';

function ProviderIcon({ icon }: { icon: string | undefined }): JSX.Element | null {
    if (icon === 'discord') return <DiscordIcon className="w-5 h-5" />;
    if (icon === 'google') return <GoogleIcon className="w-5 h-5" />;
    return null;
}

/** One provider button: Google neutral + mark, everyone else their brand fill. */
function ProviderButton({ provider, isRedirecting, onLogin }: {
    provider: LoginMethodDto; isRedirecting: boolean; onLogin: (provider: LoginMethodDto) => void;
}): JSX.Element {
    const brand = isGoogleMethod(provider) ? {} : { brandColor: provider.color ?? DISCORD_BRAND };
    return (
        <Button onClick={() => onLogin(provider)} size="lg" fullWidth variant="secondary" {...brand}
            loading={isRedirecting} loadingLabel="Redirecting..." data-provider={provider.key}>
            <ProviderIcon icon={provider.icon} />{provider.label}
        </Button>
    );
}

/** A stack of provider buttons (top-level, or the alternates inside the disclosure). */
export function ProviderButtons({ providers, isRedirecting, onLogin }: {
    providers: LoginMethodDto[]; isRedirecting: boolean; onLogin: (provider: LoginMethodDto) => void;
}): JSX.Element {
    return (
        <div className="space-y-3">
            {providers.map((provider) => (
                <ProviderButton key={provider.key} provider={provider} isRedirecting={isRedirecting} onLogin={onLogin} />
            ))}
        </div>
    );
}
