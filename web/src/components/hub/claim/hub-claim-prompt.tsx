/**
 * ROK-2153 S3b — the core "claim your character" card on the hub Overview
 * (Q2 ruling: a core cell like the Companion prompt, best match as a one-click
 * claim, no modal on arrival). A §4.7 neutral instruction callout.
 *
 * Gates (the eager `hub-claim-prompt-cell.tsx` already checked plugin active +
 * game + kind): not dismissed for THIS hub (server onboarding key
 * `claim-character`, Q4) → the status says the viewer is a member with no
 * claim and something is unclaimed. The status is fetched only once the
 * dismissal state is known and clear. A hub whose claim needs options its
 * provider cannot collect is not offered at all (fail closed).
 */
import { useEffect, useState, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { HubClaimCandidate, HubClaimStatus } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { Button } from '../../ui/button';
import { useHubOnboarding, type HubOnboardingPrompt } from '../onboarding/use-hub-onboarding';
import { HubClaimCandidateList, HubClaimErrorBanner, HubClaimIdentity, type HubClaimOptionsState } from './hub-claim-candidate-list';
import { HUB_CLAIM_TEXT, hubClaimErrorView, resolveHubClaimCopy, type HubClaimErrorView, type ResolvedHubClaimCopy } from './hub-claim-copy';
import type { HubClaimProvider, HubClaimProviderRegistration } from './hub-claim-providers';
import { hubClaimKey, useClaimHubCandidate, useHubClaim } from './use-hub-claim';
import { canClaimFromCore, shouldShowClaimPrompt } from './hub-claim-gate';

const CALLOUT = 'relative flex flex-col gap-3 rounded-lg border border-edge bg-overlay/30 p-4 md:col-span-2 lg:col-span-3';

interface ClaimFlow {
    open: boolean;
    setOpen: (open: boolean) => void;
    pendingId: string | null;
    error: HubClaimErrorView | null;
    options: HubClaimOptionsState | null;
    claim: (candidate: HubClaimCandidate) => void;
}

interface ClaimSubmit {
    pendingId: string | null;
    error: HubClaimErrorView | null;
    clearError: () => void;
    submit: (candidate: HubClaimCandidate, options?: Record<string, unknown>) => void;
}

/** The POST plus its inline error; a stale-list error (409 / gone) refetches the status. */
function useClaimSubmit(guildId: number, provider: HubClaimProvider, onDone: (ok: boolean) => void): ClaimSubmit {
    const qc = useQueryClient();
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [error, setError] = useState<HubClaimErrorView | null>(null);
    const mutation = useClaimHubCandidate(guildId, provider.onClaimed);
    const submit = (candidate: HubClaimCandidate, options?: Record<string, unknown>): void => {
        setError(null);
        setPendingId(candidate.id);
        mutation.mutate({ candidateId: candidate.id, ...(options === undefined ? {} : { options }) }, {
            onSuccess: () => { onDone(true); },
            onError: (e) => {
                const view = hubClaimErrorView(e);
                setError(view);
                onDone(false);
                if (view.refresh) void qc.invalidateQueries({ queryKey: hubClaimKey(guildId) });
            },
            onSettled: () => { setPendingId(null); },
        });
    };
    return { pendingId, error, clearError: () => { setError(null); }, submit };
}

function useClaimFlow(guildId: number, provider: HubClaimProvider, status: HubClaimStatus): ClaimFlow {
    const [open, setRawOpen] = useState(false);
    const [optionsFor, setOptionsFor] = useState<HubClaimCandidate | null>(null);
    const { pendingId, error, clearError, submit } = useClaimSubmit(guildId, provider, (ok) => {
        setOptionsFor(null);
        if (ok) setRawOpen(false);
    });
    // Opening or closing the overlay starts fresh: the list, never a stale options step or error.
    const setOpen = (next: boolean): void => { setRawOpen(next); setOptionsFor(null); clearError(); };
    const Step = provider.OptionsStep;
    const claim = (candidate: HubClaimCandidate): void => {
        if (status.claimOptions === 'none') { submit(candidate); return; }
        // Fail closed: `canClaimFromCore` keeps the card unrendered without an options step.
        if (Step === undefined) return;
        clearError();
        setOptionsFor(candidate);
        setRawOpen(true);
    };
    const options = optionsFor === null || Step === undefined ? null
        : { candidate: optionsFor, OptionsStep: Step, onSubmit: (o: Record<string, unknown>) => { submit(optionsFor, o); }, onCancel: () => { setOptionsFor(null); } };
    return { open, setOpen, pendingId, error, options, claim };
}

function DismissCorner({ onDismiss }: { onDismiss: () => void }): JSX.Element {
    // The wrapper is positioned: `Button` carries its own `relative` (§4.11 floating Button rule).
    return (
        <div className="absolute right-1 top-1">
            <Button iconOnly aria-label={HUB_CLAIM_TEXT.dismiss} variant="ghost" size="sm" onClick={onDismiss} data-testid="hub-claim-prompt-dismiss">
                <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
        </div>
    );
}

function PromptCopy({ copy }: { copy: ResolvedHubClaimCopy }): JSX.Element {
    return (
        <div className="min-w-0 pr-10">
            <h2 className="text-base font-semibold text-foreground">{copy.heading}</h2>
            <p className="mt-1 hidden text-sm text-secondary md:block" data-testid="hub-claim-prompt-body">{copy.body}</p>
            <p className="mt-1 text-sm text-secondary md:hidden">{copy.shortBody}</p>
        </div>
    );
}

interface ActionsProps { status: HubClaimStatus; flow: ClaimFlow; copy: ResolvedHubClaimCopy }

function PromptActions({ status, flow, copy }: ActionsProps): JSX.Element {
    const suggested = status.suggested;
    const openList = (): void => { flow.setOpen(true); };
    if (suggested === null) {
        return <div className="flex flex-col gap-2 sm:flex-row"><Button onClick={openList}>{copy.cta}</Button></div>;
    }
    return (
        <div className="flex flex-col gap-3" data-testid="hub-claim-suggested">
            <p className="text-sm text-secondary">{HUB_CLAIM_TEXT.suggestedLead}</p>
            <HubClaimIdentity candidate={suggested} />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button loading={flow.pendingId === suggested.id} disabled={flow.pendingId !== null && flow.pendingId !== suggested.id}
                    onClick={() => { flow.claim(suggested); }}>
                    {HUB_CLAIM_TEXT.claimNamed(suggested.name)}
                </Button>
                <Button variant="secondary" onClick={openList}>{HUB_CLAIM_TEXT.notMe}</Button>
            </div>
        </div>
    );
}

interface CardProps { guildId: number; status: HubClaimStatus; provider: HubClaimProvider; prompt: HubOnboardingPrompt }

function ClaimCard({ guildId, status, provider, prompt }: CardProps): JSX.Element {
    const copy = resolveHubClaimCopy(provider.copy);
    const flow = useClaimFlow(guildId, provider, status);
    const dismiss = (): void => { prompt.dismiss({ onSuccess: () => { toast.success(HUB_CLAIM_TEXT.dismissed); } }); };
    return (
        <section aria-label={HUB_CLAIM_TEXT.landmark} className={CALLOUT} data-testid="hub-claim-prompt">
            <PromptCopy copy={copy} />
            {flow.error !== null && !flow.open && <HubClaimErrorBanner view={flow.error} />}
            {prompt.failed && <p role="alert" className="text-sm text-danger">{HUB_CLAIM_TEXT.dismissFailed}</p>}
            <PromptActions status={status} flow={flow} copy={copy} />
            <DismissCorner onDismiss={dismiss} />
            <HubClaimCandidateList isOpen={flow.open} onClose={() => { flow.setOpen(false); }} guildId={guildId} status={status}
                pendingId={flow.pendingId} error={flow.error} options={flow.options} onClaim={flow.claim} />
        </section>
    );
}

/** Where the card stands: still deciding, on screen, or not showing (ROK-2153 r2 MINOR 1). */
export type HubClaimShowing = 'pending' | 'showing' | 'hidden';

/** Reports the card's state (the Overview holds the Companion prompt until it is `hidden`, §4.7). */
function useReportShowing(state: HubClaimShowing, onShowingChange: ((state: HubClaimShowing) => void) | undefined): void {
    useEffect(() => { onShowingChange?.(state); }, [state, onShowingChange]);
    useEffect(() => () => { onShowingChange?.('hidden'); }, [onShowingChange]);
}

/** Pending only while a load is in flight: an errored or disabled query settles to `hidden`. */
function claimShowingState(prompt: HubOnboardingPrompt, claim: { status: HubClaimStatus | undefined; isError: boolean; enabled: boolean }, showing: boolean): HubClaimShowing {
    if (showing) return 'showing';
    if (!prompt.settled) return 'pending';
    const waiting = prompt.visible && claim.enabled && claim.status === undefined && !claim.isError;
    return waiting ? 'pending' : 'hidden';
}

interface HubClaimPromptProps {
    guildId: number;
    registration: HubClaimProviderRegistration;
    onShowingChange?: ((state: HubClaimShowing) => void) | undefined;
}

/** Lazy-loaded by `hub-claim-prompt-cell.tsx` once the cheap gates passed; key it by hub. */
export function HubClaimPrompt({ guildId, registration, onShowingChange }: HubClaimPromptProps): JSX.Element | null {
    const prompt = useHubOnboarding('claim-character', guildId);
    const { data: status, isError } = useHubClaim(guildId, prompt.visible);
    const misconfigured = status !== undefined && !canClaimFromCore(status, registration.provider);
    useEffect(() => {
        if (misconfigured) console.error(`[hub-claim] ${registration.pluginSlug}: the claim needs options but the provider has no OptionsStep; not offering it.`);
    }, [misconfigured, registration.pluginSlug]);
    const showing = prompt.visible && status !== undefined && !misconfigured && shouldShowClaimPrompt(status);
    useReportShowing(claimShowingState(prompt, { status, isError, enabled: guildId > 0 }, showing), onShowingChange);
    if (!showing) return null;
    return <ClaimCard guildId={guildId} status={status} provider={registration.provider} prompt={prompt} />;
}
