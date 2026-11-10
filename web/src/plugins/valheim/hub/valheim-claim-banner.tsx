/**
 * ROK-1933 Part 1 — the hub claim banner: a §4.7 neutral instruction callout
 * (D2) asking a viewer with no claim on this server to link Steam or pick
 * their character. Shown on the Characters tab; the Overview uses the core
 * claim prompt instead (ROK-2153 S4).
 */
import type { JSX } from 'react';
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { useSteamLink } from '../../../hooks/use-steam-link';
import { useValheimCharacters } from '../hooks/use-valheim-characters';
import { useClaimBannerVariant } from '../hooks/use-valheim-claim-banner';
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

/** The callout itself — copy and buttons only, no data. */
export function ValheimClaimBannerView(
    props: ValheimClaimBannerViewProps,
): JSX.Element {
    const { variant, serverName } = props;
    const link = variant === 'link-steam';
    return (
        <section
            aria-label="Claim your character"
            className={`${CALLOUT_CLS} mb-4`}
        >
            <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-foreground">
                    {link ? COPY.linkHeading(serverName) : COPY.pickHeading(serverName)}
                </h3>
                <p className="mt-1 text-sm text-secondary">{link ? COPY.linkBody : COPY.pickBody}</p>
            </div>
            <BannerActions {...props} />
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
}

/** The wired banner: derives its variant, links Steam, jumps to the unclaimed list. */
export function ValheimClaimBanner({ serverId }: ValheimClaimBannerProps): JSX.Element | null {
    const variant = useClaimBannerVariant(serverId);
    // Page 1 is cached with the Characters tab's own first page; only its server name is read.
    const serverName = useValheimCharacters(serverId).data?.[0]?.serverName;
    const { linkSteam, isLinkPending } = useSteamLink();
    const navigate = useNavigate();
    const { pathname, search, hash } = useLocation();
    if (variant === null) return null;
    return (
        <ValheimClaimBannerView
            variant={variant}
            serverName={serverName ?? COPY.fallbackServer}
            onLinkSteam={() => linkSteam(`${pathname}#characters`)}
            linkPending={isLinkPending}
            onPick={() => pickUnclaimed(navigate, withUnclaimedParam(search, true), hash)}
        />
    );
}
