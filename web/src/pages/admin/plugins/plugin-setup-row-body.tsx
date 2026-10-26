/**
 * ROK-1969 §3.5 — an expanded setup row: the manifest's numbered instructions,
 * where it goes on the server (`pelican` hints), its links, and for a
 * `server_secret` a placeholder-only config block (the value is issued in Raid
 * Ledger and never shown here) with "Issue token…" linking to the existing
 * Pelican server row. "Apply on Pelican" is shown disabled — coming later.
 */
import { useId, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { PluginSetupLink, PluginSetupPelican, PluginSetupRequirement } from '@raid-ledger/contract';
import { MarkdownBlock } from '../../../components/ui/markdown-block';
import { Button } from '../../../components/ui/button';
import { buttonClass } from '../../../components/ui/button-classes';
import { SECTION_LABEL } from './plugin-hub-contributions';

/** Integrations › Pelican Panel — where a server's token is issued today (ITEM Q4). */
export const PELICAN_SERVER_ROWS_URL = '/admin/settings/integrations/plugin/pelican/pelican-panel';

/** Instructions, where it goes, the secret block, links and the disabled Apply button. */
export function PluginSetupRowBody({ req }: { req: PluginSetupRequirement }): JSX.Element {
    return (
        <div className="space-y-3 pt-2 pb-1 pl-6">
            <MarkdownBlock text={req.instructions} className="text-sm text-secondary" />
            {req.pelican && <WhereItGoes pelican={req.pelican} />}
            {req.kind === 'server_secret' && <SecretTemplate pelican={req.pelican} />}
            <SetupLinks links={req.links ?? []} />
            {req.pelican && <ApplyOnPelican />}
        </div>
    );
}

function WhereItGoes({ pelican }: { pelican: PluginSetupPelican }): JSX.Element | null {
    const paths = [...(pelican.files ?? []), ...(pelican.variable ? [pelican.variable] : [])];
    if (paths.length === 0 && !pelican.eggHint) return null;
    return (
        <div>
            <p className={SECTION_LABEL}>Where it goes on the server</p>
            {pelican.eggHint && <p className="mt-1 text-sm text-secondary">{pelican.eggHint}</p>}
            {paths.map((p) => (
                <code key={p} className="mt-1 block break-all rounded bg-overlay px-2 py-1 text-xs text-foreground">{p}</code>
            ))}
        </div>
    );
}

function SecretTemplate({ pelican }: { pelican: PluginSetupPelican | undefined }): JSX.Element {
    const line = pelican?.variable
        ? `${pelican.variable} = <shown once when you issue it>`
        : '<config block — shown once when you issue the token>';
    return (
        <div className="space-y-2" data-testid="setup-secret">
            <pre className="overflow-x-auto rounded bg-overlay px-3 py-2 text-xs text-muted">{line}</pre>
            <p className="flex gap-2 text-xs text-muted">
                <span aria-hidden="true">🔒</span>
                <span>The value is issued in Raid Ledger and never shown here.</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <Link to={PELICAN_SERVER_ROWS_URL} className={buttonClass({ variant: 'secondary', size: 'sm' })}>Issue token…</Link>
                <span className="text-xs text-dim">Opens the server’s row in Integrations › Pelican Panel.</span>
            </div>
        </div>
    );
}

function SetupLinks({ links }: { links: PluginSetupLink[] }): JSX.Element | null {
    if (links.length === 0) return null;
    return (
        <ul className="flex flex-wrap gap-3">
            {links.map((l) => (
                <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer"
                        className="text-sm text-secondary underline underline-offset-2 hover:text-foreground">{l.label} ↗</a>
                </li>
            ))}
        </ul>
    );
}

function ApplyOnPelican(): JSX.Element {
    const laterId = useId();
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled aria-describedby={laterId}>Apply on Pelican</Button>
            <span id={laterId} className="text-xs text-dim">Coming later — Raid Ledger will do this step for you on Pelican.</span>
        </div>
    );
}
