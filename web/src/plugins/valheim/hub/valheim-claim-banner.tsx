/**
 * ROK-1933 Part 1 — the hub claim banner: a §4.7 neutral instruction callout
 * (D2) asking a viewer with no claim on this server to link Steam or pick
 * their character. Always shown on the Characters tab; dismissible on the
 * Overview (ITEM.md Q3 recommendation, remembered per browser).
 */
import type { JSX } from 'react';
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { useSteamLink } from '../../../hooks/use-steam-link';
import { useValheimCharacters } from '../hooks/use-valheim-characters';
import {
    useClaimBannerDismissed,
    useClaimBannerVariant,
} from '../hooks/use-valheim-claim-banner';
import {
    CLAIM_BANNER_COPY as COPY,
    withUnclaimedParam,
    type ClaimBannerVariant,
} from './valheim-claim-banner.helpers';

export interface ValheimClaimBannerViewProps {
    variant: ClaimBannerVariant;
    serverName: string;
    onPick: () => void;
    onLinkSteam?: (() => void) | undefined;
    linkPending?: boolean | undefined;
    /** Present = the × is drawn (Overview only). */
    onDismiss?: (() => void) | undefined;
}

function BannerActions(props: ValheimClaimBannerViewProps): JSX.Element {
    const { variant, onLinkSteam, onPick } = props;
    return (
        <div className="flex flex-col gap-2 lg:flex-row">
            {variant === 'link-steam' && onLinkSteam && (
                <Button variant="primary" loading={props.linkPending ?? false} onClick={onLinkSteam}>
                    {COPY.linkSteam}
                </Button>
            )}
            <Button variant="secondary" onClick={onPick}>{COPY.pick}</Button>
        </div>
    );
}

/** The callout itself — copy and buttons only, no data. */
export function ValheimClaimBannerView(
    props: ValheimClaimBannerViewProps,
): JSX.Element {
    const { variant, serverName, onDismiss } = props;
    const link = variant === 'link-steam';
    // The Overview's WidgetCard is already the "Claim your character" region and
    // card, so the dismissible variant draws neither (one landmark, no box in a box).
    const Root = onDismiss ? 'div' : 'section';
    const frame = onDismiss ? 'pr-10' : 'mb-4 rounded-lg border border-edge bg-overlay/30 p-4';
    return (
        <Root
            aria-label={onDismiss ? undefined : 'Claim your character'}
            className={`relative flex flex-col gap-3 lg:flex-row lg:items-center ${frame}`}
        >
            <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">
                    {link ? COPY.linkHeading(serverName) : COPY.pickHeading(serverName)}
                </h3>
                <p className="mt-1 text-sm text-secondary">{link ? COPY.linkBody : COPY.pickBody}</p>
            </div>
            <BannerActions {...props} />
            {onDismiss && (
                <Button iconOnly aria-label={COPY.dismiss} variant="ghost" size="sm" onClick={onDismiss} className="absolute right-0 top-0">
                    <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                </Button>
            )}
        </Root>
    );
}

/**
 * Jump to the Characters tab, filtered. The router carries the search and the
 * CURRENT hash (so the tab doesn't flash to Overview); the hash write then fires
 * `hashchange` for `useHashTab` — a pushState of `#characters` would not
 * (TabRow rule, `tab-row.helpers.ts`; `latest-post-card.tsx` pattern).
 */
function pickUnclaimed(navigate: NavigateFunction, search: string, hash: string): void {
    navigate({ search, hash });
    window.location.hash = 'characters';
}

export interface ValheimClaimBannerProps {
    serverId: number;
    /** Overview: draw the × and honour a remembered dismiss. */
    dismissible?: boolean | undefined;
}

/** The wired banner: derives its variant, links Steam, jumps to the unclaimed list. */
export function ValheimClaimBanner({ serverId, dismissible = false }: ValheimClaimBannerProps): JSX.Element | null {
    const variant = useClaimBannerVariant(serverId);
    // Page 1 is cached with the Characters tab's own first page; only its server name is read.
    const serverName = useValheimCharacters(serverId).data?.[0]?.serverName;
    const [dismissed, dismiss] = useClaimBannerDismissed(serverId);
    const { linkSteam, isLinkPending } = useSteamLink();
    const navigate = useNavigate();
    const { pathname, search, hash } = useLocation();
    if (variant === null || (dismissible && dismissed)) return null;
    return (
        <ValheimClaimBannerView
            variant={variant}
            serverName={serverName ?? COPY.fallbackServer}
            onLinkSteam={() => linkSteam(`${pathname}#characters`)}
            linkPending={isLinkPending}
            onPick={() => pickUnclaimed(navigate, withUnclaimedParam(search, true), hash)}
            onDismiss={dismissible ? dismiss : undefined}
        />
    );
}
