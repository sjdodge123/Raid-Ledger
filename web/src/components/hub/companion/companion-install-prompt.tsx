/**
 * ROK-2056 §3 L4 / AC 3 — the hub Overview's "install the Companion" card, the
 * §4.24 prompt-card shape (`onboarding/get-your-guild-card.tsx`). Core owns it;
 * plugins only declare a need (`hub-companion-prompts.ts`).
 *
 * Gates, cheapest first: public download exists (AC 9) → a registered prompt
 * matches (plugin active, game, kind, member) — both in the eager
 * `hub-companion-prompt-cell.tsx`, so this chunk loads only when they pass —
 * → not dismissed for THIS hub
 * (server-side onboarding key `companion-install`) → no active Companion
 * device. The device list is fetched only once every earlier gate passed.
 * Dismissal is optimistic; a rejected write brings the card back with a
 * `role="alert"` line.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { HUB_PLUGIN_MANIFESTS } from '@raid-ledger/contract';
import { getPluginBadge } from '../../../plugins/plugin-registry';
import { useCompanionDevices } from '../../../hooks/use-companion-devices';
import { COMPANION_CARD_HREF } from '../../../lib/companion-install';
import { toast } from '../../../lib/toast';
import { Button } from '../../ui/button';
import { buttonClass } from '../../ui/button-classes';
import { useHubOnboarding, type HubOnboardingPrompt } from '../onboarding/use-hub-onboarding';
import type { HubCompanionPromptRegistration } from './hub-companion-prompts';

const CARD = 'flex flex-col gap-3 rounded-xl border border-edge bg-panel p-4 md:col-span-2 lg:col-span-3';
const TITLE_ID = 'companion-install-prompt-title';
const DISMISS_TOAST = "Got it. We won't show this again.";

interface PromptCopy { heading: string; body: string; shortBody: string }

/** Registration overrides first, then the manifest requirement's title and the plugin's badge label. */
function companionPromptCopy({ pluginSlug, prompt }: HubCompanionPromptRegistration): PromptCopy {
    const manifest = Object.entries(HUB_PLUGIN_MANIFESTS).find(([slug]) => slug === pluginSlug)?.[1];
    const requirement = manifest?.setup.requirements.find((r) => r.id === prompt.requirementId);
    const label = getPluginBadge(pluginSlug)?.label ?? 'this game';
    const body = prompt.body ?? `This hub reads ${label} data. Install the Raid Ledger Companion on the PC you play on and it uploads for you.`;
    return { heading: prompt.heading ?? requirement?.title ?? 'Install the Raid Ledger Companion', body, shortBody: prompt.shortBody ?? body };
}

/** Lazy-loaded by `hub-companion-prompt-cell.tsx` once the cheap gates passed; key it by hub. */
export function CompanionInstallPrompt({ guildId, registration }: { guildId: number; registration: HubCompanionPromptRegistration }): JSX.Element | null {
    const prompt = useHubOnboarding('companion-install', guildId);
    if (!prompt.visible) return null;
    return <LinkedGate prompt={prompt} copy={companionPromptCopy(registration)} />;
}

function LinkedGate({ prompt, copy }: { prompt: HubOnboardingPrompt; copy: PromptCopy }): JSX.Element | null {
    const { data } = useCompanionDevices();
    if (data === undefined || data.some((d) => d.state === 'active')) return null;
    return <PromptCard prompt={prompt} copy={copy} />;
}

function PromptHead({ copy, onClose }: { copy: PromptCopy; onClose: () => void }): JSX.Element {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <h2 id={TITLE_ID} className="text-lg font-semibold text-foreground">{copy.heading}</h2>
                <p className="mt-1 hidden text-sm text-secondary md:block" data-testid="companion-install-prompt-body">{copy.body}</p>
                <p className="mt-1 text-sm text-secondary md:hidden">{copy.shortBody}</p>
            </div>
            <Button variant="ghost" size="sm" iconOnly aria-label="Dismiss: don't show this again"
                onClick={onClose} data-testid="companion-install-prompt-close">
                <span aria-hidden>×</span>
            </Button>
        </div>
    );
}

function PromptCard({ prompt, copy }: { prompt: HubOnboardingPrompt; copy: PromptCopy }): JSX.Element {
    const dismiss = (): void => { prompt.dismiss({ onSuccess: () => { toast.success(DISMISS_TOAST); } }); };
    return (
        <section className={CARD} aria-labelledby={TITLE_ID} data-testid="companion-install-prompt">
            <PromptHead copy={copy} onClose={dismiss} />
            {prompt.failed && (
                <p role="alert" data-testid="companion-install-prompt-error" className="text-sm text-danger">
                    We couldn&apos;t dismiss that just now. Try again in a moment.
                </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Link to={COMPANION_CARD_HREF} className={buttonClass({ variant: 'primary' })} data-testid="companion-install-prompt-install">
                    Install the Companion
                </Link>
                <Button variant="ghost" onClick={dismiss} data-testid="companion-install-prompt-dismiss">Not now</Button>
            </div>
            <p className="text-xs text-dim">
                Shown to members until you link a computer.<span className="hidden md:inline"> Hiding it is saved to your account.</span>
            </p>
        </section>
    );
}
