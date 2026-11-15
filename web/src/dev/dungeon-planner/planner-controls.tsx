/**
 * ROK-2207 prototype — the planner header controls: dungeon picker, group chips,
 * Wowhead link + start-location map slot, Copy link and the Create-event buttons.
 * Mocked — the dungeon list is the event picker's list (fixtures), no API.
 */
import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { WowInstanceDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { buttonClass } from '../../components/ui/button-classes';
import { RemovableChip } from '../../components/ui/removable-chip';
import { instanceRange, levelFit, type PlannerCharacter } from './planner-helpers';
import { WOWHEAD_ZONE_IDS } from './dungeon-planner.fixtures';

const MAX_CHARS = 5;

/** The dungeon list (same rows as the event picker): name · expansion · level range. */
export function DungeonPicker({ instances, selectedId, onSelect }: {
    instances: WowInstanceDto[]; selectedId: number; onSelect: (id: number) => void;
}): JSX.Element {
    return (
        <ul aria-label="Dungeons" className="max-h-56 overflow-y-auto rounded-md border border-edge bg-panel">
            {instances.map((inst) => (
                <li key={inst.id} className="border-b border-edge-subtle last:border-b-0">
                    <Button variant="bare" onClick={() => onSelect(inst.id)} aria-pressed={inst.id === selectedId}
                        className={`flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-sm ${inst.id === selectedId ? 'bg-success/10 text-success' : 'text-foreground hover:bg-overlay'}`}>
                        <span>{inst.name} <span className="text-xs text-muted">· {inst.expansion}</span></span>
                        <span className="text-xs text-secondary">{instanceRange(inst)}</span>
                    </Button>
                </li>
            ))}
        </ul>
    );
}

/** Picked characters as removable chips, ⚠ when below range, plus "+ Add character (n left)". */
export function GroupChips({ chars, instance, onRemove, onAdd, canAdd }: {
    chars: PlannerCharacter[]; instance: WowInstanceDto; onRemove: (name: string) => void; onAdd: () => void; canAdd: boolean;
}): JSX.Element {
    const left = MAX_CHARS - chars.length;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Group ({chars.length}/{MAX_CHARS})</span>
            {chars.map((c) => (
                <RemovableChip key={c.name} label={c.name} removeLabel={`Remove ${c.name}`} onRemove={() => onRemove(c.name)}
                    detail={`${c.level}${levelFit(c.level, instance) === 'below' ? ' ⚠' : ''}${c.characterId ? '' : ' · no quest data'}`} />
            ))}
            {left > 0 && (
                <Button variant="secondary" size="sm" onClick={onAdd} disabled={!canAdd}>
                    + Add character ({left} left)
                </Button>
            )}
        </div>
    );
}

/** "Wowhead ↗" (links only, spec D7) and the start-location map slot (OQ7). */
export function DungeonLinks({ instance }: { instance: WowInstanceDto }): JSX.Element {
    const zone = WOWHEAD_ZONE_IDS[instance.id];
    return (
        <div className="flex flex-col gap-2">
            {zone != null
                ? <a href={`https://www.wowhead.com/classic/zone=${zone}`} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-secondary hover:text-foreground hover:underline">Wowhead ↗</a>
                : <span className="text-xs text-dim">No Wowhead id for this dungeon yet (Forever seed)</span>}
            <div className="flex min-h-[72px] items-center justify-center rounded-md border border-dashed border-edge-strong bg-backdrop px-3 text-center text-xs text-muted">
                Start-location map goes here — v1 recommendation is the Wowhead link only (OQ7)
            </div>
        </div>
    );
}

/** Copy the stateless share link (spec D5) for a forum post or Discord. */
export function CopyLinkButton({ url }: { url: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    const copy = (): void => {
        void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
    };
    return <Button variant="secondary" size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>;
}

/** The Create-event button set. `invite` = OQ3 Option B's extra "& invite" button. */
export function CreateEventButtons({ plainUrl, inviteUrl, invite, count }: {
    plainUrl: string; inviteUrl: string; invite: boolean; count: number;
}): JSX.Element {
    return (
        <div className="flex flex-wrap gap-2">
            <Link to={plainUrl} className={buttonClass({ variant: 'primary', size: 'sm' })}>Create event ▸</Link>
            {invite && (
                <Link to={inviteUrl} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                    Create event &amp; invite these {count}
                </Link>
            )}
        </div>
    );
}
