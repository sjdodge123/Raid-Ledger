/**
 * ROK-1933 Part 1 — the hub claim banner: a §4.7 neutral instruction callout
 * (D2) asking a viewer with no claim on this server to link Steam or pick
 * their character. Always shown on the Characters tab; dismissible on the
 * Overview (ITEM.md Q3 recommendation, remembered per browser).
 */
import type { JSX } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { useSteamLink } from '../../../hooks/use-steam-link';
import {
    useClaimBannerDismissed,
    useClaimBannerVariant,
} from '../hooks/use-valheim-claim-banner';
import {
    CLAIM_BANNER_COPY as COPY,
    CLAIM_FILTER_PARAM,
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
    return (
        <section
            aria-label="Claim your character"
            className={`relative mb-4 flex flex-col gap-3 rounded-lg border border-edge bg-overlay/30 p-4 lg:flex-row lg:items-center ${onDismiss ? 'pr-12' : ''}`}
        >
            <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">
                    {link ? COPY.linkHeading(serverName) : COPY.pickHeading(serverName)}
                </h3>
                <p className="mt-1 text-sm text-secondary">{link ? COPY.linkBody : COPY.pickBody}</p>
            </div>
            <BannerActions {...props} />
            {onDismiss && (
                <Button iconOnly aria-label={COPY.dismiss} variant="ghost" size="sm" onClick={onDismiss} className="absolute right-2 top-2">
                    <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                </Button>
            )}
        </section>
    );
}

export interface ValheimClaimBannerProps {
    serverId: number;
    rows: readonly ValheimCharacterSummary[];
    complete: boolean;
    /** Overview: draw the × and honour a remembered dismiss. */
    dismissible?: boolean | undefined;
}

/** The wired banner: derives its variant, links Steam, jumps to the unclaimed list. */
export function ValheimClaimBanner({ serverId, rows, complete, dismissible = false }: ValheimClaimBannerProps): JSX.Element | null {
    const variant = useClaimBannerVariant(rows, complete);
    const [dismissed, dismiss] = useClaimBannerDismissed(serverId);
    const { linkSteam, isLinkPending } = useSteamLink();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    if (variant === null || (dismissible && dismissed)) return null;
    return (
        <ValheimClaimBannerView
            variant={variant}
            serverName={rows[0]?.serverName ?? COPY.fallbackServer}
            onLinkSteam={() => linkSteam(`${pathname}#characters`)}
            linkPending={isLinkPending}
            onPick={() => navigate({ pathname, search: `?${CLAIM_FILTER_PARAM}=1`, hash: '#characters' })}
            onDismiss={dismissible ? dismiss : undefined}
        />
    );
}
