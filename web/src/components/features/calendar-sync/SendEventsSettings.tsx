/**
 * "Send my Raid Ledger events" (ROK-1596 W1): the K4 desktop card / K5 phone
 * section — on/off and destination only. There is deliberately NO tentative
 * toggle (spec AC11): tentative sign-ups always sync, marked "(Tentative)".
 *
 * Every control saves immediately (no Save button, K4 note). Picking "My main
 * calendar" without the `calendar.events` grant answers 409 `needs_consent`,
 * which sends the browser to Google with `intent=primary` (D8).
 */
import { useId, useState, type JSX } from 'react';
import type { CalendarConnection, CalendarWriteTarget } from '@raid-ledger/contract';
import { Switch } from '../../ui/switch';
import { RadioGroup } from '../../ui/radio-group';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useStartOAuth, useUpdateConnection } from '../../../hooks/use-calendar-sync';
import { httpStatusOf } from '../../../lib/api/api-error';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { SEND_EVENTS_COPY as S } from './calendar-sync.copy';

type Write = CalendarConnection['write'];

/** The 409 codes D6 answers with; anything else is a plain save failure. */
function errorAction(error: Error): 'consent' | 'alreadyEnabled' | 'saveFailed' {
    if (httpStatusOf(error) !== 409) return 'saveFailed';
    if (error.message === 'needs_consent') return 'consent';
    return error.message === 'write_already_enabled' ? 'alreadyEnabled' : 'saveFailed';
}

/** Saves one `write` change; shows the pending value until the overview refetches. */
function useWriteSettings(connection: CalendarConnection) {
    const update = useUpdateConnection();
    const consent = useStartOAuth('primary');
    const [error, setError] = useState<string | null>(null);
    const save = (write: Partial<Write>): void => {
        setError(null);
        update.mutate({ id: connection.id, body: { write } }, {
            onError: (e) => {
                const action = errorAction(e);
                if (action === 'consent') consent.mutate();
                else setError(S[action]);
            },
        });
    };
    const pending = update.isPending ? update.variables?.body.write : undefined;
    const write: Write = {
        enabled: pending?.enabled ?? connection.write.enabled,
        target: pending?.target ?? connection.write.target,
    };
    const message = error ?? (consent.isError ? S.consentFailed : null);
    return { write, save, message, busy: update.isPending || consent.isPending };
}

function TwoWayTag(): JSX.Element {
    return <span className="rounded-full bg-overlay px-2 py-0.5 text-xs text-muted">{S.tag}</span>;
}

function StaysInStepNote(): JSX.Element {
    return (
        <p className="rounded-lg border border-edge bg-overlay/30 p-4 text-sm text-secondary" data-testid="send-events-note">
            <b className="text-foreground">{S.noteTitle}</b> {S.noteBody}
        </p>
    );
}

interface SendSwitchRowProps { checked: boolean; helper: string; disabled: boolean; onChange: (next: boolean) => void }

/** "Add events I sign up for" + its helper line, which also describes the switch. */
function SendSwitchRow({ checked, helper, disabled, onChange }: SendSwitchRowProps): JSX.Element {
    const helperId = useId();
    return (
        <div className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
                <p className="text-base lg:text-sm text-foreground">{S.switchLabel}</p>
                <p id={helperId} className="text-xs text-muted" data-testid="send-events-helper">{helper}</p>
            </div>
            <Switch checked={checked} onChange={onChange} label={S.switchLabel}
                aria-describedby={helperId} disabled={disabled} testId="send-events-switch" />
        </div>
    );
}

export function SendEventsSettings({ connection }: { connection: CalendarConnection }): JSX.Element {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const v = desktop ? S.desktop : S.phone;
    const { write, save, message, busy } = useWriteSettings(connection);
    const options = [
        { value: 'dedicated' as const, label: S.dedicated, description: v.dedicated },
        { value: 'primary' as const, label: S.primary, description: v.primary },
    ];
    return (
        <section className="bg-surface border border-edge-subtle rounded-xl p-4 space-y-3"
            data-testid="send-events-settings" data-connection-id={connection.id}>
            <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{S.heading}</h3>
                <TwoWayTag />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <SendSwitchRow checked={write.enabled} helper={v.helper} disabled={busy} onChange={(enabled) => save({ enabled })} />
                <RadioGroup<CalendarWriteTarget> label={S.putThemIn} hideLabel={desktop} options={options}
                    value={write.target} onChange={(target) => save({ target })} disabled={busy}
                    className="lg:col-span-2 lg:[&>div]:grid lg:[&>div]:grid-cols-2 lg:[&>div]:gap-4" />
            </div>
            {message && <p role="alert" className="text-sm text-danger" data-testid="send-events-error">{message}</p>}
            {!desktop && <StaysInStepNote />}
        </section>
    );
}
