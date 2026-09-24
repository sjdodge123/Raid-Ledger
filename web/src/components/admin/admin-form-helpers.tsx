/**
 * Shared field helpers for the admin integration forms (IGDB, ITAD, Steam,
 * Co-Optimus, Discord Bot / OAuth). ROK-1652: thin adapters over the shared ui
 * primitives — no raw form elements, no per-integration ring hues.
 */
import type React from 'react';
import { DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { copyWithToast } from '../../lib/clipboard';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { PasswordInput as UiPasswordInput } from '../ui/password-input';

/** A secret field: the ui PasswordInput at `lg`, reveal state owned by the caller. */
export function PasswordInput({ id, value, onChange, placeholder, showPassword, onToggleShow, fieldLabel = 'password' }: {
    id: string; value: string; onChange: (v: string) => void; placeholder: string;
    showPassword: boolean; onToggleShow: () => void; fieldLabel?: string;
}) {
    return (
        <UiPasswordInput id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
            fieldSize="lg" label={fieldLabel} revealed={showPassword} onRevealedChange={() => onToggleShow()} />
    );
}

export function TestResultBanner({ result }: { result: { success: boolean; message: string } | null }) {
    if (!result) return null;
    return (
        <div className={`p-3 rounded-lg border animate-[fadeIn_0.3s_ease-in] ${result.success
            ? 'bg-success/10 border-success/30 text-success'
            : 'bg-danger/10 border-danger/30 text-danger'}`}>
            {result.message}
        </div>
    );
}

/**
 * A read-only value with a trailing copy Button. Enter on the field and a click
 * on it copy too. `label` names the button "Copy <label>".
 */
export function CopyableInput({ value, onCopied, label }: { value: string; onCopied: string; label?: string }) {
    const copyValue = async (): Promise<void> => {
        await copyWithToast(value, { success: onCopied, error: 'Failed to copy' });
    };
    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'Enter') { e.preventDefault(); copyValue(); }
    };
    const copyButton = (
        <Button variant="ghost" size="sm" iconOnly aria-label={label ? `Copy ${label}` : 'Copy to clipboard'} onClick={copyValue}>
            <DocumentDuplicateIcon className="w-5 h-5" aria-hidden="true" />
        </Button>
    );
    return (
        <Input type="text" value={value} readOnly fieldSize="lg" aria-label={label ?? 'Copyable value'}
            onKeyDown={handleKeyDown} onClick={copyValue}
            className="cursor-pointer select-all" trailing={copyButton} />
    );
}

export function FormTextField({ id, label, value, onChange, placeholder }: {
    id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
    return (
        <Field id={id} label={label}>
            <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} fieldSize="lg" />
        </Field>
    );
}
