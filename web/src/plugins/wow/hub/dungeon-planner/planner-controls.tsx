/**
 * ROK-2216 — the planner's header controls (port of the ROK-2207 prototype):
 * the Forever dungeon picker (an inline list at ≥1024px, the design-system
 * `Select` below), the Wowhead zone link (OQ7), Copy link (OQ5) and the
 * Create-event buttons (OQ3 Option B → ROK-2215's `/events/new` pre-fill).
 */
import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { WowInstanceDto } from '@raid-ledger/contract';
import { Button } from '../../../../components/ui/button';
import { buttonClass } from '../../../../components/ui/button-classes';
import { Select } from '../../../../components/ui/select';
import { getWowheadZoneUrl } from '../../lib/wowhead-urls';
import { instanceRange } from './planner-display';

/** "levels unverified" — only for rows whose range is not from the game itself (ruling 10). */
export function UnverifiedHint({ instance }: { instance: WowInstanceDto }): JSX.Element | null {
    if (instance.levelSource === 'in_game') return null;
    return <span className="text-xs text-dim" title="This level range is not from the game itself">levels unverified</span>;
}

interface PickerProps { instances: WowInstanceDto[]; selectedId: number | null; onSelect: (id: number) => void }

function DungeonList({ instances, selectedId, onSelect }: PickerProps): JSX.Element {
    return (
        <ul aria-label="Dungeons" className="max-h-56 overflow-y-auto rounded-md border border-edge bg-panel">
            {instances.map((inst) => (
                <li key={inst.id} className="border-b border-edge-subtle last:border-b-0">
                    <Button variant="bare" onClick={() => onSelect(inst.id)} aria-pressed={inst.id === selectedId}
                        className={`flex min-h-[44px] w-full !justify-start gap-2 px-3 text-left text-sm ${inst.id === selectedId ? 'bg-success/10 text-success' : 'text-foreground hover:bg-overlay'}`}>
                        <span className="min-w-0 flex-1 truncate">{inst.name} <span className="text-xs text-muted">· {inst.expansion}</span></span>
                        <span className="shrink-0 text-xs text-secondary">{instanceRange(inst)}</span>
                        <UnverifiedHint instance={inst} />
                    </Button>
                </li>
            ))}
        </ul>
    );
}

/** The Forever dungeon picker: an inline list on desktop, the native `Select` on tablet/phone. */
export function DungeonPicker({ desktop, ...p }: PickerProps & { desktop: boolean }): JSX.Element {
    if (desktop) return <DungeonList {...p} />;
    return (
        <Select aria-label="Dungeon" value={p.selectedId === null ? '' : String(p.selectedId)}
            onChange={(e) => { if (e.target.value) p.onSelect(Number(e.target.value)); }}>
            <option value="">Pick a dungeon</option>
            {p.instances.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.expansion} · {instanceRange(i)}</option>)}
        </Select>
    );
}

/** "Wowhead ↗" to the dungeon's zone page — rendered only when the catalogue knows the zone id. */
export function WowheadLink({ instance }: { instance: WowInstanceDto }): JSX.Element | null {
    if (typeof instance.wowheadZoneId !== 'number') return null;
    return (
        <a href={getWowheadZoneUrl(instance.wowheadZoneId, 'wow_forever')} target="_blank" rel="noopener noreferrer"
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

/** The Create-event pair; N = claimed characters the plan API kept (spec L12). */
export interface CreateEventLinks { plain: string | null; invite: string; inviteCount: number; excluded: string[] }

/** OQ3 Option B: plain pre-fill + "& invite these N"; names without quest data are listed as not invited. */
export function CreateEventButtons({ links }: { links: CreateEventLinks }): JSX.Element {
    const { plain, invite, inviteCount, excluded } = links;
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap gap-2">
                <LinkOrDisabled to={plain ?? ''} label="Create event ▸" primary disabled={plain === null} />
                <LinkOrDisabled to={invite} label={`Create event & invite these ${inviteCount}`} primary={false}
                    disabled={plain === null || inviteCount === 0} />
            </div>
            {excluded.length > 0 && (
                <p className="text-xs text-muted">{excluded.join(', ')} {excluded.length === 1 ? 'has' : 'have'} no linked character — not invited.</p>
            )}
        </div>
    );
}
