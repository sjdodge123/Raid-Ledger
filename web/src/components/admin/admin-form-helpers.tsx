import { toast } from '../../lib/toast';

export const EyeOffIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
);

export const EyeIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
);

export const CopyIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

export function PasswordInput({ id, value, onChange, placeholder, showPassword, onToggleShow, ringColor = 'focus:ring-emerald-500', fieldLabel = 'password' }: {
    id: string; value: string; onChange: (v: string) => void; placeholder: string;
    showPassword: boolean; onToggleShow: () => void; ringColor?: string; fieldLabel?: string;
}) {
    return (
        <div className="relative">
            <input id={id} type={showPassword ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={`w-full px-4 py-3 pr-12 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 ${ringColor} focus:border-transparent transition-all`} />
            <button type="button" onClick={onToggleShow} aria-label={showPassword ? `Hide ${fieldLabel}` : `Show ${fieldLabel}`}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors">
                {showPassword ? EyeOffIcon : EyeIcon}
            </button>
        </div>
    );
}

export function TestResultBanner({ result }: { result: { success: boolean; message: string } | null }) {
    if (!result) return null;
    return (
        <div className={`p-3 rounded-lg animate-[fadeIn_0.3s_ease-in] ${result.success
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
            {result.message}
        </div>
    );
}

export function CopyableInput({ value, onCopied }: { value: string; onCopied: string }) {
    return (
        <div className="relative cursor-pointer group" onClick={async () => {
            try { await navigator.clipboard.writeText(value); toast.success(onCopied); }
            catch { toast.error('Failed to copy'); }
        }}>
            <input type="text" value={value} readOnly
                className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground cursor-pointer select-all focus:outline-none group-hover:border-dim transition-all text-sm" />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted group-hover:text-foreground transition-colors">{CopyIcon}</div>
        </div>
    );
}

export function FormTextField({ id, label, value, onChange, placeholder, ringColor = 'focus:ring-emerald-500' }: {
    id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string; ringColor?: string;
}) {
    return (
        <div>
            <label htmlFor={id} className="block text-sm font-medium text-secondary mb-1.5">{label}</label>
            <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
                className={`w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 ${ringColor} focus:border-transparent transition-all`} />
        </div>
    );
}
