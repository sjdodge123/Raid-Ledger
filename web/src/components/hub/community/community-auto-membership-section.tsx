/**
 * ROK-1893 P1 (ruling §8b, wireframe panel 2) — the Leader's hub-settings
 * "Membership" control: what signing up for a hub event does — Off, Suggest
 * ("Join this hub?" after the signup) or Auto (they become a member). The API
 * sends `guild.autoMembership` to the Leader and staff only; the section
 * renders only when it is present and the viewer is the Leader or staff.
 */
import type { JSX } from 'react';
import type { HubAutoMembershipMode } from '@raid-ledger/contract';
import type { HubCtx } from '../../../plugins/hub-module';
import { isOperatorOrAdmin, useAuth } from '../../../hooks/use-auth';
import { RadioGroup } from '../../ui/radio-group';
import { SettingsSection } from '../settings/settings-rows';
import { useHubAutoMembership } from './hub-join-prompts-api';

const MODE_OPTIONS = [
    { value: 'off', label: 'Off', description: 'Signing up for a hub event does nothing to membership.' },
    { value: 'suggest', label: 'Suggest', description: 'Ask “Join this hub?” right after they sign up. Default for new hubs.' },
    { value: 'auto', label: 'Auto', description: 'Add them as a member when they sign up.' },
] as const;

function ModePicker({ hubId, mode }: { hubId: number; mode: HubAutoMembershipMode }): JSX.Element {
    const save = useHubAutoMembership(hubId);
    const shown = save.isPending && save.variables !== undefined ? save.variables : mode;
    return (
        <RadioGroup label="When someone signs up for a hub event" options={MODE_OPTIONS} value={shown}
            disabled={save.isPending} onChange={(next) => { if (next !== mode) save.mutate(next); }} />
    );
}

/** Leader (or staff) only: the hub's auto-membership mode. */
export function CommunityAutoMembershipSection({ ctx }: { ctx: HubCtx }): JSX.Element | null {
    const { user } = useAuth();
    const mode = ctx.page.guild.autoMembership;
    const allowed = ctx.page.viewer.role === 'leader' || isOperatorOrAdmin(user);
    if (mode === undefined || !allowed) return null;
    return (
        <SettingsSection title="Membership" blurb="Existing hubs start on Off." testId="community-settings-auto-membership">
            <ModePicker hubId={ctx.page.guild.id} mode={mode} />
        </SettingsSection>
    );
}
