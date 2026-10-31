import { useState, type ReactNode } from 'react';
import { Button } from '../../../ui/button';
import { Field } from '../../../ui/field';
import { Input } from '../../../ui/input';
import { PasswordInput } from '../../../ui/password-input';
import type { CheckState } from './keys-validation';
import { usePairCheck } from './use-pair-check';
import { useTokenCheck } from './use-token-check';
import { useKeysSave } from './use-keys-save';
import { IntentsFieldset } from './intents-fieldset';
import { SubstepFooter, SubstepScreen, type SubstepNav } from './substep-screen';

const STATUS_TONE: Record<CheckState['status'], string> = {
    idle: 'text-muted', checking: 'text-muted', ok: 'text-success', warn: 'text-warning', bad: 'text-danger',
};

/** Hint = where to find it + the live status line (✗ goes to the Field's error). */
function hintFor(where: string, state: CheckState): ReactNode {
    const showStatus = state.status !== 'idle' && state.status !== 'bad' && state.message;
    return (
        <>
            <span className="block">{where}</span>
            {showStatus && <span className={`block ${STATUS_TONE[state.status]}`} aria-live="polite" data-status={state.status}>{state.status === 'checking' || state.retry ? '' : '✓ '}{state.message}</span>}
        </>
    );
}

function errorFor(state: CheckState): string | undefined {
    return state.status === 'bad' ? `✗ ${state.message ?? ''}` : undefined;
}

function footerStatus(states: CheckState[]): string | undefined {
    if (states.some((s) => s.retry)) return "Discord couldn't check everything. Click Check again.";
    if (states.some((s) => s.status === 'bad')) return 'Fix the fields marked in red.';
    if (states.some((s) => s.status === 'warn')) return 'Turn on the missing switch first.';
    if (states.some((s) => s.status === 'checking')) return 'Waiting for Discord…';
    return undefined;
}

interface KeyValues { appId: string; secret: string; token: string }
interface KeySetters { setAppId: (v: string) => void; setSecret: (v: string) => void; setToken: (v: string) => void }

function KeyFields({ v, set, states }: { v: KeyValues; set: KeySetters; states: [CheckState, CheckState, CheckState] }) {
    const [idState, secretState, tokenState] = states;
    return (
        <div className="space-y-5">
                <Field label="Application ID" hint={hintFor('General Information → Application ID', idState)} error={errorFor(idState)}>
                    <Input mono inputMode="numeric" autoComplete="off" value={v.appId} success={idState.status === 'ok'} onChange={(e) => set.setAppId(e.target.value)} />
                </Field>
                <Field label="Client Secret" hint={hintFor('OAuth2 → Client Secret → Reset Secret', secretState)} error={errorFor(secretState)}>
                    <PasswordInput label="client secret" mono autoComplete="off" value={v.secret} success={secretState.status === 'ok'} onChange={(e) => set.setSecret(e.target.value)} />
                </Field>
                <Field label="Bot token" hint={hintFor('Bot → Reset Token (shown once)', tokenState)} error={errorFor(tokenState)}>
                    <PasswordInput label="bot token" mono autoComplete="off" value={v.token} success={tokenState.status === 'ok'} onChange={(e) => set.setToken(e.target.value)} />
                </Field>
            </div>
    );
}

/** 4c — "Paste your keys and bot token" (approved sheet Discord3, AC-4/5/7). */
export function KeysScreen({ onNext, onBack }: SubstepNav) {
    const [appId, setAppId] = useState('');
    const [secret, setSecret] = useState('');
    const [token, setToken] = useState('');
    const keys = useKeysSave(onNext);
    const pair = usePairCheck(appId, secret);
    const { idState, secretState } = pair;
    const { state: tokenState, recheck: recheckToken } = useTokenCheck(token, secret, appId);
    const states = [idState, secretState, tokenState];
    const ready = states.every((s) => s.status === 'ok');
    // Re-pasting the same value fires no change, so a Discord warning (a switch still off) or a
    // retryable failure gets an explicit retry. A format error is fixed by editing, not re-checking.
    const canRecheck = states.some((s) => s.retry || s.status === 'warn');
    const recheck = () => { pair.recheck(); recheckToken(); };

    return (
        <SubstepScreen step={3} title="Paste your keys and bot token" lead="Each one is checked with Discord as you paste it, and stored encrypted."
            footer={
                <SubstepFooter onBack={onBack} status={keys.saveError ?? footerStatus(states)}>
                    {canRecheck && <Button variant="secondary" onClick={recheck}>Check again</Button>}
                    <Button disabled={!ready} loading={keys.saving} onClick={() => void keys.save({ appId, secret, token })}>Continue</Button>
                </SubstepFooter>
            }>
            <KeyFields v={{ appId, secret, token }} set={{ setAppId, setSecret, setToken }} states={[idState, secretState, tokenState]} />
            <IntentsFieldset appId={appId} missing={tokenState.missingIntents} />
        </SubstepScreen>
    );
}
