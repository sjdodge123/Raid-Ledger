/**
 * ROK-1893 P1 (ruling §8b, wireframe panel 2) — the Leader's hub-settings
 * "Membership" control: what signing up for a hub event does — Off, Suggest
 * ("Join this hub?" after the signup) or Auto (they become a member). The API
 * sends `guild.autoMembership` to the Leader and staff only; the section
 * renders only when it is present and the viewer is the Leader or staff.
 */
import { useState, type JSX } from 'react';
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

/**
 * The pick shows at once: a controlled radio whose `checked` only changes when
 * the mutation's (asynchronously notified) pending state lands is reset by
 * React after the click, so the choice visibly snaps back. Local state set in
 * the change handler holds it until the save settles and the page refetches.
 */
function ModePicker({ hubId, mode }: { hubId: number; mode: HubAutoMembershipMode }): JSX.Element {
    const save = useHubAutoMembership(hubId);
    const [picked, setPicked] = useState<HubAutoMembershipMode | null>(null);
    const shown = picked ?? mode;
    const choose = (next: HubAutoMembershipMode): void => {
        if (next === shown) return;
        setPicked(next);
        save.mutate(next, { onSettled: () => setPicked(null) });
    };
    return (
        <RadioGroup label="When someone signs up for a hub event" options={MODE_OPTIONS} value={shown}
            disabled={save.isPending} onChange={choose} />
    );
}

/** Leader (or staff) only: the hub's auto-membership mode. */
export function CommunityAutoMembershipSection({ ctx }: { ctx: HubCtx }): JSX.Element | null {
    const { user } = useAuth();
    const mode = ctx.page.guild.autoMembership;
    const allowed = ctx.page.viewer.role === 'leader' || isOperatorOrAdmin(user);
    if (mode === undefined || !allowed) return null;
    return (
        <SettingsSection title="Membership" blurb="New hubs start on Suggest; hubs made before this setting start on Off." testId="community-settings-auto-membership">
            <ModePicker hubId={ctx.page.guild.id} mode={mode} />
        </SettingsSection>
    );
}
