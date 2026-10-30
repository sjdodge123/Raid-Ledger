/** "Where's my code?" — per-host instructions on the claim screen (ROK-1701). */
import { useState, type JSX, type ReactNode } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { RadioGroup, type RadioOption } from '../../components/ui/radio-group';

type Host = 'render' | 'railway' | 'fly' | 'logs';

const HOSTS: readonly RadioOption<Host>[] = [
    { value: 'render', label: 'Render' },
    { value: 'railway', label: 'Railway' },
    { value: 'fly', label: 'Fly.io' },
    { value: 'logs', label: 'In the logs' },
];

function CodeBlock({ children }: { children: ReactNode }): JSX.Element {
    return <pre className="mt-2 overflow-x-auto rounded-lg border border-edge bg-panel p-3 font-mono text-sm text-foreground">{children}</pre>;
}

const STEPS_CLS = 'list-decimal space-y-1 pl-5 text-sm text-secondary';

const HOST_BODY: Record<Host, JSX.Element> = {
    render: (
        <ol className={STEPS_CLS}>
            <li>Open your Render dashboard and select the <strong>raid-ledger</strong> service.</li>
            <li>Go to <strong>Environment</strong>.</li>
            <li>Find <code className="font-mono">SETUP_CODE</code>, reveal its value and copy it.</li>
        </ol>
    ),
    railway: (
        <ol className={STEPS_CLS}>
            <li>Open your project and select <strong>raid-ledger</strong>.</li>
            <li>Go to <strong>Variables</strong>.</li>
            <li>Copy the value of <code className="font-mono">SETUP_CODE</code>.</li>
        </ol>
    ),
    fly: (
        <div className="space-y-1 text-sm text-secondary">
            <p>The launch commands printed it when they finished.</p>
            <p>Lost it? Set a new one; the app restarts and that becomes your code:</p>
            <CodeBlock>fly secrets set SETUP_CODE=&lt;a long random value&gt;</CodeBlock>
        </div>
    ),
    logs: (
        <div className="text-sm text-secondary">
            <p>If your host didn't set a code, Raid Ledger made one. Open your host's logs and look for this line:</p>
            <CodeBlock>Setup code: XXXX-XXXX-XXXX-XXXX (open /claim)</CodeBlock>
        </div>
    ),
};

/** The host switch (segmented RadioGroup) and the selected host's steps. */
export function ClaimHostHelp(): JSX.Element {
    const [host, setHost] = useState<Host>('render');
    return (
        <section className="flex flex-col gap-3 border-t border-edge pt-5" aria-labelledby="claim-host-help">
            <h2 id="claim-host-help" className="text-base font-semibold text-foreground">Where's my code?</h2>
            <RadioGroup label="Your host" appearance="segmented" options={HOSTS} value={host} onChange={setHost} />
            <div data-testid={`claim-host-${host}`}>{HOST_BODY[host]}</div>
            <p className="flex items-center gap-2 text-xs text-muted">
                <LockClosedIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                Only people who can open your host's dashboard can see this code.
            </p>
        </section>
    );
}
