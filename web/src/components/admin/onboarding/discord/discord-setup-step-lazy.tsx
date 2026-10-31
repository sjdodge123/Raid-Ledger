/**
 * ROK-1703 — the wizard's Discord step (sub-step rail + screens 4a–4e) as its
 * own chunk, so it stays out of the `admin-setup-wizard` route bundle. The
 * fallback is the step's own loading spinner, so the hand-off is seamless.
 */
import { lazy, Suspense, type JSX } from 'react';
import { LoadingSpinner } from '../../../ui/loading-spinner';
import type { DiscordSetupStepProps } from './discord-setup-step';

const DiscordSetupStep = lazy(() => import('./discord-setup-step').then((m) => ({ default: m.DiscordSetupStep })));

/** Lazy wrapper for `DiscordSetupStep` — same props. */
export function LazyDiscordSetupStep(props: DiscordSetupStepProps): JSX.Element {
    return (
        <Suspense fallback={<div className="py-12 flex justify-center"><LoadingSpinner /></div>}>
            <DiscordSetupStep {...props} />
        </Suspense>
    );
}
