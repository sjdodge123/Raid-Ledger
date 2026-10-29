/**
 * ROK-1958 D-16 — a `Select` of the hub's non-archived campaigns plus
 * "New campaign…" (picking it calls `onNewCampaign`, the value is unchanged),
 * plus the current value when it is not one of them (another hub's / archived).
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

export const BG3_OTHER_HUB_CAMPAIGN_LABEL = 'A campaign in another hub';

/**
 * A `value` with no live option here (the user's default sits in another hub,
 * or was archived) still gets its own selected option, so the picker never
 * shows "No campaign" for a set default and picking "No campaign" clears it.
 */
function offListLabel(campaigns: readonly Bg3CampaignSummary[], value: number | null): string | null {
    if (value === null) return null;
    const here = campaigns.find((c) => c.id === value);
    if (here === undefined) return BG3_OTHER_HUB_CAMPAIGN_LABEL;
    return here.archivedAt === null ? null : `${here.name} (archived)`;
}

export function Bg3CampaignPicker(props: Bg3CampaignPickerProps): JSX.Element {
    const live = props.campaigns.filter((c) => c.archivedAt === null);
    const offList = offListLabel(props.campaigns, props.value);
    const onChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        const v = e.target.value;
        if (v === NEW) { props.onNewCampaign(); return; }
        props.onChange(v === '' ? null : Number(v));
    };
    return (
        <Select value={props.value === null ? '' : String(props.value)} onChange={onChange}
            disabled={props.disabled ?? false} {...(props.id ? { id: props.id } : {})}>
            {(props.noneLabel !== undefined || props.value === null) && <option value="">{props.noneLabel ?? 'Pick a campaign'}</option>}
            {offList !== null && <option value={String(props.value)}>{offList}</option>}
            {live.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            <option value={NEW}>New campaign…</option>
        </Select>
    );
}
