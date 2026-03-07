import type { FeedbackCategory } from '@raid-ledger/contract';

const CATEGORIES: { value: FeedbackCategory; label: string; icon: string }[] = [
    { value: 'bug', label: 'Bug', icon: '\uD83D\uDC1B' },
    { value: 'feature', label: 'Feature', icon: '\u2728' },
    { value: 'improvement', label: 'Improvement', icon: '\uD83D\uDCA1' },
    { value: 'other', label: 'Other', icon: '\uD83D\uDCAC' },
];

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

function DialogHeader({ onClose }: { onClose: () => void }) {
    return (
        <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-foreground)' }}>Send Feedback</h2>
            <button onClick={onClose} className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-colors hover:bg-[var(--color-overlay)]" style={{ color: 'var(--color-muted)' }} aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
            </button>
        </div>
    );
}

export function FeedbackDialog({
    showSuccess, category, message, includeClientLogs, isSubmitting,
    sentryError, submitError, isError, onCategoryChange, onMessageChange,
    onIncludeLogsChange, onSubmit, onClose,
}: FeedbackDialogProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative w-full max-w-md rounded-2xl p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
                <DialogHeader onClose={onClose} />
                {showSuccess ? <SuccessState /> : (
                    <FeedbackForm category={category} message={message} includeClientLogs={includeClientLogs}
                        isSubmitting={isSubmitting} sentryError={sentryError} submitError={submitError}
                        isError={isError} onCategoryChange={onCategoryChange} onMessageChange={onMessageChange}
                        onIncludeLogsChange={onIncludeLogsChange} onSubmit={onSubmit} />
                )}
            </div>
        </div>
    );
}

function SuccessState() {
    return (
        <div className="flex flex-col items-center gap-3 py-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8" style={{ color: 'var(--color-accent)' }}>
                    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                </svg>
            </div>
            <p className="text-base font-medium" style={{ color: 'var(--color-foreground)' }}>Thanks for your feedback!</p>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Your feedback has been recorded and sent to the maintainers.</p>
        </div>
    );
}

function CategoryPicker({ category, onChange }: { category: FeedbackCategory; onChange: (c: FeedbackCategory) => void }) {
    return (
        <div className="mb-4">
            <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--color-foreground)' }}>Category</label>
            <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                    <button key={cat.value} onClick={() => onChange(cat.value)}
                        className={`rounded-full px-3 py-2.5 text-sm font-medium transition-colors ${category === cat.value
                            ? 'bg-emerald-600 text-white border border-emerald-600 shadow-[0_0_0_2px_rgba(5,150,105,0.3)]'
                            : 'bg-overlay text-foreground border border-edge'}`}>
                        <span className="mr-1">{cat.icon}</span>{cat.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function MessageInput({ message, onChange }: { message: string; onChange: (m: string) => void }) {
    return (
        <div className="mb-4">
            <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--color-foreground)' }}>Message</label>
            <textarea value={message} onChange={(e) => onChange(e.target.value)} placeholder="Tell us what's on your mind..." rows={4} maxLength={MAX_LENGTH}
                className="w-full resize-none rounded-lg p-3 text-sm outline-none transition-colors placeholder:text-[var(--color-muted)]"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-foreground)' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
            />
            <div className="mt-1 flex justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
                <span>{message.length < MIN_LENGTH ? `${MIN_LENGTH - message.length} more characters needed` : '\u00A0'}</span>
                <span>{message.length}/{MAX_LENGTH}</span>
            </div>
        </div>
    );
}

function FeedbackForm({
    category, message, includeClientLogs, isSubmitting, sentryError, submitError, isError,
    onCategoryChange, onMessageChange, onIncludeLogsChange, onSubmit,
}: Omit<FeedbackDialogProps, 'showSuccess' | 'onClose'>) {
    return (
        <>
            <CategoryPicker category={category} onChange={onCategoryChange} />
            <MessageInput message={message} onChange={onMessageChange} />
            {category === 'bug' && (
                <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm" style={{ color: 'var(--color-muted)' }}>
                    <input type="checkbox" checked={includeClientLogs} onChange={(e) => onIncludeLogsChange(e.target.checked)} className="h-4 w-4 rounded accent-[var(--color-accent)]" />
                    Capture and send client logs
                </label>
            )}
            <p className="mb-4 flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>Feedback is tracked via Sentry error monitoring.</p>
            {(isError || sentryError) && (
                <p className="mb-3 text-sm" style={{ color: 'var(--color-danger, #ef4444)' }}>
                    {sentryError ? 'Feedback saved locally but failed to notify maintainers. Check Sentry configuration.' : submitError?.message || 'Something went wrong. Please try again.'}
                </p>
            )}
            <button onClick={onSubmit} disabled={message.length < MIN_LENGTH || isSubmitting}
                className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)' }}>
                {isSubmitting ? 'Sending...' : 'Send Feedback'}
            </button>
        </>
    );
}
