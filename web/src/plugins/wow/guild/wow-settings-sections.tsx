/**
 * ROK-1813 (D10) — the WoW guild hub's `HubModule.settingsSections`: one
 * slot, so this wrapper stacks every WoW section in sheet order — the Blizzard
 * roster (ROK-1928, Forever only) then the public recruiting card (`canEdit`
 * only). Each section decides for itself whether it renders.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { BlizzardRosterSection } from './blizzard-roster-section';
import { PublicCardSettingsSection } from '../public-card/public-card-settings-section';

export function WowSettingsSections(ctx: HubCtx): JSX.Element {
    return (
        <>
            <BlizzardRosterSection {...ctx} />
            <PublicCardSettingsSection {...ctx} />
        </>
    );
}
