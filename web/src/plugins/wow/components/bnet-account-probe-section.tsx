/**
 * ROK-2129 spike: the DEMO_MODE-only Battle.net account probe inside the
 * admin "WoW Forever" section. Shows the callback URL to register on the
 * Blizzard client, a region pick + Start (navigates to Battle.net), the
 * `?bnetProbe=` outcome the callback redirects back with, and the last
 * keys-only result. Renders nothing unless the server reports demoMode.
 */
import { useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BnetProbeErrorCodeSchema, BnetProbeRegionSchema, type BnetProbeErrorCode, type BnetProbeRegion } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { CopyableInput, TestResultBanner } from '../../../components/admin/admin-form-helpers';
import { useSystemStatus } from '../../../hooks/use-system-status';
import { useBnetAccountProbe } from '../hooks/use-bnet-account-probe';
import { BnetAccountProbeResult } from './bnet-account-probe-result';

const ERROR_COPY: Record<BnetProbeErrorCode, string> = {
    state: 'the sign-in link was invalid, expired or already used — press Start again.',
    denied: 'access was declined on Battle.net.',
    exchange: 'Battle.net rejected the code exchange — see the token response below.',
    upstream: 'a Battle.net call failed — see the namespace rows below.',
    unavailable: 'the probe hit an unexpected error — check the API logs.',
};

/** The `?bnetProbe=ok|error&code=` outcome the callback redirects back with; null without one. */
function CallbackBanner(): JSX.Element | null {
    const [params] = useSearchParams();
    const outcome = params.get('bnetProbe');
    if (outcome === 'ok') return <TestResultBanner result={{ success: true, message: 'Battle.net probe recorded.' }} />;
    if (outcome !== 'error') return null;
    const code = BnetProbeErrorCodeSchema.safeParse(params.get('code'));
    const copy = ERROR_COPY[code.success ? code.data : 'unavailable'];
    return <TestResultBanner result={{ success: false, message: `Battle.net probe failed: ${copy}` }} />;
}

type StartMutation = ReturnType<typeof useBnetAccountProbe>['start'];

/** Region pick + Start: posts the region, then hands the browser to Battle.net's authorize page. */
function StartControls({ start }: { start: StartMutation }): JSX.Element {
    const [region, setRegion] = useState<BnetProbeRegion>('us');
    const onStart = (): void => {
        start.mutate(region, {
            onSuccess: ({ url }) => window.location.assign(url),
            onError: (err) => toast.error(err.message || 'Could not start the Battle.net probe'),
        });
    };
    const onRegion = (value: string): void => {
        const parsed = BnetProbeRegionSchema.safeParse(value);
        if (parsed.success) setRegion(parsed.data);
    };
    return (
        <div className="flex flex-wrap items-end gap-3">
            <Field label="Region" className="w-28">
                <Select value={region} onChange={(e) => onRegion(e.target.value)}>
                    <option value="us">US</option>
                    <option value="eu">EU</option>
                </Select>
            </Field>
            <Button variant="secondary" loading={start.isPending} loadingLabel="Opening Battle.net..." onClick={onStart}>
                Start Battle.net account probe
            </Button>
        </div>
    );
}

/** DEMO_MODE-only admin Battle.net account probe (ROK-2129); null when demoMode is off. */
export function BnetAccountProbeSection(): JSX.Element | null {
    const demoMode = useSystemStatus().data?.demoMode === true;
    const { probe, start } = useBnetAccountProbe(demoMode);
    if (!demoMode) return null;
    return (
        <section aria-labelledby="wow-bnet-probe-heading" className="space-y-3 pt-4 border-t border-edge">
            <div>
                <h4 id="wow-bnet-probe-heading" className="text-sm font-semibold text-foreground">Battle.net account probe</h4>
                <p className="text-sm text-secondary">
                    DEMO_MODE only. Signs in with your own Battle.net account (scope wow.profile) and records which keys the
                    account summary returns — key names and counts only, never names or tokens.
                </p>
            </div>
            <CallbackBanner />
            {probe.isError && <p className="text-sm text-danger">Failed to load the Battle.net account probe.</p>}
            {probe.data && (
                <>
                    <Field label="Redirect URI" hint="Register this exact URL on your Blizzard API client.">
                        <CopyableInput value={probe.data.redirectUri} onCopied="Redirect URI copied" label="redirect URI" />
                    </Field>
                    <StartControls start={start} />
                    <BnetAccountProbeResult result={probe.data.result} />
                </>
            )}
        </section>
    );
}
