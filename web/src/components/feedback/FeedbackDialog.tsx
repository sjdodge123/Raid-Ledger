/**
 * FeedbackDialog — the "Send Feedback" form (ROK-1651 AC3). `Modal` supplies
 * the focus trap, Escape, role=dialog and ×; the controls are the shared
 * form primitives, and a submit failure is shown inline (operator ruling:
 * errors are never toast-only). No dirty-close guard: not a ROK-1655 form.
 */
import type { FeedbackCategory } from '@raid-ledger/contract';
import type { JSX } from 'react';
import { Modal } from '../ui/modal';
import { RadioGroup, type RadioOption } from '../ui/radio-group';
import { Field } from '../ui/field';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { Button } from '../ui/button';
import { useMediaQuery } from '../../hooks/use-media-query';

/** Text-only labels (ROK-1651 ruling 15: the emoji is dropped). */
const CATEGORIES: readonly RadioOption<FeedbackCategory>[] = [
    { value: 'bug', label: 'Bug' },
    { value: 'feature', label: 'Feature' },
    { value: 'improvement', label: 'Improvement' },
    { value: 'other', label: 'Other' },
];

/**
 * Where the four segments fit. Below sm they do not, even emoji-free: at 16px
 * text they need ~327px and a 375px phone's dialog leaves ~287px, so the row
 * scrolled sideways. Phones get the stacked list; the sm+ dialog (max-w-md)
 * has room for the segmented row.
 */
const SEGMENTS_FIT = '(min-width: 640px)';

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

interface FeedbackDialogProps {
    showSuccess: boolean;
    category: FeedbackCategory;
    message: string;
    includeClientLogs: boolean;
    isSubmitting: boolean;
    sentryError: boolean;
    submitError: Error | null;
    isError: boolean;
    onCategoryChange: (cat: FeedbackCategory) => void;
    onMessageChange: (msg: string) => void;
    onIncludeLogsChange: (include: boolean) => void;
    onSubmit: () => void;
    onClose: () => void;
}

export function FeedbackDialog({
    showSuccess, category, message, includeClientLogs, isSubmitting,
    sentryError, submitError, isError, onCategoryChange, onMessageChange,
    onIncludeLogsChange, onSubmit, onClose,
}: FeedbackDialogProps): JSX.Element {
    const footer = !showSuccess && (
        <Button fullWidth loading={isSubmitting} loadingLabel="Sending…" disabled={message.length < MIN_LENGTH} onClick={onSubmit}>
            Send Feedback
        </Button>
    );
    return (
        <Modal isOpen onClose={onClose} title="Send Feedback" footer={footer}>
            {showSuccess ? <SuccessState /> : (
                <FeedbackForm category={category} message={message} includeClientLogs={includeClientLogs}
                    sentryError={sentryError} submitError={submitError} isError={isError}
                    onCategoryChange={onCategoryChange} onMessageChange={onMessageChange}
                    onIncludeLogsChange={onIncludeLogsChange} />
            )}
        </Modal>
    );
}

function SuccessState(): JSX.Element {
    return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-8 w-8 text-success">
                    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                </svg>
            </div>
            <p className="text-base font-medium text-foreground">Thanks for your feedback!</p>
            <p className="text-sm text-muted">Your feedback has been recorded and sent to the maintainers.</p>
        </div>
    );
}

function MessageField({ message, onChange }: { message: string; onChange: (m: string) => void }): JSX.Element {
    const left = MIN_LENGTH - message.length;
    return (
        <Field label="Message" hint={left > 0 ? `${left} more characters needed` : undefined}>
            <Textarea value={message} onChange={(e) => onChange(e.target.value)} placeholder="Tell us what's on your mind..."
                rows={4} resize="none" showCount maxLength={MAX_LENGTH} />
        </Field>
    );
}

function errorText(sentryError: boolean, submitError: Error | null): string {
    if (sentryError) return 'Feedback saved locally but failed to notify maintainers. Check Sentry configuration.';
    return submitError?.message || 'Something went wrong. Please try again.';
}

type FormProps = Omit<FeedbackDialogProps, 'showSuccess' | 'onClose' | 'onSubmit' | 'isSubmitting'>;

function FeedbackForm({
    category, message, includeClientLogs, sentryError, submitError, isError,
    onCategoryChange, onMessageChange, onIncludeLogsChange,
}: FormProps): JSX.Element {
    const segmented = useMediaQuery(SEGMENTS_FIT);
    return (
        <div className="flex flex-col gap-4">
            <RadioGroup<FeedbackCategory> label="Category" appearance={segmented ? 'segmented' : 'list'} options={CATEGORIES}
                value={category} onChange={onCategoryChange} />
            <MessageField message={message} onChange={onMessageChange} />
            {category === 'bug' && (
                <Checkbox label="Capture and send client logs" checked={includeClientLogs}
                    onChange={(e) => onIncludeLogsChange(e.target.checked)} />
            )}
            <p className="text-xs text-muted">Feedback is tracked via Sentry error monitoring.</p>
            {(isError || sentryError) && (
                <p role="alert" className="text-sm text-danger">{errorText(sentryError, submitError)}</p>
            )}
        </div>
    );
}
