/**
 * ROK-1958 D-16 — a `Select` of the hub's non-archived campaigns plus
 * "New campaign…" (picking it calls `onNewCampaign`, the value is unchanged).
 * Used by "New saves go to:" here and by ROK-1960's upload step.
 */
import type { ChangeEvent, JSX } from 'react';
import type { Bg3CampaignSummary } from '@raid-ledger/contract';
import { Select } from '../../../components/ui/select';

const NEW = '__new';

export interface Bg3CampaignPickerProps {
    readonly campaigns: readonly Bg3CampaignSummary[];
    readonly value: number | null;
    readonly onChange: (campaignId: number | null) => void;
    readonly onNewCampaign: () => void;
    /** Label of the "no campaign" option; omitted = no such option. */
    readonly noneLabel?: string;
    readonly disabled?: boolean;
    readonly id?: string;
}

export function Bg3CampaignPicker(props: Bg3CampaignPickerProps): JSX.Element {
    const live = props.campaigns.filter((c) => c.archivedAt === null);
    const onChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        const v = e.target.value;
        if (v === NEW) { props.onNewCampaign(); return; }
        props.onChange(v === '' ? null : Number(v));
    };
    return (
        <Select value={props.value === null ? '' : String(props.value)} onChange={onChange}
            disabled={props.disabled ?? false} {...(props.id ? { id: props.id } : {})}>
            {(props.noneLabel !== undefined || props.value === null) && <option value="">{props.noneLabel ?? 'Pick a campaign'}</option>}
            {live.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            <option value={NEW}>New campaign…</option>
        </Select>
    );
}
