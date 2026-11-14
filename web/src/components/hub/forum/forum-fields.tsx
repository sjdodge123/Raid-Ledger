/**
 * ROK-1175 — the forum's form fields: the title (`Field` + `Input` +
 * `CharCounter`, 1..120 trimmed) and the markdown body (`Field` +
 * `LazyMarkdownEditor`, the Posts body rules, 4000). Errors come from the
 * contract schemas so the UI and the api say the same thing.
 */
import { useId, type JSX } from 'react';
import { HUB_FORUM_TITLE_MAX, HUB_POST_BODY_MAX, HubForumTitleInputSchema } from '@raid-ledger/contract';
import { CharCounter } from '../../ui/char-counter';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { LazyMarkdownEditor } from '../../ui/markdown/lazy-markdown-editor';

/** The title's inline error; an empty title only disables submit (no error). */
export function forumTitleError(title: string): string | null {
    if (title.trim() === '') return null;
    const parsed = HubForumTitleInputSchema.safeParse(title);
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? `Keep the title to ${HUB_FORUM_TITLE_MAX} characters`);
}

export interface TitleFieldProps { value: string; onChange: (v: string) => void; error?: string | undefined }

/** "Title" with its 120-character counter. */
export function ForumTitleField({ value, onChange, error }: TitleFieldProps): JSX.Element {
    const counterId = useId();
    return (
        <Field label="Title" error={error}>
            <Input value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={counterId} data-testid="forum-title-input" autoFocus />
            <div className="mt-1 flex justify-end">
                <CharCounter id={counterId} length={value.length} max={HUB_FORUM_TITLE_MAX} testId="forum-title-count" />
            </div>
        </Field>
    );
}

export interface BodyFieldProps {
    label: string;
    value: string;
    onChange: (v: string) => void;
    error?: string | undefined;
    hideLabel?: boolean;
    testId: string;
    autoFocus?: boolean;
}

/** The markdown body (§4.26), counter included by the editor. */
export function ForumBodyField({ label, value, onChange, error, hideLabel = false, testId, autoFocus = false }: BodyFieldProps): JSX.Element {
    return (
        <Field label={label} hideLabel={hideLabel} error={error}>
            <LazyMarkdownEditor value={value} onChange={onChange} maxLength={HUB_POST_BODY_MAX} testId={testId} autoFocus={autoFocus} />
        </Field>
    );
}
