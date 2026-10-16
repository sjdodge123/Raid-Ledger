/**
 * Button classes (ROK-1646), split out of `button.tsx` so a real `<a>` that
 * must look like a button — a `webcal:` / external-scheme hand-off a router
 * `<Link>` can't express (ROK-1599) — can share them; react-refresh forbids a
 * component file exporting plain functions. See `button.tsx` for the contract.
 */
import { DISABLED, FOCUS_RING } from './form-classes';

export type ButtonVariant =
    | 'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructive-soft' | 'warning-soft' | 'success-soft'
    | 'bare';
export type ButtonSize = 'md' | 'sm' | 'lg';

const VARIANT_CLS: Record<Exclude<ButtonVariant, 'bare'>, string> = {
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-foreground',
    secondary: 'bg-panel border border-edge text-foreground hover:bg-overlay',
    ghost: 'text-muted hover:text-foreground hover:bg-overlay',
    destructive: 'bg-red-600 hover:bg-red-500 text-foreground',
    'destructive-soft': 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
    'warning-soft': 'bg-warning/10 text-warning border border-warning/30 hover:bg-warning/20',
    'success-soft': 'bg-success/10 text-success border border-success/30 hover:bg-success/20',
};

/** A brand fill replaces the variant paint; index.css colours the label via `data-brand-label`. */
const BRAND_CLS = 'text-foreground hover:brightness-110';

const SIZE_CLS: Record<ButtonSize, string> = {
    md: 'min-h-[44px] px-4 py-2',
    lg: 'min-h-[44px] px-4 py-3',
    sm: 'min-h-[44px] lg:min-h-9 px-3 py-1.5',
};

const BASE_CLS =
    'relative inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ' +
    `${FOCUS_RING} focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${DISABLED}`;

/** `bare`: no padding, min size, radius, fill or border — only layout, the focus ring and disabled. */
const BARE_BASE_CLS = `relative inline-flex items-center justify-center ${FOCUS_RING} ${DISABLED}`;

export interface ButtonClassInputs {
    variant?: ButtonVariant | undefined;
    size?: ButtonSize | undefined;
    fullWidth?: boolean | undefined;
    iconOnly?: boolean | undefined;
    className?: string | undefined;
    brandColor?: string | undefined;
}

/** The button's classes, for an `<a>` that must look like a `Button` (see header). */
export function buttonClass(p: ButtonClassInputs): string {
    if (p.variant === 'bare') {
        return [BARE_BASE_CLS, p.fullWidth ? 'w-full' : '', p.className ?? ''].filter(Boolean).join(' ');
    }
    return [
        BASE_CLS,
        p.brandColor ? BRAND_CLS : VARIANT_CLS[p.variant ?? 'primary'],
        SIZE_CLS[p.size ?? 'md'],
        p.iconOnly ? 'min-w-[44px]' : '',
        p.fullWidth ? 'w-full' : '',
        p.className ?? '',
    ].filter(Boolean).join(' ');
}
