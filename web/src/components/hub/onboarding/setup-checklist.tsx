/**
 * ROK-1830 S5 (D11-B prompt 2) — the editor setup checklist on the hub
 * Overview. Shown to anyone who can edit the hub (Leader, admin and Officers),
 * from page data the Overview already holds; it goes away on its own once
 * every actionable step is done, and can be dismissed per hub before then.
 */
import type { JSX } from 'react';
import { Button } from '../../ui/button';
import { WidgetCard } from '../hub-bits';
import { useGuildProfile } from '../api/use-guild-content';
import { useGuildDiscord } from '../discord/use-guild-discord';
import { useHubSettings } from '../settings/hub-settings-context';
import { useHubOnboarding } from './use-hub-onboarding';
import { setupProgress, setupSteps, type SetupStep } from './setup-checklist.helpers';

const MARK = 'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none';
const LINK = 'rounded text-sm font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';

function StepAction({ step, onPickChannel }: { step: SetupStep; onPickChannel: (() => void) | null }): JSX.Element | null {
    if (step.done) return null;
    if (step.action.kind === 'blocked') {
        return <span className="text-xs text-muted" data-testid={`setup-step-blocked-${step.id}`}>{step.action.reason}</span>;
    }
    if (step.action.kind === 'channel') {
        if (!onPickChannel) return null;
        return <Button variant="ghost" size="sm" onClick={onPickChannel} data-testid={`setup-step-action-${step.id}`}>Pick one</Button>;
    }
    return <a href={step.action.hash} className={LINK} data-testid={`setup-step-action-${step.id}`}>Open</a>;
}

function StepRow({ step, onPickChannel }: { step: SetupStep; onPickChannel: (() => void) | null }): JSX.Element {
    return (
        <li className="flex flex-wrap items-center gap-2" data-testid={`setup-step-${step.id}`} data-done={step.done ? 'true' : 'false'}>
            <span aria-hidden className={`${MARK} ${step.done ? 'border-success/40 bg-success/10 text-success' : 'border-edge text-muted'}`}>
                {step.done ? '✓' : ''}
            </span>
            <span className={`text-sm ${step.done ? 'text-muted line-through' : 'text-foreground'}`}>{step.label}</span>
            <span className="sr-only">{step.done ? 'done' : 'not done yet'}</span>
            <span className="ml-auto"><StepAction step={step} onPickChannel={onPickChannel} /></span>
        </li>
    );
}

export function HubSetupChecklist({ guildId, canEdit, modsConfigured }: { guildId: number; canEdit: boolean; modsConfigured: boolean }): JSX.Element | null {
    const prompt = useHubOnboarding('hub-setup-checklist', guildId);
    const profile = useGuildProfile(guildId, canEdit);
    const discord = useGuildDiscord(guildId);
    const { openChannelPicker } = useHubSettings();
    const steps = setupSteps({ profile: profile.data, discord: discord.data, modsConfigured });
    const progress = setupProgress(steps);
    // Both queries have to have answered: a missing profile reads exactly like
    // an empty one, so an unsettled page would show every step as "not done".
    const settled = profile.data !== undefined && discord.data !== undefined;
    if (!canEdit || !prompt.visible || !settled || progress.complete) return null;
    return (
        <WidgetCard
            id="setup-checklist"
            title="Finish setting up"
            action={<Button variant="ghost" size="sm" onClick={prompt.dismiss} data-testid="setup-checklist-dismiss">Dismiss</Button>}
        >
            <p className="mb-2 text-sm text-secondary" data-testid="setup-checklist-progress">{progress.label} done</p>
            {prompt.failed && <p role="alert" data-testid="setup-checklist-error" className="mb-2 text-sm text-danger">We couldn&apos;t dismiss that just now. Try again in a moment.</p>}
            <ul className="flex flex-col gap-2" data-testid="setup-checklist">
                {steps.map((s) => <StepRow key={s.id} step={s} onPickChannel={openChannelPicker} />)}
            </ul>
        </WidgetCard>
    );
}
