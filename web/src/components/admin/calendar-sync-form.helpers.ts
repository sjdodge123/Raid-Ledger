/**
 * Pure draft → PUT-body logic for the admin Calendar Sync form (ROK-1591).
 *
 * The PUT contract: an omitted field leaves the stored value alone and an
 * empty string clears it. A secret input is never prefilled, so an empty
 * secret box means "untouched" — the field is omitted — unless the admin
 * explicitly removed the saved secret, which sends `''`.
 */
import type {
    AdminCalendarSyncSettings,
    UpdateAdminCalendarSyncSettings,
} from '@raid-ledger/contract';

export type CalendarSyncFormProvider = 'google' | 'microsoft';
export const CALENDAR_SYNC_FORM_PROVIDERS: readonly CalendarSyncFormProvider[] = ['google', 'microsoft'];

export interface ProviderDraft {
    clientId: string;
    /** What the admin typed this session. Never the stored value. */
    secret: string;
    /** The admin pressed "Remove saved secret": send `''` on save. */
    secretCleared: boolean;
}

/** The whole form: the kill switch and both providers save through one PUT. */
export interface CalendarSyncDraft {
    enabled: boolean;
    google: ProviderDraft;
    microsoft: ProviderDraft;
}
type ProviderUpdate = NonNullable<UpdateAdminCalendarSyncSettings['google']>;

function providerDraft(clientId: string | null): ProviderDraft {
    return { clientId: clientId ?? '', secret: '', secretCleared: false };
}

export function draftFromSettings(settings: AdminCalendarSyncSettings): CalendarSyncDraft {
    return {
        enabled: settings.enabled,
        google: providerDraft(settings.google.clientId),
        microsoft: providerDraft(settings.microsoft.clientId),
    };
}

/** The changed fields for one provider, or `undefined` when nothing changed. */
export function buildProviderUpdate(draft: ProviderDraft, savedClientId: string | null): ProviderUpdate | undefined {
    const update: ProviderUpdate = {};
    const clientId = draft.clientId.trim();
    if (clientId !== (savedClientId ?? '')) update.clientId = clientId;
    const secret = draft.secret.trim();
    if (secret) update.clientSecret = secret;
    else if (draft.secretCleared) update.clientSecret = '';
    return Object.keys(update).length > 0 ? update : undefined;
}

/** The PUT body: only what changed — the switch, a client id, a typed or removed secret. */
export function buildCalendarSyncUpdate(
    draft: CalendarSyncDraft,
    settings: AdminCalendarSyncSettings,
): UpdateAdminCalendarSyncSettings {
    const body: UpdateAdminCalendarSyncSettings = {};
    if (draft.enabled !== settings.enabled) body.enabled = draft.enabled;
    for (const provider of CALENDAR_SYNC_FORM_PROVIDERS) {
        const update = buildProviderUpdate(draft[provider], settings[provider].clientId);
        if (update) body[provider] = update;
    }
    return body;
}

/**
 * After a successful save whose response did not parse as the settings shape:
 * keep the switch and the typed ids, forget the typed secrets. (A parsed
 * response resets the draft with `draftFromSettings` instead.)
 */
export function settleDraftAfterSave(draft: CalendarSyncDraft): CalendarSyncDraft {
    return {
        enabled: draft.enabled,
        google: providerDraft(draft.google.clientId.trim()),
        microsoft: providerDraft(draft.microsoft.clientId.trim()),
    };
}
