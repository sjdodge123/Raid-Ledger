/**
 * ROK-1428 (L7) — the Automation, Categories and Thresholds sections of the
 * channel-lifecycle admin page (spec §3.1 items 1–3). Every control saves on
 * its own: switches/selects on change, numbers on blur once in range.
 */
import { useState, type JSX } from 'react';
import type { ChannelLifecycleSettingsDto, DiscordCategorySummaryDto, UpdateChannelLifecycleSettingsDto } from '@raid-ledger/contract';
import { LIFECYCLE_DEFAULTS } from '@raid-ledger/contract';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { parseBounded, type LoadState } from './discord-lifecycle.helpers';

type Save = (patch: UpdateChannelLifecycleSettingsDto) => void;

interface SectionProps { settings: ChannelLifecycleSettingsDto; onSave: Save; error: string | undefined }

const ENABLE_LABEL = 'Create and archive game channels automatically';

/** A labelled switch row with helper text the switch is described by. */
function SwitchRow({ id, title, help, checked, disabled, onChange }: {
    id: string; title: string; help: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void;
}): JSX.Element {
    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p id={id} className="text-sm text-muted mt-1">{help}</p>
            </div>
            <Switch label={title} checked={checked} disabled={disabled} onChange={onChange} aria-describedby={id} />
        </div>
    );
}

/** Helper text under the master switch for the bot / enabled combination. */
function automationHelp(botOnline: boolean, enabled: boolean): string {
    if (botOnline) return 'Games with recent events, polls, plans or lineup votes get a channel; quiet ones are archived.';
    return enabled
        ? 'The Discord bot is offline, so nothing runs until it reconnects. You can still turn this off.'
        : 'Connect the Discord bot to turn this on.';
}

/** Section 1 — the master switch, the bot-offline hint and the pre-save find-or-create note. */
export function AutomationSection({ settings, onSave, botOnline, pending, error }: SectionProps & {
    botOnline: boolean; pending: boolean;
}): JSX.Element {
    // Turning OFF never needs the bot; only turning ON does.
    const disabled = pending || (!settings.enabled && !botOnline);
    const showNote = botOnline && !settings.enabled && settings.archiveCategoryId === null && !error;
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-3" aria-label="Automation">
            <SwitchRow id="lifecycle-enable-help" title={ENABLE_LABEL} help={automationHelp(botOnline, settings.enabled)}
                checked={settings.enabled} disabled={disabled} onChange={(next) => onSave({ enabled: next })} />
            {showNote && (
                <p className="text-sm text-muted" data-testid="lifecycle-archive-note">
                    Raid Ledger will create an ‘Archived’ category if none exists.
                </p>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </section>
    );
}

function CategorySelect({ label, placeholder, value, categories, loading, onPick }: {
    label: string; placeholder: string; value: string | null; categories: DiscordCategorySummaryDto[]; loading: boolean;
    onPick: (id: string | null) => void;
}): JSX.Element {
    return (
        <Field label={label} hint={loading ? 'Loading Discord categories…' : undefined}>
            <Select fieldSize="sm" value={value ?? ''} disabled={loading} onChange={(e) => onPick(e.target.value || null)}>
                <option value="">{placeholder}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
        </Field>
    );
}

/** The categories list failed: say so once, with a retry. */
function CategoriesFailed({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-muted">Couldn’t load the Discord categories.</p>
            <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
        </div>
    );
}

/** Section 2 — Games / Archived category pickers and hide-on-archive. */
export function CategoriesSection({ settings, onSave, error, categories, categoriesState, onRetryCategories }: SectionProps & {
    categories: DiscordCategorySummaryDto[]; categoriesState: LoadState; onRetryCategories: () => void;
}): JSX.Element {
    const loading = categoriesState === 'loading';
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-4" aria-label="Categories">
            <h3 className="text-base font-semibold text-foreground">Categories</h3>
            <div className="grid gap-4 sm:grid-cols-2">
                <CategorySelect label="New game channels go in" placeholder={`${LIFECYCLE_DEFAULTS.gamesCategoryName} (created if missing)`}
                    value={settings.gamesCategoryId} categories={categories} loading={loading} onPick={(id) => onSave({ gamesCategoryId: id })} />
                <CategorySelect label="Archived channels go in" placeholder={`${LIFECYCLE_DEFAULTS.archiveCategoryName} (created if missing)`}
                    value={settings.archiveCategoryId} categories={categories} loading={loading} onPick={(id) => onSave({ archiveCategoryId: id })} />
            </div>
            <SwitchRow id="lifecycle-hide-help" title="Hide archived channels from members"
                help="Archived channels are always read-only; this also hides them." checked={settings.hideOnArchive}
                disabled={false} onChange={(on) => onSave({ hideOnArchive: on })} />
            {categoriesState === 'error' && <CategoriesFailed onRetry={onRetryCategories} />}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </section>
    );
}

/** A number box that validates on blur and saves only an in-range change. */
function BoundedNumber({ label, hint, value, min, max, onCommit }: {
    label: string; hint?: string; value: number; min: number; max: number; onCommit: (n: number) => void;
}): JSX.Element {
    const [error, setError] = useState<string | undefined>(undefined);
    const commit = (raw: string): void => {
        const parsed = parseBounded(raw, min, max);
        if ('error' in parsed) { setError(parsed.error); return; }
        setError(undefined);
        if (parsed.value !== value) onCommit(parsed.value);
    };
    return (
        <Field label={label} hint={hint} error={error}>
            <Input type="number" fieldSize="sm" min={min} max={max} defaultValue={value} onBlur={(e) => commit(e.target.value)} />
        </Field>
    );
}

/**
 * Section 3 — window days, create threshold, max changes per run. Each box is
 * keyed on its saved value + `resetKey` (bumped per failed PATCH), so a
 * refetch or a rejected save puts the saved number back.
 */
export function ThresholdsSection({ settings, onSave, error, resetKey }: SectionProps & { resetKey: number }): JSX.Element {
    const k = (v: number): string => `${v}:${resetKey}`;
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-4" aria-label="Thresholds">
            <h3 className="text-base font-semibold text-foreground">Thresholds</h3>
            <div className="grid gap-4 sm:grid-cols-3">
                <BoundedNumber key={k(settings.recentActivityDays)} label="Archive after N days without activity" value={settings.recentActivityDays} min={7} max={180}
                    onCommit={(n) => onSave({ recentActivityDays: n })} />
                <BoundedNumber key={k(settings.createThreshold)} label="Create a channel after N activities" hint="A single poll never creates a channel"
                    value={settings.createThreshold} min={2} max={10} onCommit={(n) => onSave({ createThreshold: n })} />
                <BoundedNumber key={k(settings.maxChangesPerTick)} label="Max changes per run" value={settings.maxChangesPerTick} min={1} max={25}
                    onCommit={(n) => onSave({ maxChangesPerTick: n })} />
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </section>
    );
}
