/**
 * ROK-2099 — the Addon errors list: one row per `(addon, message)` group.
 * The §4.21 table box at 1024px and up, one card per group below (§4.18).
 * Opening a row (or card) reveals its occurrences and sample stack.
 * Loading keeps the frame (§4.6); no groups → the §4.5 empty sentence.
 */
import type { JSX } from 'react';
import type { AddonErrorGroupDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { StatusChip } from '../../../components/ui/status-chip';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { AddonErrorDetailPanel } from './addon-errors-detail';
import { formatSeen } from './addon-errors-filters';

export interface AddonErrorsTableProps {
    groups: readonly AddonErrorGroupDto[];
    isLoading: boolean;
    /** Any filter or search set — picks the empty-state sentence. */
    filtered: boolean;
    /** Signature of the open row, or null. */
    expanded: string | null;
    onToggle: (signature: string) => void;
}

const BOX = 'max-w-full overflow-x-auto border border-edge rounded-xl';
const TH = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-secondary';
const TD = 'px-4 py-3 align-top';
const TOGGLE = 'w-full rounded text-left [&>[data-button-label]]:w-full [&>[data-button-label]]:text-left';
export const EMPTY_TEXT = 'No addon errors yet. They appear here once a member turns on “Share addon errors” in the Companion.';
export const EMPTY_FILTERED_TEXT = 'No addon errors match these filters. Clear the filters or the search to see every error.';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const detailId = (g: AddonErrorGroupDto): string => `addon-error-${g.signature.slice(0, 12)}`;

function AddonChip({ addon }: { addon: string }): JSX.Element {
    return <StatusChip tone="neutral" title={`Addon: ${addon}`}>{addon}</StatusChip>;
}

function characterLine(g: AddonErrorGroupDto): string {
    return g.characters.map((c) => (c.realm ? `${c.name} – ${c.realm}` : c.name)).join(' · ');
}

function MessageToggle({ group, open, onToggle }: { group: AddonErrorGroupDto; open: boolean; onToggle: () => void }): JSX.Element {
    return (
        <Button variant="bare" className={TOGGLE} aria-expanded={open} aria-controls={detailId(group)} onClick={onToggle}>
            <span className="block break-words font-mono text-sm text-foreground">{group.message}</span>
        </Button>
    );
}

function GroupRow({ group, open, onToggle }: { group: AddonErrorGroupDto; open: boolean; onToggle: () => void }): JSX.Element {
    return (
        <>
            <tr data-testid="addon-error-row">
                <td className={TD}><AddonChip addon={group.addon} /></td>
                <td className={`${TD} min-w-[18rem]`}>
                    <MessageToggle group={group} open={open} onToggle={onToggle} />
                    {group.characters.length > 0 && <p className="mt-1 text-xs text-muted">{characterLine(group)}</p>}
                </td>
                <td className={`${TD} tabular-nums text-foreground`}>{group.members.length}</td>
                <td className={`${TD} tabular-nums text-foreground`}>{group.totalCount}</td>
                <td className={`${TD} whitespace-nowrap text-muted`}>{formatSeen(group.firstSeenAt)}</td>
                <td className={`${TD} whitespace-nowrap text-muted`}>{formatSeen(group.lastSeenAt)}</td>
            </tr>
            {open && (
                <tr id={detailId(group)}><td colSpan={6} className="bg-surface/30 px-4 py-4"><AddonErrorDetailPanel group={group} /></td></tr>
            )}
        </>
    );
}

function GroupTable({ groups, expanded, onToggle }: Omit<AddonErrorsTableProps, 'isLoading' | 'filtered'>): JSX.Element {
    return (
        <div className={BOX}>
            <table className="w-full text-sm">
                <thead className="border-b border-edge bg-surface/50">
                    <tr><th className={TH}>Addon</th><th className={TH}>Error</th><th className={TH}>Members</th><th className={TH}>Count</th><th className={TH}>First seen</th><th className={TH}>Last seen</th></tr>
                </thead>
                <tbody className="divide-y divide-edge">
                    {groups.map((g) => <GroupRow key={g.signature} group={g} open={expanded === g.signature} onToggle={() => onToggle(g.signature)} />)}
                </tbody>
            </table>
        </div>
    );
}

function GroupCard({ group, open, onToggle }: { group: AddonErrorGroupDto; open: boolean; onToggle: () => void }): JSX.Element {
    return (
        <li data-testid="addon-error-card" className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4">
            <AddonChip addon={group.addon} />
            <MessageToggle group={group} open={open} onToggle={onToggle} />
            <p className="text-xs text-muted">
                {plural(group.members.length, 'member')} · {group.totalCount}× · last seen {formatSeen(group.lastSeenAt)}
            </p>
            {open && <div id={detailId(group)} className="border-t border-edge pt-3"><AddonErrorDetailPanel group={group} /></div>}
        </li>
    );
}

/** Groups as a table (≥1024px) or cards, with loading and empty states. */
export function AddonErrorsTable({ groups, isLoading, filtered, expanded, onToggle }: AddonErrorsTableProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (groups.length === 0) {
        const text = isLoading ? 'Loading addon errors…' : filtered ? EMPTY_FILTERED_TEXT : EMPTY_TEXT;
        return <div className={BOX} aria-busy={isLoading}><div className="py-12 text-center"><p className="text-sm text-muted">{text}</p></div></div>;
    }
    if (isDesktop) return <GroupTable groups={groups} expanded={expanded} onToggle={onToggle} />;
    return (
        <ul className="flex flex-col gap-3" aria-label="Addon errors">
            {groups.map((g) => <GroupCard key={g.signature} group={g} open={expanded === g.signature} onToggle={() => onToggle(g.signature)} />)}
        </ul>
    );
}
