/**
 * Pelican "Connection" form (ROK-121) — mirrors `ItadForm` plus the
 * write-only-secret row (design system §4.11): the key input is never
 * prefilled; `SavedSecretStatus` shows whether one is stored.
 */
import { useState } from 'react';
import type { PelicanConfig } from '@raid-ledger/contract';
import { Field } from '../../../components/ui/field';
import { FormTextField, PasswordInput, TestResultBanner } from '../../../components/admin/admin-form-helpers';
import { IntegrationFormActions } from '../../../components/admin/integration-form-actions';
import { SavedSecretStatus } from '../../../components/admin/saved-secret-status';
import { PelicanTimezoneField } from './pelican-timezone-field';
import { isApplicationKey, isPelicanConfigured, type PelicanDraft } from './pelican-form.helpers';
import { usePelicanConnectionForm } from './use-pelican-connection-form';

const SAVED_PLACEHOLDER = '•'.repeat(20);

function ApiKeyField({ draft, apiKeySet, set }: {
    draft: PelicanDraft; apiKeySet: boolean; set: (patch: Partial<PelicanDraft>) => void;
}) {
    const [showKey, setShowKey] = useState(false);
    return (
        <div className="space-y-2">
            <Field id="pelicanApiKey" label="Client API key">
                <PasswordInput id="pelicanApiKey" value={draft.apiKey}
                    onChange={(v) => set({ apiKey: v, removeKey: false })}
                    placeholder={apiKeySet && !draft.removeKey ? SAVED_PLACEHOLDER : 'pacc_…'}
                    showPassword={showKey} onToggleShow={() => setShowKey(!showKey)} fieldLabel="API key" />
            </Field>
            {isApplicationKey(draft.apiKey) && (
                <p data-testid="pelican-papp-hint" className="text-xs text-warning">
                    Application keys (papp_) don&apos;t work here — use a client key (pacc_).
                </p>
            )}
            <SavedSecretStatus secretLabel="Pelican client API key" hasSecret={apiKeySet} cleared={draft.removeKey}
                onClearedChange={(cleared) => set({ removeKey: cleared, apiKey: '' })} testId="pelican-key-saved" />
        </div>
    );
}

export function PelicanConnectionForm({ config }: { config: PelicanConfig }) {
    const f = usePelicanConnectionForm(config);
    const inherited = config.timezoneInherited && f.draft.defaultTimezone === config.defaultTimezone;
    return (
        <form onSubmit={f.handleSave} className="space-y-4" aria-label="Pelican connection settings">
            {/* min-w-0: a fieldset's default min-content width would push the fields off a phone. */}
            <fieldset disabled={f.isSaving} className="min-w-0 space-y-4">
                <FormTextField id="pelicanPanelUrl" label="Panel URL" value={f.draft.panelUrl}
                    onChange={(v) => f.set({ panelUrl: v })} placeholder="https://panel.example.com" />
                <ApiKeyField draft={f.draft} apiKeySet={config.apiKeySet} set={f.set} />
                <PelicanTimezoneField key={config.defaultTimezone} value={f.draft.defaultTimezone}
                    onChange={(tz) => f.set({ defaultTimezone: tz })} inherited={inherited} />
                {f.dirty && (
                    <p data-testid="pelican-unsaved" className="text-xs text-warning">
                        Not saved yet — press Save Configuration to apply.
                    </p>
                )}
            </fieldset>
            <TestResultBanner result={f.testResult} />
            <IntegrationFormActions showTest={isPelicanConfigured(config) && !f.dirty} showClear={false}
                isPending={{ save: f.isSaving, test: f.isTesting, clear: false }}
                onTest={() => { void f.handleTest(); }} onClear={() => undefined} />
        </form>
    );
}
