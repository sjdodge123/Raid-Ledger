/**
 * ROK-2370: login-page state for the "last used" card — the marker (only
 * when its method is still offered), whether the other methods are shown,
 * and which disclosure section a card tap asked for.
 */
import { useState } from 'react';
import type { LoginMethodDto } from '@raid-ledger/contract';
import { clearLastSignin, readLastSignin, type LastSignin, type LastSigninMethod } from '../../lib/last-signin';
import { readPendingSigninCode } from '../../lib/signin-code';
import type { SignInSectionId } from './SignInAnotherWay';

/** A disclosure-open request; `n` bumps the `key` so a repeat tap remounts it open. */
export interface DisclosureRequest {
    section: SignInSectionId;
    n: number;
}

export interface LastUsedSignin {
    marker: LastSignin | null;
    /** Show the provider buttons + disclosure (always true without a marker). */
    expanded: boolean;
    expand: () => void;
    request: DisclosureRequest | null;
    continueWith: (method: LastSigninMethod) => void;
    notYou: () => void;
}

/** The provider a `discord` marker continues with, if the server still offers it. */
export function discordProvider(providers: LoginMethodDto[]): LoginMethodDto | undefined {
    return providers.find((p) => p.key === 'discord' || p.icon === 'discord');
}

function isOffered(marker: LastSignin, providers: LoginMethodDto[], codeOffered: boolean): boolean {
    if (marker.method === 'discord') return discordProvider(providers) !== undefined;
    if (marker.method === 'discord-app-code') return codeOffered;
    return true;
}

/**
 * State behind the last-used card on the login page. A code still pending in
 * this tab (e.g. iOS reloaded it on the way back from Discord) shows the other
 * methods at once, so the code panel mounts and its poll resumes.
 */
export function useLastUsedSignin(opts: {
    providers: LoginMethodDto[]; codeOffered: boolean; onProviderLogin: (p: LoginMethodDto) => void;
}): LastUsedSignin {
    const [stored, setStored] = useState<LastSignin | null>(readLastSignin);
    const [expandedByUser, setExpanded] = useState(false);
    const [codePendingAtMount] = useState(() => readPendingSigninCode(Date.now()) !== null);
    const [request, setRequest] = useState<DisclosureRequest | null>(null);
    const marker = stored && isOffered(stored, opts.providers, opts.codeOffered) ? stored : null;
    const continueWith = (method: LastSigninMethod): void => {
        const provider = discordProvider(opts.providers);
        if (method === 'discord' && provider) { opts.onProviderLogin(provider); return; }
        if (method === 'discord') return;
        setExpanded(true);
        setRequest((prev) => ({ section: method, n: (prev?.n ?? 0) + 1 }));
    };
    const notYou = (): void => { clearLastSignin(); setStored(null); };
    const expanded = !marker || expandedByUser || (opts.codeOffered && codePendingAtMount);
    return { marker, expanded, expand: () => setExpanded(true), request, continueWith, notYou };
}
