/**
 * ROK-1958 D-5 — "Add my saves": the caller's unassigned saves as a checkbox
 * list (own area always shown, ROK-1957 D-14) + "Also put my future saves
 * here". Save = one key PUT per selected save, then the optional default.
 */
import { useState, type JSX } from 'react';
import { bg3LevelDisplay, type Bg3MySave } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { syncedAgo } from '../../../lib/synced-ago';
import { useBg3MyUnassignedSaves } from '../hooks/use-bg3-hub';
import { useBindBg3Saves } from '../hooks/use-bg3-mutations';
import { Bg3Overlay } from './bg3-overlay';
import { toastBg3CampaignError } from './bg3-campaign-toast';

export interface Bg3AddSavesSheetProps {
    readonly isOpen: boolean;
    readonly hubId: number;
    readonly campaignId: number;
    readonly campaignName: string;
    readonly onClose: () => void;
}

function saveLine(save: Bg3MySave): string {
    const { act, label } = bg3LevelDisplay(save.area);
    return `${act === null ? label : `Act ${act} · ${label}`} · ${syncedAgo(save.savedAt)}`;
}

function toggle(set: ReadonlySet<number>, id: number): Set<number> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
}

function SaveList({ saves, selected, onToggle }: { saves: readonly Bg3MySave[]; selected: ReadonlySet<number>; onToggle: (id: number) => void }): JSX.Element {
    if (saves.length === 0) return <p className="text-sm text-muted">All your saves are already in a campaign.</p>;
    return (
        <ul className="flex flex-col gap-3" aria-label="Your saves that aren't in a campaign">
            {saves.map((s) => (
                <li key={s.id}>
                    <Checkbox label={s.saveName} description={saveLine(s)} checked={selected.has(s.id)} onChange={() => onToggle(s.id)} />
                </li>
            ))}
        </ul>
    );
}

interface FooterProps { count: number; onCancel: () => void; onSubmit: () => void; pending: boolean }

function AddFooter({ count, onCancel, onSubmit, pending }: FooterProps): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button onClick={onSubmit} disabled={count === 0} loading={pending}>{count === 1 ? 'Add 1 save' : `Add ${count} saves`}</Button>
        </>
    );
}

export function Bg3AddSavesSheet({ isOpen, hubId, campaignId, campaignName, onClose }: Bg3AddSavesSheetProps): JSX.Element {
    const query = useBg3MyUnassignedSaves(isOpen);
    const saves = (query.data?.saves ?? []).filter((s) => s.campaignId === null);
    const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
    const [alsoDefault, setAlsoDefault] = useState(false);
    const bind = useBindBg3Saves(hubId);
    const close = (): void => { setSelected(new Set()); setAlsoDefault(false); onClose(); };
    const guard = useDirtyCloseGuard(selected.size > 0 || alsoDefault, close);
    const picked = saves.filter((s) => selected.has(s.id));
    const submit = (): void => bind.mutate({ campaignKeys: picked.map((s) => s.campaignKey), campaignId, alsoDefault }, {
        onSuccess: close,
        onError: (err) => toastBg3CampaignError(err, "Couldn't add your saves."),
    });
    const footer = <AddFooter count={picked.length} onCancel={guard.requestClose} onSubmit={submit} pending={bind.isPending} />;
    return (
        <Bg3Overlay isOpen={isOpen} title={`Add my saves to ${campaignName}`} onClose={close} footer={footer}
            closeGuard={guard} discardMessage="The saves you picked won't be added.">
            <div className="flex flex-col gap-4" data-testid="bg3-add-saves">
                <p className="text-sm text-muted">Your saves that aren't in a campaign yet.</p>
                {query.isLoading ? <p className="text-sm text-muted">Loading your saves…</p>
                    : <SaveList saves={saves} selected={selected} onToggle={(id) => setSelected((s) => toggle(s, id))} />}
                <Checkbox label="Also put my future saves here" checked={alsoDefault} onChange={(e) => setAlsoDefault(e.target.checked)} />
            </div>
        </Bg3Overlay>
    );
}
