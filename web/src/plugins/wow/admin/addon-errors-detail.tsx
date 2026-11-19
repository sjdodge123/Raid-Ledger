/**
 * ROK-2099 — what an opened Addon errors row reveals: one line per member +
 * character (from `GET …/:signature`) and the group's sample stack.
 *
 * New pattern (flagged in the PR): the monospace stack block with a
 * `CopyButton`. Built here; promote it to `components/ui` only when a second
 * surface needs one (spec §12).
 */
import type { JSX } from 'react';
import type { AddonErrorGroupDto, AddonErrorOccurrenceDto } from '@raid-ledger/contract';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useAddonErrorDetail } from './use-addon-errors';
import { formatSeen } from './addon-errors-filters';

const TH = 'pb-1 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-secondary';
const TD = 'py-1 pr-4 align-top';

/** Monospace, horizontally scrolling stack with a Copy button. */
export function StackBlock({ stack }: { stack: string }): JSX.Element {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-secondary">Stack (sample, scrubbed)</span>
                <CopyButton text={stack} label="Copy" />
            </div>
            <pre className="max-w-full overflow-x-auto whitespace-pre rounded-lg border border-edge bg-panel p-3 font-mono text-xs text-foreground">
                {stack}
            </pre>
        </div>
    );
}

function characterLabel(o: AddonErrorOccurrenceDto): string {
    if (!o.characterName) return '—';
    return o.characterRealm ? `${o.characterName} – ${o.characterRealm}` : o.characterName;
}

function OccurrenceTable({ occurrences }: { occurrences: readonly AddonErrorOccurrenceDto[] }): JSX.Element {
    return (
        <div className="max-w-full overflow-x-auto">
            <table className="text-sm" aria-label="Occurrences">
                <thead>
                    <tr><th scope="col" className={TH}>Member</th><th scope="col" className={TH}>Character</th><th scope="col" className={TH}>Count</th><th scope="col" className={TH}>Last seen</th></tr>
                </thead>
                <tbody>
                    {occurrences.map((o) => (
                        <tr key={o.id}>
                            <td className={`${TD} text-foreground`}>{o.member.username}</td>
                            <td className={`${TD} text-muted`}>{characterLabel(o)}</td>
                            <td className={`${TD} tabular-nums text-foreground`}>{o.count}</td>
                            <td className={`${TD} text-muted`}>{formatSeen(o.lastSeenAt)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Occurrences + sample stack of one group; fetches when mounted (row opened). */
export function AddonErrorDetailPanel({ group }: { group: AddonErrorGroupDto }): JSX.Element {
    const detail = useAddonErrorDetail(group.signature);
    return (
        <div className="flex flex-col gap-4">
            {detail.isPending && <p className="text-sm text-muted">Loading occurrences…</p>}
            {detail.isError && <p className="text-sm text-danger">Could not load the occurrences of this error.</p>}
            {detail.data && <OccurrenceTable occurrences={detail.data.occurrences} />}
            {group.sampleStack
                ? <StackBlock stack={group.sampleStack} />
                : <p className="text-sm text-muted">No stack was recorded for this error.</p>}
        </div>
    );
}
