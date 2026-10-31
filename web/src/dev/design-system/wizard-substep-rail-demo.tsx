/**
 * §4.33 demo — the real Discord step rail driven by local state, laid out in
 * the step container's `lg:grid-cols-[13rem_minmax(0,1fr)]` grid. Loaded
 * lazily by wizard-substep-rail-section.tsx.
 */
import { useState, type JSX } from 'react';
import { DiscordSubstepRail } from '../../components/admin/onboarding/discord/discord-substep-rail';
import { DISCORD_SUBSTEPS, substepIndex } from '../../components/admin/onboarding/discord/use-discord-substep';

export default function WizardSubstepRailDemo(): JSX.Element {
    const [current, setCurrent] = useState(2);
    const reachable = 3;
    const label = DISCORD_SUBSTEPS[current]?.label ?? '';
    return (
        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] rounded-xl border border-edge bg-surface p-4">
            <DiscordSubstepRail current={current} reachable={reachable} onSelect={(s) => setCurrent(substepIndex(s))} />
            <div className="rounded-lg border border-edge bg-panel p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Step {current + 1} of {DISCORD_SUBSTEPS.length}</p>
                <h3 className="mt-1 text-base font-semibold text-foreground">{label}</h3>
                <p className="mt-2 text-sm text-secondary">Steps 1–4 are reachable (buttons); step 5 is inert until the bot joins. Click a done step to go back.</p>
            </div>
        </div>
    );
}
