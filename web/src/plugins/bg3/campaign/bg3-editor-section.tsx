/**
 * ROK-1958 D-12 — the Campaign tab's "Hub settings" (editors and staff, i.e.
 * `canEdit` from the campaigns response): the spoiler switch and the Active
 * campaign select (non-archived campaigns only). Hidden for everyone else.
 */
import type { JSX } from 'react';
import type { Bg3HubCampaignsResponse } from '@raid-ledger/contract';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { SettingsSection, SettingsSwitchRow } from '../../../components/hub/settings/settings-rows';
import { useUpdateBg3HubSettings } from '../hooks/use-bg3-mutations';
import { toastBg3CampaignError } from './bg3-campaign-toast';

export const BG3_SPOILER_HINT =
    "Members who are behind won't see where the party is or the save screenshots. Applies to everyone on this hub.";

export interface Bg3EditorSectionProps {
    readonly hubId: number;
    readonly data: Bg3HubCampaignsResponse;
}

export function Bg3EditorSection({ hubId, data }: Bg3EditorSectionProps): JSX.Element | null {
    const save = useUpdateBg3HubSettings(hubId);
    if (!data.canEdit) return null;
    const onError = (err: unknown): void => toastBg3CampaignError(err, "Couldn't save the hub settings.");
    const live = data.campaigns.filter((c) => c.archivedAt === null);
    const active = data.settings.activeCampaignId;
    return (
        <SettingsSection title="Hub settings" blurb="Editors and staff only" testId="bg3-editor-section">
            <SettingsSwitchRow label="Hide location and screenshots" hint={BG3_SPOILER_HINT}
                checked={data.settings.hideLocationAndScreenshots}
                onChange={(v) => save.mutate({ hideLocationAndScreenshots: v }, { onError })} />
            <Field label="Active campaign" hint="The hub cards show this campaign.">
                <Select value={active === null ? '' : String(active)}
                    onChange={(e) => save.mutate({ activeCampaignId: e.target.value === '' ? null : Number(e.target.value) }, { onError })}>
                    <option value="">No active campaign</option>
                    {live.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </Select>
            </Field>
        </SettingsSection>
    );
}
