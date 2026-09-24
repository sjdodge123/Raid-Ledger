import { XMarkIcon } from '@heroicons/react/24/outline';
import type { TemplateConfigDto } from '@raid-ledger/contract';
import { DurationSection } from './shared/duration-section';
import type { FormState, FormErrors } from './create-event-form.types';
import { RECURRENCE_OPTIONS } from './create-event-form.types';
import { formatDuration } from './create-event-form.utils';
import { EphemeralVoiceToggle } from './ephemeral-voice-toggle';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

type UpdateField = <K extends keyof FormState>(field: K, value: FormState[K]) => void;

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">{title}</h3>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

export function TemplatesBar({ templates, onLoad, onDelete }: { templates: Array<{ id: number; name: string; config: TemplateConfigDto }>; onLoad: (c: TemplateConfigDto) => void; onDelete: (id: number) => void }) {
    if (templates.length === 0) return null;
    return (
        <div className="flex items-center gap-3 -mb-2">
            <span className="text-xs text-muted shrink-0">Load template:</span>
            <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                    <div key={t.id} className="flex items-center gap-1">
                        <Button variant="secondary" size="sm" onClick={() => onLoad(t.config)}>{t.name}</Button>
                        <Button variant="ghost" size="sm" iconOnly aria-label={`Delete template ${t.name}`} onClick={() => onDelete(t.id)}>
                            <XMarkIcon className="w-3 h-3" />
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function DateTimeInputs({ form, errors, updateField }: { form: FormState; errors: FormErrors; updateField: UpdateField }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field id="startDate" label="Date" required error={errors.startDate}>
                <Input type="date" fieldSize="lg" required value={form.startDate} onChange={(e) => updateField('startDate', e.target.value)} />
            </Field>
            <Field id="startTime" label="Start Time" required error={errors.startTime}>
                <Input type="time" fieldSize="lg" required value={form.startTime} onChange={(e) => updateField('startTime', e.target.value)} />
            </Field>
        </div>
    );
}

function EndTimePreview({ endTimePreview, tzAbbr, durationMinutes }: { endTimePreview: string; tzAbbr: string; durationMinutes: number }) {
    return (
        <div className="flex items-center gap-2 text-sm text-muted bg-panel/50 border border-edge-subtle rounded-lg px-4 py-2.5">
            <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>Ends at <span className="text-success font-medium">{endTimePreview} {tzAbbr}</span> ({formatDuration(durationMinutes)})</span>
        </div>
    );
}

function RecurrenceCount({ count }: { count: number }) {
    return <>Creates <span className="text-success font-medium">{count}</span> event{count !== 1 ? 's' : ''}</>;
}

function RecurrenceFields({ form, errors, recurrenceCount, updateField, setErrors }: {
    form: FormState; errors: FormErrors; recurrenceCount: number; updateField: UpdateField;
    setErrors: React.Dispatch<React.SetStateAction<FormErrors>>;
}) {
    const onUntilChange = (value: string) => {
        updateField('recurrenceUntil', value);
        setErrors((prev) => ({ ...prev, recurrenceUntil: undefined }));
    };
    return (
        <>
            <Field id="recurrence" label="Repeat">
                <Select fieldSize="lg" value={form.recurrenceFrequency} onChange={(e) => updateField('recurrenceFrequency', e.target.value as FormState['recurrenceFrequency'])}>
                    {RECURRENCE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </Select>
            </Field>
            {form.recurrenceFrequency && (
                <Field id="recurrenceUntil" label="Repeat Until" required error={errors.recurrenceUntil}
                    hint={recurrenceCount > 0 ? <RecurrenceCount count={recurrenceCount} /> : undefined}>
                    <Input type="date" fieldSize="lg" required value={form.recurrenceUntil} min={form.startDate || undefined} onChange={(e) => onUntilChange(e.target.value)} />
                </Field>
            )}
        </>
    );
}

export function WhenSection({ form, errors, isEditMode, tzAbbr, endTimePreview, recurrenceCount, updateField, setErrors }: {
    form: FormState; errors: FormErrors; isEditMode: boolean; tzAbbr: string;
    endTimePreview: string | null; recurrenceCount: number; updateField: UpdateField;
    setErrors: React.Dispatch<React.SetStateAction<FormErrors>>;
}) {
    return (
        <FormSection title="When">
            <p className="text-xs text-muted -mt-2">Times in {tzAbbr}</p>
            <DateTimeInputs form={form} errors={errors} updateField={updateField} />
            <DurationSection durationMinutes={form.durationMinutes} customDuration={form.customDuration} durationError={errors.duration} onDurationMinutesChange={(v) => updateField('durationMinutes', v)} onCustomDurationChange={(v) => updateField('customDuration', v)} onDurationErrorClear={() => setErrors((prev) => ({ ...prev, duration: undefined }))} />
            {endTimePreview && <EndTimePreview endTimePreview={endTimePreview} tzAbbr={tzAbbr} durationMinutes={form.durationMinutes} />}
            {!isEditMode && <RecurrenceFields form={form} errors={errors} recurrenceCount={recurrenceCount} updateField={updateField} setErrors={setErrors} />}
            <EphemeralVoiceToggle value={form.ephemeralVoiceEnabled} onChange={(v) => updateField('ephemeralVoiceEnabled', v)} privateValue={form.privateVoice} onPrivateChange={(v) => updateField('privateVoice', v)} />
        </FormSection>
    );
}

export function SaveTemplateBar({ show, name, isPending, onNameChange, onSave, onClose }: { show: boolean; name: string; isPending: boolean; onNameChange: (v: string) => void; onSave: () => void; onClose: () => void }) {
    if (!show) return null;
    return (
        <div className="flex items-center gap-3 bg-panel/50 border border-edge-subtle rounded-lg px-4 py-3">
            <Field label="Template name" hideLabel className="flex-1">
                <Input type="text" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Template name..." maxLength={100} />
            </Field>
            <Button onClick={onSave} disabled={!name.trim()} loading={isPending} loadingLabel="Saving...">Save</Button>
            <Button variant="ghost" iconOnly aria-label="Close template name" onClick={onClose}>
                <XMarkIcon className="w-4 h-4" />
            </Button>
        </div>
    );
}

export function FormFooter({ isEditMode, isPending, onShowSaveTemplate, onCancel }: { isEditMode: boolean; isPending: boolean; onShowSaveTemplate: () => void; onCancel: () => void }) {
    return (
        <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" onClick={onShowSaveTemplate}>Save as Template</Button>
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="lg" onClick={onCancel}>Cancel</Button>
                <Button type="submit" size="lg" loading={isPending} loadingLabel={isEditMode ? 'Saving...' : 'Creating...'}>
                    {isEditMode ? 'Save Changes' : 'Create Event'}
                </Button>
            </div>
        </div>
    );
}
