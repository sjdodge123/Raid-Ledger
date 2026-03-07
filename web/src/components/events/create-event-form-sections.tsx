import type { TemplateConfigDto } from '@raid-ledger/contract';
import { DurationSection } from './shared/duration-section';
import type { FormState, FormErrors } from './create-event-form.types';
import { RECURRENCE_OPTIONS } from './create-event-form.types';
import { formatDuration } from './create-event-form.utils';

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
                        <button type="button" onClick={() => onLoad(t.config)} className="px-3 py-1 rounded-md bg-panel border border-edge text-xs text-secondary hover:text-foreground hover:border-emerald-500 transition-colors">{t.name}</button>
                        <button type="button" onClick={() => onDelete(t.id)} className="p-0.5 text-dim hover:text-red-400 transition-colors" title="Delete template">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function DateTimeInputs({ form, errors, updateField }: {
    form: FormState; errors: FormErrors; updateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
}) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                <label htmlFor="startDate" className="block text-sm font-medium text-secondary mb-2">Date <span className="text-red-400">*</span></label>
                <input id="startDate" type="date" value={form.startDate} onChange={(e) => updateField('startDate', e.target.value)} className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.startDate ? 'border-red-500' : 'border-edge'}`} />
                {errors.startDate && <p className="mt-1 text-sm text-red-400">{errors.startDate}</p>}
            </div>
            <div>
                <label htmlFor="startTime" className="block text-sm font-medium text-secondary mb-2">Start Time <span className="text-red-400">*</span></label>
                <input id="startTime" type="time" value={form.startTime} onChange={(e) => updateField('startTime', e.target.value)} className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.startTime ? 'border-red-500' : 'border-edge'}`} />
                {errors.startTime && <p className="mt-1 text-sm text-red-400">{errors.startTime}</p>}
            </div>
        </div>
    );
}

function EndTimePreview({ endTimePreview, tzAbbr, durationMinutes }: { endTimePreview: string; tzAbbr: string; durationMinutes: number }) {
    return (
        <div className="flex items-center gap-2 text-sm text-muted bg-panel/50 border border-edge-subtle rounded-lg px-4 py-2.5">
            <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>Ends at <span className="text-emerald-400 font-medium">{endTimePreview} {tzAbbr}</span> ({formatDuration(durationMinutes)})</span>
        </div>
    );
}

function RecurrenceFields({ form, errors, recurrenceCount, updateField, setErrors }: {
    form: FormState; errors: FormErrors; recurrenceCount: number;
    updateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
    setErrors: React.Dispatch<React.SetStateAction<FormErrors>>;
}) {
    return (
        <>
            <div>
                <label htmlFor="recurrence" className="block text-sm font-medium text-secondary mb-2">Repeat</label>
                <select id="recurrence" value={form.recurrenceFrequency} onChange={(e) => updateField('recurrenceFrequency', e.target.value as FormState['recurrenceFrequency'])} className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors">
                    {RECURRENCE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
            </div>
            {form.recurrenceFrequency && (
                <div>
                    <label htmlFor="recurrenceUntil" className="block text-sm font-medium text-secondary mb-2">Repeat Until <span className="text-red-400">*</span></label>
                    <input id="recurrenceUntil" type="date" value={form.recurrenceUntil} min={form.startDate || undefined} onChange={(e) => { updateField('recurrenceUntil', e.target.value); setErrors((prev) => ({ ...prev, recurrenceUntil: undefined })); }} className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.recurrenceUntil ? 'border-red-500' : 'border-edge'}`} />
                    {errors.recurrenceUntil && <p className="mt-1 text-sm text-red-400">{errors.recurrenceUntil}</p>}
                    {recurrenceCount > 0 && <p className="mt-1 text-sm text-muted">Creates <span className="text-emerald-400 font-medium">{recurrenceCount}</span> event{recurrenceCount !== 1 ? 's' : ''}</p>}
                </div>
            )}
        </>
    );
}

export function WhenSection({ form, errors, isEditMode, tzAbbr, endTimePreview, recurrenceCount, updateField, setErrors }: {
    form: FormState; errors: FormErrors; isEditMode: boolean; tzAbbr: string;
    endTimePreview: string | null; recurrenceCount: number;
    updateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
    setErrors: React.Dispatch<React.SetStateAction<FormErrors>>;
}) {
    return (
        <FormSection title="When">
            <p className="text-xs text-muted -mt-2">Times in {tzAbbr}</p>
            <DateTimeInputs form={form} errors={errors} updateField={updateField} />
            <DurationSection durationMinutes={form.durationMinutes} customDuration={form.customDuration} durationError={errors.duration} onDurationMinutesChange={(v) => updateField('durationMinutes', v)} onCustomDurationChange={(v) => updateField('customDuration', v)} onDurationErrorClear={() => setErrors((prev) => ({ ...prev, duration: undefined }))} />
            {endTimePreview && <EndTimePreview endTimePreview={endTimePreview} tzAbbr={tzAbbr} durationMinutes={form.durationMinutes} />}
            {!isEditMode && <RecurrenceFields form={form} errors={errors} recurrenceCount={recurrenceCount} updateField={updateField} setErrors={setErrors} />}
        </FormSection>
    );
}

export function SaveTemplateBar({ show, name, isPending, onNameChange, onSave, onClose }: { show: boolean; name: string; isPending: boolean; onNameChange: (v: string) => void; onSave: () => void; onClose: () => void }) {
    if (!show) return null;
    return (
        <div className="flex items-center gap-3 bg-panel/50 border border-edge-subtle rounded-lg px-4 py-3">
            <input type="text" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Template name..." maxLength={100} className="flex-1 px-3 py-2 bg-panel border border-edge rounded-md text-sm text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            <button type="button" onClick={onSave} disabled={!name.trim() || isPending} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-white text-sm font-medium rounded-md transition-colors">{isPending ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={onClose} className="p-2 text-muted hover:text-foreground transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
    );
}

export function FormFooter({ isEditMode, isPending, onShowSaveTemplate, onCancel }: { isEditMode: boolean; isPending: boolean; onShowSaveTemplate: () => void; onCancel: () => void }) {
    return (
        <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={onShowSaveTemplate} className="text-sm text-muted hover:text-secondary transition-colors">Save as Template</button>
            <div className="flex items-center gap-4">
                <button type="button" onClick={onCancel} className="px-6 py-3 text-secondary hover:text-foreground font-medium transition-colors">Cancel</button>
                <button type="submit" disabled={isPending} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-semibold rounded-lg transition-colors">
                    {isPending ? (isEditMode ? 'Saving...' : 'Creating...') : (isEditMode ? 'Save Changes' : 'Create Event')}
                </button>
            </div>
        </div>
    );
}
