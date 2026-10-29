/**
 * ROK-1958 D-5 — "Add my saves": the caller's unassigned saves grouped by
 * playthrough (campaign key; own area always shown, ROK-1957 D-14) + "Also put
 * my other unfiled saves and future saves here". Binding is per key (operator
 * ruling 2026-10-29, Q1 = A), so a tick selects the whole playthrough, and a
 * playthrough split across campaigns moves whole (Q2 = A) — the sheet says so.
 * Save = one key PUT per ticked playthrough, then the optional default. The
 * query walks every page of unfiled saves (`fetchBg3MyUnassignedSaves`), so
 * counts are whole unless its safety stop hit — then they read "N+ saves".
 */
import { useState, type JSX } from 'react';
import { bg3LevelDisplay, type Bg3MySave } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { syncedAgo } from '../../../lib/synced-ago';
import { useBg3MyUnassignedSaves } from '../hooks/use-bg3-hub';
import { useBindBg3Saves } from '../hooks/use-bg3-mutations';
import {
    addPlaythroughsLabel, addSavesMoveNote, groupByPlaythrough, saveCountLabel, uniquePlaythroughLabels, type Bg3Playthrough,
} from '../lib/bg3-playthroughs';
import { Bg3Overlay } from './bg3-overlay';
import { toastBg3CampaignError } from './bg3-campaign-toast';

/** Shown when the page walk hit its safety stop (`nextCursor` non-null), so counts are floors. */
export const BG3_ADD_SAVES_CAPPED_NOTE = "You have more unfiled saves than this list shows. Adding a playthrough still adds all of its saves.";
export const BG3_ADD_SAVES_DEFAULT_LABEL = 'Also put my other unfiled saves and future saves here';

export interface Bg3AddSavesSheetProps {
    readonly isOpen: boolean;
    readonly hubId: number;
    readonly campaignId: number;
    readonly campaignName: string;
    readonly onClose: () => void;
}

const areaLabel = (save: Bg3MySave): string => bg3LevelDisplay(save.area).label;

function saveLine(save: Bg3MySave): string {
    const { act, label } = bg3LevelDisplay(save.area);
    return `${act === null ? label : `Act ${act} · ${label}`} · ${syncedAgo(save.savedAt)}`;
}

function toggle(set: ReadonlySet<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
}

interface PlaythroughListProps {
    readonly playthroughs: readonly Bg3Playthrough[];
    readonly selected: ReadonlySet<string>;
    readonly capped: boolean;
    readonly onToggle: (key: string) => void;
}

function PlaythroughList({ playthroughs, selected, capped, onToggle }: PlaythroughListProps): JSX.Element {
    if (playthroughs.length === 0) return <p className="text-sm text-muted">All your saves are already in a campaign.</p>;
    const labels = uniquePlaythroughLabels(playthroughs, areaLabel);
    return (
        <ul className="flex flex-col gap-3" aria-label="Your playthroughs that aren't in a campaign">
            {playthroughs.map((p, i) => (
                <li key={p.campaignKey}>
                    <Checkbox label={labels[i] ?? p.newest.saveName} description={`${saveCountLabel(p.saves.length, capped)} · ${saveLine(p.newest)}`}
                        checked={selected.has(p.campaignKey)} onChange={() => onToggle(p.campaignKey)} />
                </li>
            ))}
        </ul>
    );
}

interface FooterProps { picked: readonly Bg3Playthrough[]; capped: boolean; onCancel: () => void; onSubmit: () => void; pending: boolean }

function AddFooter({ picked, capped, onCancel, onSubmit, pending }: FooterProps): JSX.Element {
    const saves = picked.reduce((n, p) => n + p.saves.length, 0);
    return (
        <>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button onClick={onSubmit} disabled={picked.length === 0} loading={pending}>{addPlaythroughsLabel(picked.length, saves, capped)}</Button>
        </>
    );
}

export function Bg3AddSavesSheet({ isOpen, hubId, campaignId, campaignName, onClose }: Bg3AddSavesSheetProps): JSX.Element {
    const query = useBg3MyUnassignedSaves(isOpen);
    const playthroughs = groupByPlaythrough((query.data?.saves ?? []).filter((s) => s.campaignId === null));
    const capped = (query.data?.nextCursor ?? null) !== null;
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [alsoDefault, setAlsoDefault] = useState(false);
    const bind = useBindBg3Saves(hubId);
    const close = (): void => { setSelected(new Set()); setAlsoDefault(false); onClose(); };
    const picked = playthroughs.filter((p) => selected.has(p.campaignKey));
    const guard = useDirtyCloseGuard(picked.length > 0 || alsoDefault, close);
    const submit = (): void => bind.mutate({ campaignKeys: picked.map((p) => p.campaignKey), campaignId, alsoDefault }, {
        onSuccess: close,
        onError: (err) => toastBg3CampaignError(err, "Couldn't add your saves."),
    });
    const footer = <AddFooter picked={picked} capped={capped} onCancel={guard.requestClose} onSubmit={submit} pending={bind.isPending} />;
    return (
        <Bg3Overlay isOpen={isOpen} title={`Add my saves to ${campaignName}`} onClose={close} footer={footer}
            closeGuard={guard} discardMessage="The playthroughs you picked won't be added.">
            <div className="flex flex-col gap-4" data-testid="bg3-add-saves">
                <p className="text-sm text-muted">Your saves that aren't in a campaign yet, by playthrough. Adding a playthrough adds all of its saves.</p>
                {query.isLoading ? <p className="text-sm text-muted">Loading your saves…</p>
                    : <PlaythroughList playthroughs={playthroughs} selected={selected} capped={capped} onToggle={(k) => setSelected((s) => toggle(s, k))} />}
                {capped && <p className="text-sm text-secondary" role="note">{BG3_ADD_SAVES_CAPPED_NOTE}</p>}
                {picked.length > 0 && <p className="text-sm text-secondary" role="note">{addSavesMoveNote(picked.length)}</p>}
                <Checkbox label={BG3_ADD_SAVES_DEFAULT_LABEL} checked={alsoDefault} onChange={(e) => setAlsoDefault(e.target.checked)} />
            </div>
        </Bg3Overlay>
    );
}
