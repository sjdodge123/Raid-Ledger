/**
 * ROK-1725 — the "Logs" card on the event detail page: one combat-log report
 * link (Warcraft Logs / foreverlogs.gg). Everyone sees the link once it is set;
 * managers (creator or operator/admin) on a non-cancelled event also get the
 * empty state and Add / Edit / Remove — before, during and after the event,
 * since the topbar Edit button is gone once an event has ended. This card is
 * the link's only writer.
 */
import { useState, type FormEvent, type JSX } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import {
    eventReportUrlProblem,
    normalizeEventReportUrl,
    reportLinkSiteName,
    EVENT_REPORT_URL_MAX,
    type EventResponseDto,
} from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { errorBodyOf } from '../../lib/api/api-error';
import { toast } from '../../lib/toast';
import { useUpdateEventReportLink } from '../../hooks/use-event-report-link';

const ACTION_ROW = 'flex flex-col gap-2 sm:flex-row';

/** Parsed URL, or null when the stored value does not parse. */
function parseUrl(url: string): URL | null {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

/** The link label: the site name, else the URL's host, else the raw value. */
function reportLinkLabel(url: string): string {
    return `View report on ${reportLinkSiteName(url) ?? parseUrl(url)?.host ?? url}`;
}

/** Host + path under the link (query and fragment are not shown). */
function reportLinkDisplay(url: string): string {
    const parsed = parseUrl(url);
    return parsed ? `${parsed.host}${parsed.pathname}` : url;
}

/** The validator's own sentence from a 400 (`errors: ['reportUrl: …']`), else the error message. */
function reportLinkErrorMessage(err: unknown): string {
    const errors = errorBodyOf(err)?.errors;
    const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
    if (typeof first === 'string') return first.replace(/^reportUrl: /, '');
    return err instanceof Error ? err.message : 'Could not save the report link';
}

function ReportLinkView({ url, editable, removing, onEdit, onRemove }: {
    url: string; editable: boolean; removing: boolean; onEdit: () => void; onRemove: () => void;
}): JSX.Element {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex min-w-0 flex-col">
                <a href={url} target="_blank" rel="noopener noreferrer" data-testid="event-report-link"
                    className="inline-flex min-h-[44px] items-center gap-1 self-start text-sm font-medium text-success">
                    {reportLinkLabel(url)}<ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </a>
                <span className="break-all text-xs text-muted">{reportLinkDisplay(url)}</span>
            </div>
            {editable && (
                <div className={ACTION_ROW}>
                    <Button variant="secondary" size="sm" onClick={onEdit}>Edit</Button>
                    <Button variant="destructive-soft" size="sm" onClick={onRemove} loading={removing}>Remove</Button>
                </div>
            )}
        </div>
    );
}

function ReportLinkEmpty({ onAdd }: { onAdd: () => void }): JSX.Element {
    return (
        <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">
                No logs linked yet. Paste a Warcraft Logs or foreverlogs.gg report after the raid.
            </p>
            <Button variant="secondary" size="sm" onClick={onAdd}>Add report link</Button>
        </div>
    );
}

function ReportLinkEditor({ initial, pending, onSave, onCancel }: {
    initial: string; pending: boolean; onSave: (url: string) => Promise<string | null>; onCancel: () => void;
}): JSX.Element {
    const [value, setValue] = useState(initial);
    const [error, setError] = useState<string | null>(null);
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const raw = value.trim();
        const problem = eventReportUrlProblem(raw);
        if (problem !== null) {
            setError(problem);
            return;
        }
        setError(null);
        const serverProblem = await onSave(normalizeEventReportUrl(raw));
        if (serverProblem !== null) setError(serverProblem);
    };
    return (
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
            <Field label="Report link" hint="Warcraft Logs or foreverlogs.gg report URL" {...(error ? { error } : {})}>
                <Input type="url" inputMode="url" fieldSize="md" maxLength={EVENT_REPORT_URL_MAX} value={value}
                    placeholder="https://www.warcraftlogs.com/reports/…" onChange={(e) => setValue(e.target.value)} />
            </Field>
            <div className={ACTION_ROW}>
                <Button type="submit" variant="primary" size="sm" loading={pending}>Save</Button>
                <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            </div>
        </form>
    );
}

function useReportLinkActions(eventId: number) {
    const [editing, setEditing] = useState(false);
    const mutation = useUpdateEventReportLink(eventId);
    const save = async (url: string | null): Promise<string | null> => {
        try {
            await mutation.mutateAsync(url);
            setEditing(false);
            return null;
        } catch (err) {
            return reportLinkErrorMessage(err);
        }
    };
    const remove = async () => {
        const problem = await save(null);
        if (problem !== null) toast.error(problem);
    };
    return { editing, setEditing, save, remove, pending: mutation.isPending, removing: mutation.isPending && mutation.variables === null };
}

export function EventReportLinkCard({ event, canManage, isCancelled }: {
    event: Pick<EventResponseDto, 'id' | 'reportUrl'>; canManage: boolean; isCancelled: boolean;
}): JSX.Element | null {
    const reportUrl = event.reportUrl ?? null;
    const editable = canManage && !isCancelled;
    const actions = useReportLinkActions(event.id);
    if (reportUrl === null && !editable) return null;
    return (
        <section className="bg-surface rounded-xl border border-edge p-4 mb-6" data-testid="event-report-link-card" aria-labelledby="event-report-link-title">
            <h2 id="event-report-link-title" className="mb-3 text-lg font-semibold text-foreground">Logs</h2>
            {editable && actions.editing && (
                <ReportLinkEditor initial={reportUrl ?? ''} pending={actions.pending} onSave={actions.save} onCancel={() => actions.setEditing(false)} />
            )}
            {!(editable && actions.editing) && reportUrl !== null && (
                <ReportLinkView url={reportUrl} editable={editable} removing={actions.removing} onEdit={() => actions.setEditing(true)} onRemove={() => void actions.remove()} />
            )}
            {!(editable && actions.editing) && reportUrl === null && <ReportLinkEmpty onAdd={() => actions.setEditing(true)} />}
        </section>
    );
}
