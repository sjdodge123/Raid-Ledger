/**
 * FilePicker — the one file-upload trigger (ROK-1655 PR-1, forms plan ruling 1:
 * a primitive, not a guard exemption for raw `<input type="file">`).
 *
 * - The visible control is the shared `Button` (default `secondary`), named by
 *   `children`. Clicking it calls the hidden input's `click()` to open the OS
 *   picker; loading/disabled/variant/size are the Button's own contract.
 * - A native `<input type="file" class="hidden" tabIndex={-1}>` stays in the
 *   DOM: it is what the browser opens, and what tests drive with
 *   `userEvent.upload(container.querySelector('input[type=file]'), file)`.
 *   `inputProps` passes extra attributes (e.g. `data-testid`) through to it.
 * - `onFiles` receives a plain `File[]` (never an empty one). The input's value
 *   is reset after every change, so picking the same file again fires again.
 * - While `loading` or `disabled` the trigger does not open the input and the
 *   input itself is disabled.
 * - The forwarded ref is the native input, so a drop zone around the picker can
 *   open the same dialog (`ref.current.click()`) instead of rendering its own.
 */
import {
    forwardRef, useImperativeHandle, useRef,
    type ChangeEvent, type InputHTMLAttributes, type ReactNode,
} from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './button';

type OwnedInputAttr = 'type' | 'accept' | 'multiple' | 'onChange' | 'disabled' | 'className' | 'tabIndex';

export interface FilePickerProps {
    /** The trigger's visible label — also its accessible name. */
    children: ReactNode;
    /** Forwarded to the native input, e.g. `"image/png,image/jpeg"`. */
    accept?: string;
    multiple?: boolean;
    /** Called with the picked files; never called with an empty list. */
    onFiles: (files: File[]) => void;
    loading?: boolean;
    /** Accessible name while `loading` (e.g. "Uploading…"). */
    loadingLabel?: string;
    disabled?: boolean;
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    /** Classes for the trigger Button (layout only — width, margins). */
    className?: string;
    /** Extra attributes for the hidden native input (e.g. `data-testid`, `name`). */
    inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, OwnedInputAttr> & { 'data-testid'?: string };
}

/** A Button that opens a hidden native file input. See the file header. */
export const FilePicker = forwardRef<HTMLInputElement, FilePickerProps>(function FilePicker(props, ref) {
    const { children, accept, multiple, onFiles, loading = false, loadingLabel, disabled = false,
        variant = 'secondary', size, fullWidth, className, inputProps } = props;
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);
    const closed = loading || disabled;

    const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (files.length > 0) onFiles(files);
    };

    return (
        <>
            <Button variant={variant} size={size} loading={loading} loadingLabel={loadingLabel}
                disabled={disabled} fullWidth={fullWidth} className={className}
                onClick={() => { if (!closed) inputRef.current?.click(); }}>
                {children}
            </Button>
            <input {...inputProps} ref={inputRef} type="file" accept={accept} multiple={multiple}
                disabled={closed} tabIndex={-1} className="hidden" onChange={handleChange} />
        </>
    );
});
