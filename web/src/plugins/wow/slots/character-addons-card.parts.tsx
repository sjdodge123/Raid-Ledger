/**
 * ROK-1786 / ROK-2147 — rows for the character page's "Your guild recommends"
 * card. `CompactRow` without a `state` is today's row, unchanged. With the
 * character's installed list (owner or guild officer only) each row gains
 * Installed / Missing, a missing Required row is tinted, and the folders no
 * recommendation claimed are listed under "Also installed", capped at 5.
 */
import { useId, type JSX } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import type { CharacterInstalledAddon } from '@raid-ledger/contract';
import type { AddonView } from '../guild/addon-view';
import { Pill } from '../../../components/hub/hub-bits';
import { ShowAllToggle } from '../components/show-all-toggle';
import { useRowCap } from '../hooks/use-row-cap';
import { formatAddonSourceLine } from '../lib/addon-source-line';
import { matchInstalled, type InstallState } from './installed-addons.helpers';

const ROW = 'flex min-h-[44px] items-center gap-2 border-b border-edge-subtle py-1 last:border-b-0';
const MISSING_REQUIRED = 'border-l-2 border-l-warning bg-warning/10 pl-2';

function StatePill({ state, required }: { state: InstallState; required: boolean }): JSX.Element | null {
    if (state === 'installed') return <Pill tone="success"><span aria-hidden="true">✓</span>Installed</Pill>;
    if (state === 'missing') return <Pill tone={required ? 'warning' : 'neutral'}>Missing</Pill>;
    return null;
}

export function CompactRow({ addon, state }: { addon: AddonView; state?: InstallState }): JSX.Element {
    const highlighted = state === 'missing' && addon.required;
    return (
        <li className={highlighted ? `${ROW} ${MISSING_REQUIRED}` : ROW} data-install-state={state ?? undefined}>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{addon.name}</span>
            {state !== undefined && <StatePill state={state} required={addon.required} />}
            {addon.required && <Pill tone="warning">Required</Pill>}
            <a href={addon.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${addon.name} on ${addon.source}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-overlay hover:text-foreground">
                <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
            </a>
        </li>
    );
}

function InstalledRow({ addon }: { addon: CharacterInstalledAddon }): JSX.Element {
    return (
        <li className={ROW}>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{addon.title?.trim() || addon.name}</span>
            {addon.version && <span className="shrink-0 text-xs text-muted">{addon.version}</span>}
            {!addon.loaded && <span className="shrink-0 text-xs text-dim">not loaded</span>}
        </li>
    );
}

function AlsoInstalled({ addons }: { addons: CharacterInstalledAddon[] }): JSX.Element | null {
    const listId = useId();
    const cap = useRowCap(addons);
    if (addons.length === 0) return null;
    return (
        <div className="mt-3" data-testid="character-also-installed">
            <h4 className="text-sm font-medium text-secondary">Also installed ({addons.length})</h4>
            <ul id={listId} aria-label="Other installed addons">
                {cap.visible.map((a) => <InstalledRow key={a.name} addon={a} />)}
            </ul>
            {cap.capped && <ShowAllToggle total={addons.length} expanded={cap.expanded} onToggle={cap.toggle} controls={listId} />}
        </div>
    );
}

/** The card's list once the viewer may see the character's installed addons. */
export function InstalledAddonsList({ rows, installed }: {
    rows: AddonView[]; installed: { addons: CharacterInstalledAddon[]; capturedAt: string };
}): JSX.Element {
    const match = matchInstalled(rows, installed.addons);
    return (
        <>
            <p className="-mt-1 mb-2 text-xs text-muted" data-testid="character-installed-source">{formatAddonSourceLine(installed.capturedAt)}</p>
            <ul aria-label="Addons your guild recommends">
                {match.rows.map((r) => <CompactRow key={r.addon.key} addon={r.addon} state={r.state} />)}
            </ul>
            <AlsoInstalled addons={match.others} />
        </>
    );
}
