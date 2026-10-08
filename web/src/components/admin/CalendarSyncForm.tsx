/**
 * Admin → Integrations → Calendar Sync form (ROK-1591).
 *
 * One form, one save path: the kill switch `Switch` and the provider
 * credentials are a single draft, and Save sends ONE PUT carrying whatever
 * changed (`enabled`, client ids, secrets) — the same shape as the Discord Bot
 * form's Enable toggle. While the save is pending every control is locked
 * (`<fieldset disabled>`); Save stays a `Button loading`. Secrets are never
 * prefilled: a saved one shows a "Saved" chip, an empty box is left alone on
 * save, and "Remove saved secret" sends `''`. Redirect URIs come from the
 * server (built from `CLIENT_URL`) and are copy-only.
 */
import { useState } from 'react';
import type { AdminCalendarSyncSettings } from '@raid-ledger/contract';
import { toast } from '../../lib/toast';
import { useUpdateAdminCalendarSyncSettings } from '../../hooks/use-admin-calendar-sync';
import { Field } from '../ui/field';
import { Switch } from '../ui/switch';
import { CopyableInput, FormTextField, PasswordInput } from './admin-form-helpers';
import { IntegrationFormActions } from './integration-form-actions';
import { SavedSecretStatus } from './saved-secret-status';
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
                <li>Turn Calendar Sync on and save so members can connect their calendars</li>
            </ol>
        </div>
    );
}

function KillSwitch({ checked, saved, onChange }: { checked: boolean; saved: boolean; onChange: (next: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className="text-sm font-medium text-foreground">Enable Calendar Sync</p>
                <p id="calendar-sync-enabled-hint" className="text-xs text-muted mt-1">
                    Off by default. While off, members cannot connect a calendar and nothing syncs.
                </p>
                {checked !== saved && (
                    <p data-testid="calendar-sync-enabled-unsaved" className="text-xs text-warning mt-1">
                        Not saved yet — press Save Configuration to apply.
                    </p>
                )}
            </div>
            <Switch checked={checked} onChange={onChange} label="Enable Calendar Sync"
                aria-describedby="calendar-sync-enabled-hint" testId="calendar-sync-enabled" />
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
            <SavedSecretStatus secretLabel={`${name} client secret`} hasSecret={hasSecret} cleared={draft.secretCleared}
                onClearedChange={(secretCleared) => onChange({ ...draft, secretCleared })}
                testId={`calendar-sync-${provider}-secret-saved`} />
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

function useCalendarSyncForm(settings: AdminCalendarSyncSettings) {
    const update = useUpdateAdminCalendarSyncSettings();
    const [draft, setDraft] = useState<CalendarSyncDraft>(() => draftFromSettings(settings));
    const setProvider = (provider: CalendarSyncFormProvider, next: ProviderDraft) =>
        setDraft((prev) => ({ ...prev, [provider]: next }));
    const setEnabled = (enabled: boolean) => setDraft((prev) => ({ ...prev, enabled }));
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const body = buildCalendarSyncUpdate(draft, settings);
        if (Object.keys(body).length === 0) { toast.success('No changes to save'); return; }
        try {
            const saved = await update.mutateAsync(body);
            // Reset from what the server stored, not from the submit-time draft.
            setDraft((current) => (saved ? draftFromSettings(saved) : settleDraftAfterSave(current)));
            toast.success('Calendar Sync settings saved');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save Calendar Sync settings');
        }
    };
    return { draft, setProvider, setEnabled, handleSave, isSaving: update.isPending };
}

export function CalendarSyncForm({ settings }: { settings: AdminCalendarSyncSettings }) {
    const form = useCalendarSyncForm(settings);
    return (
        <form onSubmit={form.handleSave} className="space-y-6" aria-label="Calendar Sync settings">
            {/* min-w-0: a fieldset's default min-content width would push the copy fields off a phone. */}
            <fieldset disabled={form.isSaving} className="min-w-0 space-y-6">
                <KillSwitch checked={form.draft.enabled} saved={settings.enabled} onChange={form.setEnabled} />
                <CalendarSyncInstructions />
                {CALENDAR_SYNC_FORM_PROVIDERS.map((provider) => (
                    <ProviderSection key={provider} provider={provider} draft={form.draft[provider]}
                        settings={settings} onChange={(next) => form.setProvider(provider, next)} />
                ))}
            </fieldset>
            <IntegrationFormActions showTest={false} showClear={false} onTest={NO_TEST} onClear={NO_TEST}
                isPending={{ save: form.isSaving, test: false, clear: false }} />
        </form>
    );
}
