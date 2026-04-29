/**
 * Community Lineup banner for the Games page (ROK-935, ROK-946).
 * Shows a compact hero with nomination thumbnails and CTA links.
 * When no active lineup, shows "Start Lineup" button for operators.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { LineupBannerResponseDto } from '@raid-ledger/contract';
import { useLineupBanner } from '../../hooks/use-lineups';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';
import { LineupStatusBadge } from './LineupStatusBadge';
import { LineupBannerSkeleton } from './LineupBannerSkeleton';
import { NominateModal } from './NominateModal';
import { StartLineupModal } from './start-lineup-modal';
import { PhaseCountdown } from './phase-countdown';
import { formatTargetDate } from './lineup-banner-helpers';
import { TiebreakerBadge } from './tiebreaker/TiebreakerBadge';
import { OtherActiveLineups } from './OtherActiveLineups';

/** Pulsing green dot indicator for active lineup. */
function PulsingDot(): JSX.Element {
    return (
        <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
    );
}

/** Status bar row with pulsing dot, label, and target date. */
function StatusBar({ targetDate, phaseDeadline, status }: {
    targetDate: string | null;
    phaseDeadline: string | null;
    status: string;
}): JSX.Element {
    const formatted = formatTargetDate(targetDate);
    return (
        <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
                <PulsingDot />
                <span className="text-xs font-semibold text-emerald-400 tracking-wider uppercase">
                    COMMUNITY LINEUP
                </span>
            </div>
            <div className="flex items-center gap-3">
                <PhaseCountdown phaseDeadline={phaseDeadline} status={status} compact />
                {formatted && (
                    <span className="text-xs text-muted">Target: {formatted}</span>
                )}
            </div>
        </div>
    );
}

/** Heading row with per-lineup title and status badge (ROK-1063). */
function BannerHeading({ banner }: { banner: LineupBannerResponseDto }): JSX.Element {
    return (
        <div className="flex items-center gap-3 mb-1">
            <h2 className="text-lg font-bold text-foreground truncate" title={banner.title}>
                {banner.title}
            </h2>
            <LineupStatusBadge status={banner.status} />
            {banner.visibility === 'private' && (
                <span
                    data-testid="lineup-private-badge"
                    className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border border-amber-500/40 bg-amber-500/10 text-amber-300"
                >
                    Private
                </span>
            )}
            {banner.tiebreakerActive && <TiebreakerBadge />}
        </div>
    );
}

/** Subtitle with entry count and voter stats. */
function BannerSubtitle({ banner }: { banner: LineupBannerResponseDto }): JSX.Element {
    return (
        <p className="text-sm text-muted mb-4">
            {banner.entryCount} games nominated{' '}
            <span className="text-dim">
                &middot; {banner.totalVoters} of {banner.totalMembers} members voted
            </span>
        </p>
    );
}

/** Single game thumbnail in the scrollable row. */
function GameThumbnail({ entry }: {
    entry: LineupBannerResponseDto['entries'][number];
}): JSX.Element {
    return (
        <div className="flex-shrink-0 w-16 text-center">
            {entry.gameCoverUrl ? (
                <img
                    src={entry.gameCoverUrl}
                    alt={entry.gameName}
                    className="w-16 h-20 object-cover rounded-lg"
                />
            ) : (
                <div className="w-16 h-20 bg-panel rounded-lg flex items-center justify-center">
                    <span className="text-dim text-xs">{entry.gameName.charAt(0)}</span>
                </div>
            )}
            <span className="text-[10px] text-muted mt-1 block truncate">
                {entry.ownerCount} own
            </span>
        </div>
    );
}

/** Scrollable horizontal thumbnail row. */
function ThumbnailRow({ entries }: { entries: LineupBannerResponseDto['entries'] }): JSX.Element {
    return (
        <div
            className="flex gap-3 overflow-x-auto pb-2 mb-4"
            style={{ scrollbarWidth: 'none' }}
        >
            {entries.map((entry) => (
                <GameThumbnail key={entry.gameId} entry={entry} />
            ))}
        </div>
    );
}

/** CTA buttons: view lineup link, nominate button, and (ROK-1065) start another for ops. */
function BannerActions({ id, status, onNominate, canStartAnother, onStartAnother }: {
    id: number;
    status: string;
    onNominate: () => void;
    canStartAnother: boolean;
    onStartAnother: () => void;
}): JSX.Element {
    const ctaLabel = status === 'voting' ? 'View Lineup & Vote' : 'View Lineup';
    return (
        <div className="flex items-center gap-3 flex-wrap">
            <Link
                to={`/community-lineup/${id}`}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors"
            >
                {ctaLabel}
            </Link>
            {status === 'building' && (
                <button type="button" onClick={onNominate}
                    className="px-4 py-2 text-sm font-medium bg-panel text-secondary border border-edge rounded-lg hover:bg-overlay transition-colors">
                    Nominate
                </button>
            )}
            {canStartAnother && (
                <button
                    type="button"
                    onClick={onStartAnother}
                    data-testid="start-another-lineup"
                    className="px-4 py-2 text-sm font-medium bg-panel text-amber-300 border border-amber-500/40 rounded-lg hover:bg-amber-500/10 transition-colors"
                >
                    Start another lineup
                </button>
            )}
        </div>
    );
}

/** Populated banner content. */
function BannerContent({ banner, onNominate, canStartAnother, onStartAnother }: {
    banner: LineupBannerResponseDto;
    onNominate: () => void;
    canStartAnother: boolean;
    onStartAnother: () => void;
}): JSX.Element {
    return (
        <div className="rounded-xl bg-panel/50 border border-edge/50 p-6 mb-8">
            <StatusBar targetDate={banner.targetDate} phaseDeadline={banner.phaseDeadline} status={banner.status} />
            <BannerHeading banner={banner} />
            <BannerSubtitle banner={banner} />
            {banner.entries.length > 0 && <ThumbnailRow entries={banner.entries} />}
            <BannerActions
                id={banner.id}
                status={banner.status}
                onNominate={onNominate}
                canStartAnother={canStartAnother}
                onStartAnother={onStartAnother}
            />
        </div>
    );
}

/** Start Lineup CTA when no active lineup exists. */
function StartLineupCTA({ onStart }: { onStart: () => void }): JSX.Element {
    return (
        <div className="rounded-xl bg-panel/50 border border-edge/50 border-dashed p-6 mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-2">Community Lineup</h3>
            <p className="text-muted text-sm mb-4 max-w-lg">
                Start a lineup to let your community nominate and vote on the next game
                to play together. Members suggest games during the building phase, then
                vote to pick a winner.
            </p>
            <button type="button" onClick={onStart}
                className="px-5 py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors">
                Start Lineup
            </button>
        </div>
    );
}

/** Community Lineup banner for the Games page. */
export function LineupBanner(): JSX.Element | null {
    const { data: banner, isLoading } = useLineupBanner();
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [nominateOpen, setNominateOpen] = useState(false);
    const [startOpen, setStartOpen] = useState(false);
    const processedRef = useRef(false);

    // ROK-1167: smoke-test entry point. `?test=open-lineup-modal` opens the
    // StartLineupModal directly so smoke specs can avoid racing on the global
    // "no active lineup" banner state. Gated by admin role only — the original
    // `systemStatus.demoMode` belt-and-suspenders gate caused a race under
    // parallel smoke load: when /system/status takes >15s on first paint, the
    // effect early-returns and the test times out. Functionally equivalent to
    // an admin clicking the existing Start Lineup button, so production safety
    // is unchanged (modal hits the standard `/lineups` POST, not a test-only
    // endpoint).
    // Synchronizes URL state (external) into local React state on first match;
    // processedRef + setSearchParams consumption guarantee the effect is one-shot.
    useEffect(() => {
        if (processedRef.current) return;
        if (searchParams.get('test') !== 'open-lineup-modal') return;
        if (!isOperatorOrAdmin(user)) return;
        processedRef.current = true;
        // Legitimate URL → local-state sync (one-shot, latched by processedRef).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStartOpen(true);
        const next = new URLSearchParams(searchParams);
        next.delete('test');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams, user]);

    if (isLoading) return <LineupBannerSkeleton />;

    if (!banner) {
        if (!isOperatorOrAdmin(user)) return null;
        return (
            <>
                <StartLineupCTA onStart={() => setStartOpen(true)} />
                <StartLineupModal isOpen={startOpen} onClose={() => setStartOpen(false)} />
            </>
        );
    }

    const canStartAnother = isOperatorOrAdmin(user);

    return (
        <>
            <BannerContent
                banner={banner}
                onNominate={() => setNominateOpen(true)}
                canStartAnother={canStartAnother}
                onStartAnother={() => setStartOpen(true)}
            />
            <OtherActiveLineups primaryLineupId={banner.id} />
            <NominateModal isOpen={nominateOpen} onClose={() => setNominateOpen(false)} lineupId={banner.id} />
            {canStartAnother && (
                <StartLineupModal isOpen={startOpen} onClose={() => setStartOpen(false)} />
            )}
        </>
    );
}
