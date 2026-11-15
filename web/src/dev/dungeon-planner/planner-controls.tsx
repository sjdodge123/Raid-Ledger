/**
 * ROK-2207 prototype — the planner header controls: the Forever dungeon picker
 * (a list on desktop, the native `Select` on phone), the Wowhead link (OQ7),
 * Copy link (OQ5) and the Create-event buttons (OQ3 Option B).
 */
import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { WowInstanceDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { buttonClass } from '../../components/ui/button-classes';
import { Select } from '../../components/ui/select';
import { instanceRange } from './planner-helpers';
import { wowheadZoneUrl } from './forever-dungeons.fixtures';

/** The muted "levels unverified" hint (audit §a: no authoritative Forever source yet). */
export function UnverifiedHint(): JSX.Element {
    return <span className="text-xs text-dim" title="No authoritative source for Forever level ranges yet">levels unverified</span>;
}

function DungeonList({ instances, selectedId, onSelect }: {
    instances: WowInstanceDto[]; selectedId: number; onSelect: (id: number) => void;
}): JSX.Element {
    return (
        <ul aria-label="Dungeons" className="max-h-56 overflow-y-auto rounded-md border border-edge bg-panel">
            {instances.map((inst) => (
                <li key={inst.id} className="border-b border-edge-subtle last:border-b-0">
                    <Button variant="bare" onClick={() => onSelect(inst.id)} aria-pressed={inst.id === selectedId}
                        className={`flex min-h-[44px] w-full !justify-start gap-2 px-3 text-left text-sm ${inst.id === selectedId ? 'bg-success/10 text-success' : 'text-foreground hover:bg-overlay'}`}>
                        <span className="min-w-0 flex-1 truncate">{inst.name} <span className="text-xs text-muted">· {inst.expansion}</span></span>
                        <span className="shrink-0 text-xs text-secondary">{instanceRange(inst)}</span>
                        <UnverifiedHint />
                    </Button>
                </li>
            ))}
        </ul>
    );
}

/** The Forever dungeon picker: an inline list on desktop, the design-system `Select` on phone. */
export function DungeonPicker({ instances, selectedId, onSelect, phone }: {
    instances: WowInstanceDto[]; selectedId: number; onSelect: (id: number) => void; phone: boolean;
}): JSX.Element {
    if (!phone) return <DungeonList instances={instances} selectedId={selectedId} onSelect={onSelect} />;
    return (
        <div className="space-y-1">
            <Select aria-label="Dungeon" value={String(selectedId)} onChange={(e) => onSelect(Number(e.target.value))}>
                {instances.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.expansion} · {instanceRange(i)}</option>)}
            </Select>
            <UnverifiedHint />
        </div>
    );
}

/** "Wowhead ↗" for the dungeon's zone page (OQ7: links only, no embedded map in v1). */
export function WowheadLink({ instance }: { instance: WowInstanceDto }): JSX.Element | null {
    const url = wowheadZoneUrl(instance.id);
    if (!url) return null;
    return (
        <a href={url} target="_blank" rel="noopener noreferrer"
            className="text-sm text-secondary hover:text-foreground hover:underline">Wowhead ↗</a>
    );
}

/** Copy the stateless share link (OQ5) for a forum post or Discord. */
export function CopyLinkButton({ url }: { url: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    const copy = (): void => {
        void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
    };
    return <Button variant="secondary" size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>;
}

function LinkOrDisabled({ to, label, primary, disabled }: { to: string; label: string; primary: boolean; disabled: boolean }): JSX.Element {
    const variant = primary ? 'primary' : 'secondary';
    if (disabled) return <Button variant={variant} size="sm" disabled>{label}</Button>;
    return <Link to={to} className={buttonClass({ variant, size: 'sm' })}>{label}</Link>;
}

/** OQ3 Option B: plain pre-fill + "& invite these N" (N = characters actually passed). */
export function CreateEventButtons({ plainUrl, inviteUrl, inviteCount, excluded, empty }: {
    plainUrl: string; inviteUrl: string; inviteCount: number; excluded: string[]; empty: boolean;
}): JSX.Element {
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap gap-2">
                <LinkOrDisabled to={plainUrl} label="Create event ▸" primary disabled={empty} />
                <LinkOrDisabled to={inviteUrl} label={`Create event & invite these ${inviteCount}`} primary={false}
                    disabled={empty || inviteCount === 0} />
            </div>
            {excluded.length > 0 && (
                <p className="text-xs text-muted">{excluded.join(', ')} {excluded.length === 1 ? 'has' : 'have'} no linked character — not invited.</p>
            )}
        </div>
    );
}
