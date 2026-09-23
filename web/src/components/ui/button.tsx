/**
 * Button — the one button API (ROK-1646, spike ROK-1644 §4.1, operator Q2/Q3).
 *
 * - Five variants. The solid fills (`bg-emerald-600`, `bg-red-600`) stay raw
 *   on purpose: `index.css` forces their label white on the light schemes by
 *   those exact class names (design-system.md §2.2).
 * - `type` defaults to "button", so a button inside a `<form>` never submits it
 *   by accident.
 * - `loading` sets `aria-busy` + `aria-disabled` — NOT native `disabled`, so a
 *   focused button keeps focus — and swallows clicks (a double click fires
 *   `onClick` once; a loading submit button never submits). It hides the label with `invisible`
 *   (so the width never collapses) and overlays a small inline spinner. The
 *   full-page `LoadingSpinner` is a route fallback and is the wrong size here.
 * - Icon-only buttons must carry an `aria-label` — the type rejects one without.
 * - Link-styled actions stay `<Link>`; this is not a link.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { DISABLED, FOCUS_RING } from './form-classes';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructive-soft';
export type ButtonSize = 'md' | 'sm' | 'lg';

const VARIANT_CLS: Record<ButtonVariant, string> = {
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-foreground',
    secondary: 'bg-panel border border-edge text-foreground hover:bg-overlay',
    ghost: 'text-muted hover:text-foreground hover:bg-overlay',
    destructive: 'bg-red-600 hover:bg-red-500 text-foreground',
    'destructive-soft': 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
};

const SIZE_CLS: Record<ButtonSize, string> = {
    md: 'min-h-[44px] px-4 py-2',
    lg: 'min-h-[44px] px-4 py-3',
    sm: 'min-h-[44px] lg:min-h-9 px-3 py-1.5',
};

const BASE_CLS =
    'relative inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ' +
    `${FOCUS_RING} focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${DISABLED}`;

interface ButtonBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    /** Accessible name while `loading` (e.g. "Saving…"). Defaults to the label. */
    loadingLabel?: string;
    fullWidth?: boolean;
}

/** A labelled button, or an icon-only one that MUST be named by `aria-label`. */
export type ButtonProps =
    | (ButtonBaseProps & { iconOnly?: false; 'aria-label'?: string })
    | (ButtonBaseProps & { iconOnly: true; 'aria-label': string });

/** Private inline spinner — inherits the label colour. */
function InlineSpinner(): ReactNode {
    return (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center" data-testid="button-spinner">
            <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
        </span>
    );
}

function buttonClass(p: Pick<ButtonProps, 'variant' | 'size' | 'fullWidth' | 'iconOnly' | 'className'>): string {
    return [
        BASE_CLS,
        VARIANT_CLS[p.variant ?? 'primary'],
        SIZE_CLS[p.size ?? 'md'],
        p.iconOnly ? 'min-w-[44px]' : '',
        p.fullWidth ? 'w-full' : '',
        p.className ?? '',
    ].filter(Boolean).join(' ');
}

/** The shared button. See the file header for the contract. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
    const { variant, size, loading = false, loadingLabel, fullWidth, iconOnly, className,
        type = 'button', disabled, children, onClick, ...rest } = props;
    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled}
            aria-busy={loading || undefined}
            aria-disabled={loading || undefined}
            className={buttonClass({ variant, size, fullWidth, iconOnly, className })}
            {...rest}
            onClick={(e) => { if (loading) e.preventDefault(); else onClick?.(e); }}
        >
            <span data-button-label aria-hidden={loading || undefined} className={`inline-flex items-center gap-2 ${loading ? 'invisible' : ''}`}>
                {children}
            </span>
            {loading && <span className="sr-only">{loadingLabel ?? children}</span>}
            {loading && <InlineSpinner />}
        </button>
    );
});
