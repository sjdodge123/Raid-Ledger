/**
 * ROK-2370: the "Last used" sign-in card (operator ruling 2026-11-25
 * ~17:55Z, Cloudflare-style). New pattern: last-used sign-in card — a
 * full-width `bg-panel border-edge rounded-xl` button with the member's
 * avatar, name, the method that worked last time, the neutral "Last used"
 * `Pill` and an arrow; one tap continues with that method. "Not you?" sits
 * outside the button (no nested controls) and forgets the marker.
 */
import type { JSX } from 'react';
import { ArrowRightIcon, KeyIcon } from '@heroicons/react/24/outline';
import { DiscordIcon } from '../../components/icons/DiscordIcon';
import { Pill } from '../../components/hub/hub-bits';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import { Button } from '../../components/ui/button';
import { FOCUS_RING } from '../../components/ui/form-classes';
import type { LastSignin, LastSigninMethod } from '../../lib/last-signin';

export const LAST_USED_LABEL = 'Last used';
export const NOT_YOU_LABEL = 'Not you?';

/** The method's name as the card shows it. */
const METHOD_LABEL: Record<LastSigninMethod, string> = {
    discord: 'Discord',
    'discord-app-code': 'Discord app code',
    password: 'Username and password',
};

function MethodIcon({ method }: { method: LastSigninMethod }): JSX.Element {
    if (method === 'password') return <KeyIcon className="h-4 w-4 shrink-0" aria-hidden="true" />;
    return <DiscordIcon className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

export interface LastUsedSigninCardProps {
    marker: LastSignin;
    /** Continue with the remembered method. */
    onContinue: (method: LastSigninMethod) => void;
    /** Forget the marker and show the default sign-in layout. */
    onNotYou: () => void;
}

/** The remembered sign-in, first on the login page, plus its "Not you?" link. */
export function LastUsedSigninCard({ marker, onContinue, onNotYou }: LastUsedSigninCardProps): JSX.Element {
    const label = METHOD_LABEL[marker.method];
    return (
        <div className="space-y-2" data-testid="last-used-signin">
            <button type="button" onClick={() => onContinue(marker.method)}
                aria-label={`Continue as ${marker.name} with ${label}`}
                className={`w-full flex items-center gap-3 bg-panel border border-edge rounded-xl p-3 min-h-[44px] text-left transition-colors hover:bg-overlay ${FOCUS_RING}`}>
                <AvatarWithFallback avatarUrl={marker.avatarUrl} username={marker.name} sizeClassName="h-10 w-10" alt="" />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{marker.name}</span>
                    <span className="flex items-center gap-1.5 text-xs text-secondary">
                        <MethodIcon method={marker.method} />{label}
                    </span>
                </span>
                <Pill tone="neutral">{LAST_USED_LABEL}</Pill>
                <ArrowRightIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            </button>
            <div className="text-right">
                <Button variant="ghost" size="sm" onClick={onNotYou}>{NOT_YOU_LABEL}</Button>
            </div>
        </div>
    );
}
