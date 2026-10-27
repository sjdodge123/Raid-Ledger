/**
 * ROK-1953 §5.2 — the rows both Steam cards draw: a ranked member list (avatar
 * h-6 · name · `tabular-nums` value over a §3.2 `GuildMeter`), the §4.6
 * loading rows, and an unlock row. A masked unlock renders the design-system
 * "masked hidden-achievement row": lock icon + italic muted "Hidden
 * achievement" + rarity %, never a name, title or tooltip.
 */
import type { JSX } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import type { SteamHubMemberStats, SteamHubUnlock } from '@raid-ledger/contract';
import { AvatarWithFallback } from '../../shared/AvatarWithFallback';
import { StatusChip } from '../../ui/status-chip';
import { GuildMeter } from '../events/guild-meter';
import { achievementA11y, achievementName, isRare, pctLabel, type SteamStatsRow } from './steam-stats.helpers';

/** The §4.6 loading body: three 44px pulsing rows. */
export function SteamStatsSkeleton(): JSX.Element {
    return (
        <div className="flex flex-col gap-1.5" data-testid="steam-stats-loading" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-md bg-panel" />)}
        </div>
    );
}

function Avatar({ member }: { member: SteamHubMemberStats | undefined }): JSX.Element {
    return <AvatarWithFallback avatarUrl={member?.avatarUrl ?? null} username={member?.displayName ?? '?'} sizeClassName="h-6 w-6" alt="" />;
}

/** A ranked member list; `meterLabel` names each meter ("Karlach: 24 of 54 achievements"). */
export function SteamMemberRows({ rows, label, meterLabel, testId }: {
    rows: readonly SteamStatsRow[];
    label: string;
    meterLabel: (row: SteamStatsRow) => string;
    testId: string;
}): JSX.Element {
    return (
        <ol className="flex flex-col" aria-label={label}>
            {rows.map((row) => (
                <li key={row.member.userId} data-testid={testId}
                    className="flex min-h-11 flex-col justify-center gap-1 border-b border-edge-subtle py-1">
                    <div className="flex items-center gap-2 text-sm">
                        <Avatar member={row.member} />
                        <span className="min-w-0 flex-1 truncate text-secondary">{row.member.displayName}</span>
                        <span className="text-foreground tabular-nums">{row.value}</span>
                    </div>
                    <div className="pl-8"><GuildMeter pct={row.pct} label={meterLabel(row)} /></div>
                </li>
            ))}
        </ol>
    );
}

/** The achievement's name, or the masked row's lock + "Hidden achievement" (visual only; a11y text is the row's). */
function AchievementName({ unlock }: { unlock: SteamHubUnlock }): JSX.Element {
    const view = unlock.achievement;
    if (!view.masked) return <span className="min-w-0 flex-1 truncate text-secondary" aria-hidden="true">{view.name}</span>;
    return (
        <span className="flex min-w-0 flex-1 items-center gap-1 text-sm italic text-muted" aria-hidden="true" data-testid="steam-masked-achievement">
            <LockClosedIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{achievementName(view)}</span>
        </span>
    );
}

/** One recent unlock: who, what (masked or named), rarity %, a neutral "Rare" chip under 10%. */
export function SteamUnlockRow({ unlock, member }: { unlock: SteamHubUnlock; member: SteamHubMemberStats | undefined }): JSX.Element {
    const pct = unlock.achievement.globalPct;
    return (
        <li className="flex min-h-11 items-center gap-2 border-b border-edge-subtle text-sm" data-testid="steam-unlock-row">
            <Avatar member={member} />
            <span className="sr-only">{`${member?.displayName ?? 'A member'}: ${achievementA11y(unlock.achievement)}`}</span>
            <AchievementName unlock={unlock} />
            <span className="text-xs text-muted tabular-nums" aria-hidden="true">{pctLabel(pct)}</span>
            {isRare(pct) && <StatusChip tone="neutral" title="Fewer than 10% of players have this">Rare</StatusChip>}
        </li>
    );
}
