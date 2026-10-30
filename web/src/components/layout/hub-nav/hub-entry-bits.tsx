/**
 * ROK-1785/ROK-1870: shared pieces of the hub entry points — the crest
 * (ROK-1814; the shield placeholder when none) and the hub link row (prototype `guild-nav-wireframes/guild-entries.tsx`).
 * Core since D9; the WoW plugin re-exports them for its own cards.
 */
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import type { MyGuild } from '@raid-ledger/contract';
import { guildHref } from './my-hubs-queries';
import { HubKindChip } from './hub-kind-chip';
import { HubCrest } from '../../hub/crest/hub-crest';
import type { HubCrestInput } from '../../hub/crest/hub-crest.helpers';

/** Box sizes: `sm` 24px (nav rows), `md` 40px (the phone hubs sheet), `lg` 48px (cards). */
const CREST_BOX = { sm: 'h-6 w-6', md: 'h-10 w-10', lg: 'h-12 w-12' } as const;
type CrestSize = keyof typeof CREST_BOX;

interface GuildCrestProps {
    small?: boolean;
    size?: CrestSize;
    /** ROK-1814: the hub's crest; none (or one that fails to load) shows `fallback`, else the shield. */
    crest?: HubCrestInput;
    name?: string;
    fallback?: ReactNode;
}

/** The hub crest at a list size; today's shield when the hub has none (ROK-1814 Q8). */
export function GuildCrest({ small = false, size, crest = null, name = '', fallback }: GuildCrestProps): JSX.Element {
    return <HubCrest crest={crest} name={name} size={size ?? (small ? 'sm' : 'lg')} fallback={fallback} />;
}

/** `md` = the dense header-menu row (default); `lg` = the phone bottom "Your hubs" sheet. */
export type GuildRowSize = 'md' | 'lg';

const ROW_CLS: Record<GuildRowSize, { row: string; meta: string; crest: CrestSize; chevron: string }> = {
    md: { row: 'min-h-[44px] gap-3 px-4 py-2 text-sm', meta: 'text-xs', crest: 'sm', chevron: 'h-4 w-4' },
    lg: { row: 'min-h-[64px] gap-4 px-5 py-3 text-base', meta: 'text-sm', crest: 'md', chevron: 'h-5 w-5' },
};

/** ROK-1814 Q8 / ROK-1831 D6: the hub's crest, else the hub game's icon when the API sends one, else the shield. */
export function GuildRowIcon({ guild, size = 'md' }: { guild: MyGuild; size?: GuildRowSize }): JSX.Element {
    const crest = ROW_CLS[size].crest;
    const gameIcon = guild.gameIconUrl
        ? <img src={guild.gameIconUrl} alt="" aria-hidden="true" data-testid="guild-entry-game-icon"
            className={`${CREST_BOX[crest]} shrink-0 rounded-lg border border-edge-strong object-cover`} />
        : undefined;
    return <GuildCrest size={crest} crest={guild.crest} name={guild.name} fallback={gameIcon} />;
}

/** "whitemane" → "Whitemane"; the API's display name wins when sent. */
function realmOf(guild: MyGuild): string | null {
    if (guild.realmName) return guild.realmName;
    if (!guild.realmSlug) return null;
    return guild.realmSlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Rank · realm · region for a WoW guild. Server and community hubs carry no
 * real realm/region (their `region` is the kind word), and the kind chip
 * already says it, so only the rank (ROK-1875 D6; operator 2026-10-21: the kind
 * showed twice on server rows).
 */
function hubRowMeta(guild: MyGuild): string {
    if (guild.kind !== 'wow_guild') return guild.rankName ?? '';
    return [guild.rankName, realmOf(guild), guild.region.toUpperCase()].filter(Boolean).join(' · ');
}

/** `menuitem` when the rows sit in a `role="menu"` (the header Hubs menu, ROK-1875 D7). */
type RowRole = 'menuitem' | undefined;

interface RowProps { guild: MyGuild; onNavigate?: (() => void) | undefined; role?: RowRole; size: GuildRowSize }

function GuildLinkRow({ guild, onNavigate, role, size }: RowProps): JSX.Element {
    const meta = hubRowMeta(guild);
    const cls = ROW_CLS[size];
    return (
        <Link to={guildHref(guild.id)} onClick={onNavigate} data-testid="guild-entry-row" data-size={size} role={role}
            className={`flex items-center ${cls.row} transition-colors hover:bg-overlay focus-visible:bg-overlay focus-visible:outline-none`}>
            <GuildRowIcon guild={guild} size={size} />
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{guild.name}</span>
                {meta && <span className={`block truncate ${cls.meta} text-muted`}>{meta}</span>}
            </span>
            <HubKindChip kind={guild.kind} size={size === 'lg' ? 'md' : 'sm'} />
            <ChevronRightIcon className={`${cls.chevron} shrink-0 text-muted`} aria-hidden="true" />
        </Link>
    );
}

interface GuildRowsProps { guilds: MyGuild[]; onNavigate?: (() => void) | undefined; role?: RowRole; size?: GuildRowSize }

/** One row per hub: icon · name over meta · kind chip · chevron. Pass `role="menuitem"` inside a menu. */
export function GuildRows({ guilds, onNavigate, role, size = 'md' }: GuildRowsProps): JSX.Element {
    return (
        <ul className="divide-y divide-edge-subtle" role={role ? 'none' : undefined}>
            {guilds.map((g) => <li key={g.id} role={role ? 'none' : undefined}><GuildLinkRow guild={g} onNavigate={onNavigate} role={role} size={size} /></li>)}
        </ul>
    );
}
