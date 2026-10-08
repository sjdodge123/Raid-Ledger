/**
 * Admin → Integrations → Calendar Sync form (ROK-1591).
 *
 * The kill switch is a `Switch` that saves on its own (it applies
 * immediately). The provider credentials are a form saved through the shared
 * `IntegrationFormActions`. Secrets are never prefilled: a saved one shows a
 * "Saved" chip, an empty box is left alone on save, and "Remove saved secret"
 * sends `''`. Redirect URIs come from the server (built from `CLIENT_URL`)
 * and are copy-only.
 */
import { useState } from 'react';
import type { AdminCalendarSyncSettings } from '@raid-ledger/contract';
import { toast } from '../../lib/toast';
import { useUpdateAdminCalendarSyncSettings } from '../../hooks/use-admin-calendar-sync';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Switch } from '../ui/switch';
import { CopyableInput, FormTextField, PasswordInput } from './admin-form-helpers';
import { IntegrationFormActions } from './integration-form-actions';
import {
    CALENDAR_SYNC_FORM_PROVIDERS,
    buildCalendarSyncUpdate,
    draftFromSettings,
    settleDraftAfterSave,
    type CalendarSyncDraft,
    type CalendarSyncFormProvider,
    type ProviderDraft,
} from './calendar-sync-form.helpers';

const PROVIDER_COPY: Record<CalendarSyncFormProvider, { name: string; console: string; idLabel: string }> = {
    google: { name: 'Google', console: 'Google Cloud Console → APIs & Services → Credentials', idLabel: 'Google client ID' },
    microsoft: { name: 'Microsoft', console: 'Microsoft Entra ID → App registrations', idLabel: 'Microsoft application (client) ID' },
};

const NO_TEST = () => undefined;

function CalendarSyncInstructions() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Create an OAuth client in {PROVIDER_COPY.google.console} and/or {PROVIDER_COPY.microsoft.console}</li>
                <li>Add the provider&apos;s redirect URI below to that client exactly as shown</li>
                <li>Paste the client ID and secret here and save</li>
                <li>Turn Calendar Sync on so members can connect their calendars</li>
            </ol>
        </div>
    );
}

function KillSwitch({ enabled }: { enabled: boolean }) {
    const update = useUpdateAdminCalendarSyncSettings();
    const handleChange = async (next: boolean) => {
        try {
            await update.mutateAsync({ enabled: next });
            toast.success(next ? 'Calendar Sync turned on' : 'Calendar Sync turned off');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update Calendar Sync');
        }
    };
    return (
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className="text-sm font-medium text-foreground">Enable Calendar Sync</p>
                <p id="calendar-sync-enabled-hint" className="text-xs text-muted mt-1">
                    Off by default. While off, members cannot connect a calendar and nothing syncs.
                </p>
            </div>
            <Switch checked={enabled} onChange={(next) => { void handleChange(next); }} label="Enable Calendar Sync"
                aria-describedby="calendar-sync-enabled-hint" disabled={update.isPending} testId="calendar-sync-enabled" />
        </div>
    );
}

function SavedSecretStatus({ name, hasSecret, cleared, onClearedChange }: {
    name: string; hasSecret: boolean; cleared: boolean; onClearedChange: (cleared: boolean) => void;
}) {
    if (!hasSecret) return <p className="text-xs text-muted">No secret saved yet.</p>;
    if (cleared) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-warning">The saved secret will be removed when you save.</p>
                <Button variant="ghost" size="sm" onClick={() => onClearedChange(false)}>Undo</Button>
            </div>
        );
    }
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span data-testid={`calendar-sync-${name.toLowerCase()}-secret-saved`}
                className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                Saved
            </span>
            <Button variant="ghost" size="sm" onClick={() => onClearedChange(true)}
                aria-label={`Remove saved ${name} client secret`}>
                Remove saved secret
            </Button>
        </div>
    );
}

function SecretField({ provider, draft, hasSecret, onChange }: {
    provider: CalendarSyncFormProvider; draft: ProviderDraft; hasSecret: boolean; onChange: (next: ProviderDraft) => void;
}) {
    const [revealed, setRevealed] = useState(false);
    const name = PROVIDER_COPY[provider].name;
    const id = `calendarSync-${provider}-secret`;
    return (
        <div className="space-y-2">
            <Field id={id} label={`${name} client secret`}>
                <PasswordInput id={id} value={draft.secret} onChange={(secret) => onChange({ ...draft, secret })}
                    placeholder={hasSecret ? 'Type a new secret to replace the saved one' : 'Paste the client secret'}
                    showPassword={revealed} onToggleShow={() => setRevealed(!revealed)} fieldLabel={`${name} client secret`} />
            </Field>
            <SavedSecretStatus name={name} hasSecret={hasSecret} cleared={draft.secretCleared}
                onClearedChange={(secretCleared) => onChange({ ...draft, secretCleared })} />
        </div>
    );
}

function ProviderSection({ provider, draft, settings, onChange }: {
    provider: CalendarSyncFormProvider; draft: ProviderDraft;
    settings: AdminCalendarSyncSettings; onChange: (next: ProviderDraft) => void;
}) {
    const copy = PROVIDER_COPY[provider];
    return (
        <section className="space-y-4" aria-labelledby={`calendarSync-${provider}-heading`}>
            <h3 id={`calendarSync-${provider}-heading`} className="text-base font-semibold text-foreground">{copy.name}</h3>
            <FormTextField id={`calendarSync-${provider}-clientId`} label={copy.idLabel} value={draft.clientId}
                onChange={(clientId) => onChange({ ...draft, clientId })} placeholder="Paste the client ID" />
            <SecretField provider={provider} draft={draft} hasSecret={settings[provider].hasSecret} onChange={onChange} />
            <div>
                <p className="text-sm font-medium text-foreground mb-1">{copy.name} redirect URI</p>
                <CopyableInput value={settings.redirectUris[provider]} onCopied="Redirect URI copied"
                    label={`${copy.name} redirect URI`} />
                <p className="text-xs text-dim mt-1.5">Click to copy. Add it to {copy.console}.</p>
            </div>
        </section>
    );
}

function useCredentialsForm(settings: AdminCalendarSyncSettings) {
    const update = useUpdateAdminCalendarSyncSettings();
    const [draft, setDraft] = useState<CalendarSyncDraft>(() => draftFromSettings(settings));
    const setProvider = (provider: CalendarSyncFormProvider, next: ProviderDraft) =>
        setDraft((prev) => ({ ...prev, [provider]: next }));
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const body = buildCalendarSyncUpdate(draft, settings);
        if (Object.keys(body).length === 0) { toast.success('No changes to save'); return; }
        try {
            await update.mutateAsync(body);
            setDraft(settleDraftAfterSave(draft));
            toast.success('Calendar Sync settings saved');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save Calendar Sync settings');
        }
    };
    return { draft, setProvider, handleSave, isSaving: update.isPending };
}

export function CalendarSyncForm({ settings }: { settings: AdminCalendarSyncSettings }) {
    const form = useCredentialsForm(settings);
    return (
        <div className="space-y-6">
            <KillSwitch enabled={settings.enabled} />
            <CalendarSyncInstructions />
            <form onSubmit={form.handleSave} className="space-y-6" aria-label="Calendar Sync provider credentials">
                {CALENDAR_SYNC_FORM_PROVIDERS.map((provider) => (
                    <ProviderSection key={provider} provider={provider} draft={form.draft[provider]}
                        settings={settings} onChange={(next) => form.setProvider(provider, next)} />
                ))}
                <IntegrationFormActions showTest={false} showClear={false} onTest={NO_TEST} onClear={NO_TEST}
                    isPending={{ save: form.isSaving, test: false, clear: false }} />
            </form>
        </div>
    );
}
