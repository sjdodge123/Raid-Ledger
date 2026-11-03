/**
 * ROK-2068 — "Manage my saves" (operator ruling 2026-11-03, Q1 = b): every one
 * of the caller's playthroughs (filed or not, any hub) grouped by the month of
 * its newest save, newest first. A month's checkbox picks its whole group
 * (indeterminate when partly picked). The destructive footer button leads to a
 * confirm step in the same overlay; confirming POSTs the picked campaign keys
 * (`POST plugins/bg3/me/saves/remove`, at most `BG3_REMOVE_SAVES_MAX_KEYS`).
 * Unticking never deletes anything — only the confirmed Remove does.
 */
import { useMemo, useState, type JSX } from 'react';
import { BG3_REMOVE_SAVES_MAX_KEYS, type Bg3CampaignSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { toast } from '../../../lib/toast';
import { useBg3MyAllSaves } from '../hooks/use-bg3-hub';
import { useRemoveBg3Saves } from '../hooks/use-bg3-mutations';
import {
    bg3AreaLabel, bg3SaveLine, groupByMonth, groupByPlaythrough, groupState, removePlaythroughsLabel, removePlaythroughsTitle, saveCountLabel,
    setGroup, uniquePlaythroughLabels, type Bg3MonthGroup, type Bg3Playthrough,
} from '../lib/bg3-playthroughs';
import { Bg3Overlay } from './bg3-overlay';
import { Bg3RemoveSavesConfirm, Bg3RemoveSavesConfirmFooter } from './bg3-remove-saves-confirm';
import { toastBg3CampaignError } from './bg3-campaign-toast';

export const BG3_MANAGE_SAVES_TITLE = 'Manage my saves';
export const BG3_MANAGE_SAVES_OVER_CAP_NOTE = `Pick ${BG3_REMOVE_SAVES_MAX_KEYS} or fewer playthroughs at a time.`;
export const BG3_MANAGE_SAVES_CAPPED_NOTE = 'You have more saves than this list shows. Removing a playthrough still removes all of its saves.';
export const BG3_MANAGE_SAVES_ERROR_TOAST = "Couldn't remove your saves.";

export interface Bg3ManageSavesSheetProps {
    readonly isOpen: boolean;
    readonly hubId: number;
    /** This hub's campaigns — names a filed playthrough's campaign. */
    readonly campaigns: readonly Bg3CampaignSummary[];
    readonly onClose: () => void;
}

type Keys = ReadonlySet<string>;

function filedNote(p: Bg3Playthrough, campaigns: readonly Bg3CampaignSummary[]): string {
    const filed = p.saves.find((s) => s.campaignId !== null);
    if (!filed) return '';
    const campaign = campaigns.find((c) => c.id === filed.campaignId);
    return campaign ? ` · In ${campaign.name}` : " · In another hub's campaign";
}

interface ListCtx {
    readonly selected: Keys;
    readonly labels: ReadonlyMap<string, string>;
    readonly capped: boolean;
    readonly campaigns: readonly Bg3CampaignSummary[];
    readonly onToggle: (key: string) => void;
    readonly onGroup: (keys: readonly string[], on: boolean) => void;
}

function MonthGroupItem({ group, ctx }: { group: Bg3MonthGroup; ctx: ListCtx }): JSX.Element {
    const keys = group.playthroughs.map((p) => p.campaignKey);
    const state = groupState(ctx.selected, keys);
    const count = keys.length === 1 ? '1 playthrough' : `${keys.length} playthroughs`;
    return (
        <li data-testid="bg3-manage-saves-month" data-month={group.key}>
            <Checkbox label={<span className="font-semibold">{group.label}</span>} description={`Select all ${count}`}
                checked={state.checked} indeterminate={state.indeterminate} onChange={() => ctx.onGroup(keys, !state.checked)} />
            <ul className="flex flex-col pl-8" aria-label={group.label}>
                {group.playthroughs.map((p) => (
                    <li key={p.campaignKey} data-testid="bg3-manage-saves-row">
                        <Checkbox label={ctx.labels.get(p.campaignKey) ?? p.newest.saveName}
                            description={`${saveCountLabel(p.saves.length, ctx.capped)} · ${bg3SaveLine(p.newest)}${filedNote(p, ctx.campaigns)}`}
                            checked={ctx.selected.has(p.campaignKey)} onChange={() => ctx.onToggle(p.campaignKey)} />
                    </li>
                ))}
            </ul>
        </li>
    );
}

interface BodyProps { readonly loading: boolean; readonly months: readonly Bg3MonthGroup[]; readonly overCap: boolean; readonly ctx: ListCtx }

function ManageBody({ loading, months, overCap, ctx }: BodyProps): JSX.Element {
    let list: JSX.Element;
    if (loading) list = <p className="text-sm text-muted">Loading your saves…</p>;
    else if (months.length === 0) list = <p className="text-sm text-muted">You haven't uploaded any saves.</p>;
    else list = <ul className="flex flex-col gap-3" aria-label="Your playthroughs by month">{months.map((g) => <MonthGroupItem key={g.key} group={g} ctx={ctx} />)}</ul>;
    return (
        <div className="flex flex-col gap-4" data-testid="bg3-manage-saves">
            <p className="text-sm text-muted">Every save you've uploaded, from every hub, by playthrough. Removing a playthrough deletes all of its saves and their Gallery pictures.</p>
            {list}
            {ctx.capped && <p className="text-sm text-secondary" role="note">{BG3_MANAGE_SAVES_CAPPED_NOTE}</p>}
            {overCap && <p className="text-sm text-secondary" role="note" data-testid="bg3-manage-saves-over-cap">{BG3_MANAGE_SAVES_OVER_CAP_NOTE}</p>}
        </div>
    );
}

interface PickFooterProps { readonly label: string; readonly disabled: boolean; readonly onCancel: () => void; readonly onRemove: () => void }

function PickFooter({ label, disabled, onCancel, onRemove }: PickFooterProps): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button variant="destructive" onClick={onRemove} disabled={disabled}>{label}</Button>
        </>
    );
}

function useManageSaves(isOpen: boolean) {
    const query = useBg3MyAllSaves(isOpen);
    const playthroughs = useMemo(() => groupByPlaythrough(query.data?.saves ?? []), [query.data]);
    const months = useMemo(() => groupByMonth(playthroughs), [playthroughs]);
    const labels = useMemo(() => {
        const names = uniquePlaythroughLabels(playthroughs, bg3AreaLabel);
        return new Map(playthroughs.map((p, i) => [p.campaignKey, names[i] ?? p.newest.saveName]));
    }, [playthroughs]);
    const [selected, setSelected] = useState<Keys>(new Set());
    const picked = playthroughs.filter((p) => selected.has(p.campaignKey));
    return { query, months, labels, selected, setSelected, picked, capped: (query.data?.nextCursor ?? null) !== null };
}

export function Bg3ManageSavesSheet({ isOpen, hubId, campaigns, onClose }: Bg3ManageSavesSheetProps): JSX.Element {
    const m = useManageSaves(isOpen);
    const [confirming, setConfirming] = useState(false);
    const remove = useRemoveBg3Saves(hubId);
    const saves = m.picked.reduce((n, p) => n + p.saves.length, 0);
    const overCap = m.picked.length > BG3_REMOVE_SAVES_MAX_KEYS;
    const close = (): void => { m.setSelected(new Set()); setConfirming(false); onClose(); };
    const guard = useDirtyCloseGuard(m.picked.length > 0, close);
    const confirm = (): void => remove.mutate(m.picked.map((p) => p.campaignKey), {
        onSuccess: (r) => { toast.success(`Removed ${saveCountLabel(r.removed.saves)}.`); m.setSelected(new Set()); setConfirming(false); },
        onError: (err) => toastBg3CampaignError(err, BG3_MANAGE_SAVES_ERROR_TOAST),
    });
    const ctx: ListCtx = {
        selected: m.selected, labels: m.labels, capped: m.capped, campaigns,
        onToggle: (k) => m.setSelected((s) => setGroup(s, [k], !s.has(k))),
        onGroup: (keys, on) => m.setSelected((s) => setGroup(s, keys, on)),
    };
    const footer = confirming
        ? <Bg3RemoveSavesConfirmFooter pending={remove.isPending} onBack={() => setConfirming(false)} onConfirm={confirm} />
        : <PickFooter label={removePlaythroughsLabel(m.picked.length, saves, m.capped)} disabled={m.picked.length === 0 || overCap}
            onCancel={guard.requestClose} onRemove={() => setConfirming(true)} />;
    return (
        <Bg3Overlay isOpen={isOpen} title={confirming ? removePlaythroughsTitle(m.picked.length) : BG3_MANAGE_SAVES_TITLE} onClose={close}
            footer={footer} closeGuard={guard} discardMessage="Nothing will be removed.">
            {confirming ? <Bg3RemoveSavesConfirm saves={saves} capped={m.capped} />
                : <ManageBody loading={m.query.isLoading} months={m.months} overCap={overCap} ctx={ctx} />}
        </Bg3Overlay>
    );
}
