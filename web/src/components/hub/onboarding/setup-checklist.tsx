/**
 * ROK-1830 S5 (D11-B prompt 2) — the editor setup checklist on the hub
 * Overview. Shown to anyone who can edit the hub (Leader, admin and Officers),
 * from page data the Overview already holds; it goes away on its own once
 * every actionable step is done, and can be dismissed per hub before then.
 *
 * ROK-1840 brings it back to the approved S0 prototype: the card is titled
 * with the hub's name, the count sits beside a progress bar, every row carries
 * a description line and a button-styled action, and the footer says the
 * hiding is remembered on the account rather than in this browser.
 */
import type { JSX } from 'react';
import { Button } from '../../ui/button';
import { buttonClass } from '../../ui/button-classes';
import { WidgetCard } from '../hub-bits';
import { GuildMeter } from '../events/guild-meter';
import { useGuildProfile } from '../api/use-guild-content';
import { useGuildDiscord } from '../discord/use-guild-discord';
import { useHubSettings } from '../settings/hub-settings-context';
import { useHubOnboarding } from './use-hub-onboarding';
import { setupProgress, setupSteps, type SetupStep } from './setup-checklist.helpers';

const MARK = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold leading-none';
// A real anchor that must look like a button takes `buttonClass` (ROK-1599) —
// the prototype's rows are buttons, and a tab step is still a hash link.
const ROW_LINK = buttonClass({ variant: 'secondary', size: 'sm' });

function StepAction({ step, onPickChannel }: { step: SetupStep; onPickChannel: (() => void) | null }): JSX.Element | null {
    if (step.done) return <span className="text-xs font-medium text-success">Done</span>;
    if (step.action.kind === 'blocked') {
        return <span className="text-xs text-muted" data-testid={`setup-step-blocked-${step.id}`}>{step.action.reason}</span>;
    }
    if (step.action.kind === 'channel') {
        if (!onPickChannel) return null;
        return <Button variant="secondary" size="sm" onClick={onPickChannel} data-testid={`setup-step-action-${step.id}`}>{step.actionLabel}</Button>;
    }
    return <a href={step.action.hash} className={ROW_LINK} data-testid={`setup-step-action-${step.id}`}>{step.actionLabel}</a>;
}

function StepRow({ step, onPickChannel }: { step: SetupStep; onPickChannel: (() => void) | null }): JSX.Element {
    return (
        <li
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge-subtle py-2 last:border-b-0"
            data-testid={`setup-step-${step.id}`}
            data-done={step.done ? 'true' : 'false'}
        >
            <span aria-hidden className={`${MARK} ${step.done ? 'border-success/40 bg-success/10 text-success' : 'border-edge-strong text-muted'}`}>
                {step.done ? '✓' : ''}
            </span>
            <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${step.done ? 'text-muted' : 'text-foreground'}`}>{step.label}</span>
                <span className="block text-xs text-muted" data-testid={`setup-step-desc-${step.id}`}>{step.description}</span>
            </span>
            {/* A done row already carries a visible "Done" chip — a second sr-only "done" reads it twice. */}
            {!step.done && <span className="sr-only">not done yet</span>}
            <span className="ml-auto shrink-0"><StepAction step={step} onPickChannel={onPickChannel} /></span>
        </li>
    );
}

function ProgressRow({ label, pct }: { label: string; pct: number }): JSX.Element {
    return (
        <div className="mb-3 flex items-center gap-3">
            <span className="flex-1"><GuildMeter pct={pct} label={`Setup progress: ${label} done`} /></span>
            <span className="text-sm font-semibold tabular-nums text-foreground" data-testid="setup-checklist-progress">{label} done</span>
        </div>
    );
}

function ChecklistFooter(): JSX.Element {
    return (
        <p className="mt-3 text-xs text-dim" data-testid="setup-checklist-footer">
            Only editors see this. Hiding it is saved to your account.
        </p>
    );
}

export interface HubSetupChecklistProps {
    guildId: number;
    canEdit: boolean;
    /** The hub's name — the prototype titles the card "Set up <guild>". */
    guildName?: string | undefined;
    /** The hub's roster size (spec D11-B "roster imported"). */
    memberCount: number;
    /** `undefined` until the raids query settles; `null` = nothing tagged yet. */
    nextRaid: unknown | undefined;
    modsConfigured: boolean;
    /** The hub kind registers mod sources at all (Lead ruling 3). */
    hasModSources: boolean;
}

/** The grid cell is a Fragment, so the card owns its own two-column span. */
const SPAN = 'md:col-span-2';

export function HubSetupChecklist(props: HubSetupChecklistProps): JSX.Element | null {
    const { guildId, canEdit, guildName, memberCount, nextRaid, modsConfigured, hasModSources } = props;
    const prompt = useHubOnboarding('hub-setup-checklist', guildId);
    const profile = useGuildProfile(guildId, canEdit);
    const discord = useGuildDiscord(guildId);
    const { openChannelPicker } = useHubSettings();
    const steps = setupSteps({
        profile: profile.data, discord: discord.data, memberCount,
        hasNextRaid: nextRaid !== null && nextRaid !== undefined,
        modsConfigured, hasModSources, canPickChannel: openChannelPicker !== null,
    });
    const progress = setupProgress(steps);
    // Every query has to have answered: a missing profile reads exactly like
    // an empty one, so an unsettled page would show every step as "not done".
    const settled = profile.data !== undefined && discord.data !== undefined && nextRaid !== undefined;
    if (!canEdit || !prompt.visible || !settled || progress.complete) return null;
    const title = guildName?.trim() ? `Set up ${guildName.trim()}` : 'Finish setting up';
    return (
        <div className={SPAN}><WidgetCard
            id="setup-checklist"
            title={title}
            action={<Button variant="ghost" size="sm" onClick={prompt.dismiss} data-testid="setup-checklist-dismiss">Hide checklist</Button>}
        >
            <ProgressRow label={progress.label} pct={progress.pct} />
            {prompt.failed && <p role="alert" data-testid="setup-checklist-error" className="mb-2 text-sm text-danger">We couldn&apos;t dismiss that just now. Try again in a moment.</p>}
            <ul className="flex flex-col" data-testid="setup-checklist">
                {steps.map((s) => <StepRow key={s.id} step={s} onPickChannel={openChannelPicker} />)}
            </ul>
            <ChecklistFooter />
        </WidgetCard></div>
    );
}
