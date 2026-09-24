import type { JSX } from 'react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { PasswordInput } from '../../components/ui/password-input';

interface LocalLoginFormProps {
    onSubmit: (username: string, password: string) => Promise<void>;
    isLoading: boolean;
    error: string | null;
}

/**
 * Local username/password login form (ROK-1648: on the form primitives).
 * The `username` / `password` Field ids and the "Sign In" name are what the
 * auth smoke (auth.smoke.spec.ts, helpers.ts) selects on — keep them.
 */
export function LocalLoginForm({ onSubmit, isLoading, error }: LocalLoginFormProps): JSX.Element {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        onSubmit(username, password);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <Field id="username" label="Username">
                <Input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" required />
            </Field>
            <Field id="password" label="Password">
                <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="--------" required />
            </Field>
            {error && (
                <div className="p-3 bg-danger/10 border border-danger/20 rounded-lg">
                    <p role="alert" className="text-sm text-danger">{error}</p>
                </div>
            )}
            <Button type="submit" size="lg" fullWidth loading={isLoading} loadingLabel="Signing in...">
                Sign In
            </Button>
        </form>
    );
}
