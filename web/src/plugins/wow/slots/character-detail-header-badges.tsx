import { Fragment, type JSX, type ReactNode } from 'react';
import { StatTile, type CharacterHeaderLayout } from '../../../components/shared/character-header-layout';
import { CharacterGuildBadge } from './character-guild-badge';

/** ROK-1815 faction tokens: they remap per scheme, so the pill reads in both colour families (ROK-2140). */
const FACTION_STYLES: Record<string, string> = {
    alliance: 'bg-faction-alliance/10 text-faction-alliance border-faction-alliance/30',
    horde: 'bg-faction-horde/10 text-faction-horde border-faction-horde/30',
};

interface CharacterDetailHeaderBadgesProps {
    /** ROK-1785: drives the guild badge; absent in older callers. */
    characterId?: string;
    faction: string | null;
    itemLevel: number | null;
    equippedItemLevel: number | null;
    lastSyncedAt: string | null;
    profileUrl: string | null;
    /** ROK-2140: core's level, shown as a stat tile on phones. */
    level?: number | null | undefined;
    /** ROK-2140: which half core is asking for; absent = both. */
    part?: 'chips' | 'stats' | undefined;
    layout?: CharacterHeaderLayout | undefined;
}

type StatProps = Pick<CharacterDetailHeaderBadgesProps, 'itemLevel' | 'equippedItemLevel' | 'lastSyncedAt' | 'level'>;

function FactionBadge({ faction }: { faction: string }) {
    return (
        <span className={`px-2 py-0.5 rounded text-sm font-medium border ${FACTION_STYLES[faction] ?? 'bg-faint text-muted'}`}>
            {faction.charAt(0).toUpperCase() + faction.slice(1)}
        </span>
    );
}

function ArmoryLinkBadge({ profileUrl }: { profileUrl: string }) {
    return (
        <a href={profileUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
            View on Armory
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
        </a>
    );
}

/** Faction + guild chips (+ the Armory link-out). */
function BadgeChips({ characterId, faction, profileUrl }: Pick<CharacterDetailHeaderBadgesProps, 'characterId' | 'faction' | 'profileUrl'>): JSX.Element {
    return (
        <>
            {faction && <FactionBadge faction={faction} />}
            {characterId && <CharacterGuildBadge characterId={characterId} />}
            {profileUrl && <ArmoryLinkBadge profileUrl={profileUrl} />}
        </>
    );
}

/** ≥ sm: ONE text size for item level, equipped and updated, separated only between present parts (ROK-2140). */
function StatLine({ itemLevel, equippedItemLevel, lastSyncedAt }: StatProps): JSX.Element | null {
    const parts: Array<[string, ReactNode]> = [];
    if (itemLevel) parts.push(['ilvl', <>Item Level <span className="text-purple-400 font-semibold">{itemLevel}</span></>]);
    if (equippedItemLevel && equippedItemLevel !== itemLevel) parts.push(['eq', <>Equipped <span className="text-purple-300 font-semibold">{equippedItemLevel}</span></>]);
    if (lastSyncedAt) parts.push(['upd', <>Updated {timeAgo(lastSyncedAt)}</>]);
    if (parts.length === 0) return null;
    return (
        <div data-testid="character-stat-line" className="mt-1.5 text-sm text-muted">
            {parts.map(([key, node], i) => <Fragment key={key}>{i > 0 && ' · '}{node}</Fragment>)}
        </div>
    );
}

/** Below sm: the Option B stat strip — Item Level, Level, Updated tiles. */
function StatTiles({ itemLevel, level, lastSyncedAt }: StatProps): JSX.Element {
    return (
        <>
            {itemLevel ? <StatTile value={itemLevel} label="Item Level" valueClassName="text-purple-400" /> : null}
            {level ? <StatTile value={level} label="Level" valueClassName="text-amber-400" /> : null}
            {lastSyncedAt ? <StatTile value={timeAgo(lastSyncedAt).replace(/ ago$/, '')} label="Updated" /> : null}
        </>
    );
}

/**
 * WoW filler for `character-detail:header-badges`. Core renders it twice —
 * `part="chips"` beside the name and `part="stats"` as the stat line (≥ sm) or
 * stat tiles (phone); with no `part` it renders both (legacy callers).
 */
export function CharacterDetailHeaderBadges(props: CharacterDetailHeaderBadgesProps): JSX.Element | null {
    if (props.part === 'chips') return <BadgeChips {...props} />;
    if (props.part === 'stats') return props.layout === 'phone' ? <StatTiles {...props} /> : <StatLine {...props} />;
    return <><BadgeChips {...props} /><StatLine {...props} /></>;
}

function timeAgo(dateString: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
