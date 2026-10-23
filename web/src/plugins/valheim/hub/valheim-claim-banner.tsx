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

/** §4.7 neutral instruction callout (spec Part 1 "Look"); the desktop actions top-align with the copy (approved mockup). */
const CALLOUT_CLS = 'relative flex flex-col gap-3 rounded-lg border border-edge bg-overlay/30 p-4 lg:flex-row lg:items-start';

/**
 * The Overview ×, pinned to the callout's top-right corner. The wrapper is what
 * is positioned: `Button` carries its own `relative`, which would beat an
 * `absolute` passed in `className` and drop the × into the flow.
 */
function DismissCorner({ onDismiss }: { onDismiss: () => void }): JSX.Element {
    return (
        <div className="absolute right-1 top-1" data-testid="claim-banner-dismiss">
            <Button iconOnly aria-label={COPY.dismiss} variant="ghost" size="sm" onClick={onDismiss}>
                <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
        </div>
    );
}

/** The callout itself — copy and buttons only, no data. */
export function ValheimClaimBannerView(
    props: ValheimClaimBannerViewProps,
): JSX.Element {
    const { variant, serverName, onDismiss } = props;
    const link = variant === 'link-steam';
    // The Overview card is chromeless (`chrome: 'none'`), so this callout is the
    // one "Claim your character" landmark on both surfaces. With the × in the
    // corner, phone reserves room beside the copy only (the stacked buttons keep
    // the full width); ≥1024px reserves it beside the button row.
    const reserve = onDismiss ? { root: 'lg:pr-12', copy: 'pr-10 lg:pr-0' } : { root: 'mb-4', copy: '' };
    return (
        <section
            aria-label="Claim your character"
            className={`${CALLOUT_CLS} ${reserve.root}`}
        >
            <div className={`min-w-0 flex-1 ${reserve.copy}`}>
                <h3 className="text-base font-semibold text-foreground">
                    {link ? COPY.linkHeading(serverName) : COPY.pickHeading(serverName)}
                </h3>
                <p className="mt-1 text-sm text-secondary">{link ? COPY.linkBody : COPY.pickBody}</p>
            </div>
            <BannerActions {...props} />
            {onDismiss && <DismissCorner onDismiss={onDismiss} />}
        </section>
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
