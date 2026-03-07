import type { JSX } from 'react';
import { useState } from 'react';

const INPUT_CLASS = 'w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all';

/** Password visibility toggle button */
function PasswordToggle({ showPassword, onToggle }: {
    showPassword: boolean; onToggle: () => void;
}): JSX.Element {
    return (
        <button type="button" onClick={onToggle}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors p-1"
            tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
            {showPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
            ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
            )}
        </button>
    );
}

/** Username input field */
function UsernameField({ value, onChange }: {
    value: string; onChange: (v: string) => void;
}): JSX.Element {
    return (
        <div>
            <label htmlFor="username" className="block text-sm font-medium text-secondary mb-1.5">Username</label>
            <input id="username" type="text" value={value} onChange={(e) => onChange(e.target.value)}
                className={INPUT_CLASS} placeholder="admin" required />
        </div>
    );
}

/** Password input field with visibility toggle */
function PasswordField({ value, onChange }: {
    value: string; onChange: (v: string) => void;
}): JSX.Element {
    const [showPassword, setShowPassword] = useState(false);
    return (
        <div>
            <label htmlFor="password" className="block text-sm font-medium text-secondary mb-1.5">Password</label>
            <div className="relative">
                <input id="password" type={showPassword ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
                    className={`${INPUT_CLASS} pr-12`} placeholder="--------" required />
                <PasswordToggle showPassword={showPassword} onToggle={() => setShowPassword(!showPassword)} />
            </div>
        </div>
    );
}

interface LocalLoginFormProps {
    onSubmit: (username: string, password: string) => Promise<void>;
    isLoading: boolean;
    error: string | null;
}

/** Local username/password login form */
export function LocalLoginForm({ onSubmit, isLoading, error }: LocalLoginFormProps): JSX.Element {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        onSubmit(username, password);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <UsernameField value={username} onChange={setUsername} />
            <PasswordField value={password} onChange={setPassword} />
            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            )}
            <SubmitButton isLoading={isLoading} />
        </form>
    );
}

/** Submit button with loading spinner */
function SubmitButton({ isLoading }: { isLoading: boolean }): JSX.Element {
    return (
        <button type="submit" disabled={isLoading}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900">
            {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
                    Signing in...
                </span>
            ) : 'Sign In'}
        </button>
    );
}
