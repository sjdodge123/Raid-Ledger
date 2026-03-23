/**
 * Community Lineup banner for the Games page (ROK-935).
 * Shows a compact hero with nomination thumbnails and CTA links.
 */
import { type JSX, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LineupBannerResponseDto } from '@raid-ledger/contract';
import { useLineupBanner } from '../../hooks/use-lineups';
import { LineupStatusBadge } from './LineupStatusBadge';
import { LineupBannerSkeleton } from './LineupBannerSkeleton';
import { NominateModal } from './NominateModal';
import { formatTargetDate } from './lineup-banner-helpers';

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
function StatusBar({ targetDate }: { targetDate: string | null }): JSX.Element {
    const formatted = formatTargetDate(targetDate);
    return (
        <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
                <PulsingDot />
                <span className="text-xs font-semibold text-emerald-400 tracking-wider uppercase">
                    COMMUNITY LINEUP
                </span>
            </div>
            {formatted && (
                <span className="text-xs text-muted">Target: {formatted}</span>
            )}
        </div>
    );
}

/** Heading row with question and status badge. */
function BannerHeading({ banner }: { banner: LineupBannerResponseDto }): JSX.Element {
    return (
        <div className="flex items-center gap-3 mb-1">
            <h2 className="text-lg font-bold text-foreground">
                What are we playing this week?
            </h2>
            <LineupStatusBadge status={banner.status} />
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

/** CTA buttons: view lineup link and nominate button. */
function BannerActions({ id, onNominate }: { id: number; onNominate: () => void }): JSX.Element {
    return (
        <div className="flex items-center gap-3">
            <Link
                to={`/community-lineup/${id}`}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors"
            >
                View Lineup &amp; Vote
            </Link>
            <button
                type="button"
                onClick={onNominate}
                className="px-4 py-2 text-sm font-medium bg-panel text-secondary border border-edge rounded-lg hover:bg-overlay transition-colors"
            >
                Nominate
            </button>
        </div>
    );
}

/** Populated banner content. */
function BannerContent({
    banner,
    onNominate,
}: {
    banner: LineupBannerResponseDto;
    onNominate: () => void;
}): JSX.Element {
    return (
        <div className="rounded-xl bg-panel/50 border border-edge/50 p-6 mb-8">
            <StatusBar targetDate={banner.targetDate} />
            <BannerHeading banner={banner} />
            <BannerSubtitle banner={banner} />
            {banner.entries.length > 0 && <ThumbnailRow entries={banner.entries} />}
            <BannerActions id={banner.id} onNominate={onNominate} />
        </div>
    );
}

/** Community Lineup banner for the Games page. */
export function LineupBanner(): JSX.Element | null {
    const { data: banner, isLoading } = useLineupBanner();
    const [nominateOpen, setNominateOpen] = useState(false);

    if (isLoading) return <LineupBannerSkeleton />;
    if (!banner) return null;

    return (
        <>
            <BannerContent banner={banner} onNominate={() => setNominateOpen(true)} />
            <NominateModal
                isOpen={nominateOpen}
                onClose={() => setNominateOpen(false)}
                lineupId={banner.id}
            />
        </>
    );
}
