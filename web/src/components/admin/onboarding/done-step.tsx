import { Link } from 'react-router-dom';
import { useOnboarding } from '../../../hooks/use-onboarding';

interface DoneStepProps {
  onComplete: () => void;
  goToStep: (step: number) => void;
  /**
   * First wizard step the flavour shows (ROK-1701 OQ-8b: cloud hides Secure
   * Account, so 1). Rows that edit a hidden step get no edit affordance.
   */
  firstStep?: number;
}

const CheckCircleIcon = (
    <svg className="w-8 h-8 text-success" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
);

const EditIcon = (
    <svg className="w-4 h-4 text-muted group-hover:text-emerald-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
);

function buildSummaryItems(steps: Record<string, boolean | undefined> | undefined, dataSources: Record<string, { configured: boolean }> | undefined): (SummaryRow & { skipMessage: string })[] {
    return [
        { label: 'Password Changed', done: steps?.secureAccount ?? false, skipMessage: 'Default password still in use', wizardStep: 0 },
        { label: 'Community Identity', done: steps?.communityIdentity ?? false, skipMessage: 'Using default settings', wizardStep: 1 },
        { label: 'Discord', done: steps?.discord ?? false, skipMessage: 'Not connected', wizardStep: 2 },
        // No wizard step owns these yet (R15 adds Game data) — they link to their admin pages.
        { label: 'Blizzard API', done: dataSources?.blizzard?.configured ?? false, skipMessage: 'Not connected', href: '/admin/settings/plugins' },
        { label: 'IGDB / Twitch API', done: dataSources?.igdb?.configured ?? false, skipMessage: 'Not connected', href: '/admin/settings/integrations/igdb' },
        { label: 'Discord OAuth', done: dataSources?.discord?.configured ?? false, skipMessage: 'Not configured', wizardStep: 2 },
    ];
}

function DoneBadge({ done }: { done: boolean }) {
    if (done) {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Done
            </span>
        );
    }
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning">Skipped</span>;
}

const ROW_CLASS = 'w-full flex items-center justify-between py-2.5 px-3 -mx-3 min-h-[44px] border-b border-edge/20 last:border-0 rounded-lg';

/** A summary row for a hidden step: status only, nothing to click. */
function StaticSummaryItem({ item }: { item: { label: string; done: boolean } }) {
    return (
        <div className={ROW_CLASS}>
            <span className="text-sm text-foreground">{item.label}</span>
            <DoneBadge done={item.done} />
        </div>
    );
}

function RowLabel({ label }: { label: string }) {
    return <span className="text-sm text-foreground group-hover:text-emerald-400 transition-colors">{label}</span>;
}

type SummaryRow = { label: string; done: boolean } & ({ wizardStep: number; href?: never } | { href: string; wizardStep?: never });

const ROW_EDIT_CLASS = `${ROW_CLASS} hover:bg-surface/50 transition-colors cursor-pointer group text-left`;

function SummaryItem({ item, goToStep, firstStep }: { item: SummaryRow; goToStep: (step: number) => void; firstStep: number }) {
    if (item.href !== undefined) {
        return (
            <Link to={item.href} className={ROW_EDIT_CLASS}>
                <RowLabel label={item.label} />
                <div className="flex items-center gap-2"><DoneBadge done={item.done} />{EditIcon}</div>
            </Link>
        );
    }
    const step = item.wizardStep;
    if (step < firstStep) return <StaticSummaryItem item={item} />;
    return (
        <button type="button" onClick={() => goToStep(step)} className={ROW_EDIT_CLASS}>
            <RowLabel label={item.label} />
            <div className="flex items-center gap-2">
                <DoneBadge done={item.done} />
                {EditIcon}
            </div>
        </button>
    );
}

/**
 * ROK-1703 OQ-2 (approved): the one Discord-link line, once Discord sign-in is
 * configured. It points at the profile's authenticated link flow: a plain
 * Discord sign-in would create a separate user instead of linking this admin.
 */
function DiscordLinkNote({ show }: { show: boolean }) {
    if (!show) return null;
    return (
        <p className="flex items-center gap-2 text-sm text-secondary" data-testid="discord-link-note">
            <svg className="w-4 h-4 shrink-0 text-muted" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
            <span>Next: link this admin account to your Discord user in{' '}
                <Link to="/profile/integrations" className="font-medium underline underline-offset-2">Profile → Integrations</Link>.</span>
        </p>
    );
}

function SkippedNotice({ hasSkipped }: { hasSkipped: boolean }) {
    if (!hasSkipped) return null;
    return (
        <div className="bg-warning/5 border border-warning/20 rounded-lg p-4">
            <p className="text-sm text-warning">
                You can complete the skipped items anytime in{' '}
                <Link to="/admin/settings/general" className="font-medium underline underline-offset-2">Admin Settings</Link>.
            </p>
        </div>
    );
}

/**
 * Step 4: Done (ROK-204)
 * Summary of what was configured vs. skipped.
 */
export function DoneStep({ onComplete, goToStep, firstStep = 0 }: DoneStepProps) {
    const { statusQuery, dataSourcesQuery } = useOnboarding();
    const items = buildSummaryItems(statusQuery.data?.steps, dataSourcesQuery.data);
    const hasSkipped = items.some((i) => !i.done);

    return (
        <div className="space-y-8">
            <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/20 border-2 border-success/50 flex items-center justify-center">
                    {CheckCircleIcon}
                </div>
                <h2 className="text-2xl font-bold text-foreground">You're All Set!</h2>
                <p className="text-sm text-muted mt-2 max-w-md mx-auto">Your community is ready to go. Here's a summary of your setup. Click any item to go back and edit it.</p>
            </div>
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Configuration Summary</h3>
                <div className="space-y-2">
                    {items.map((item) => <SummaryItem key={item.label} item={item} goToStep={goToStep} firstStep={firstStep} />)}
                </div>
                <DiscordLinkNote show={dataSourcesQuery.data?.discord?.configured ?? false} />
            </div>
            <SkippedNotice hasSkipped={hasSkipped} />
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                <button onClick={onComplete} className="px-8 py-3 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors text-sm">Complete</button>
                <Link to="/admin/settings/general" className="text-sm text-muted hover:text-foreground transition-colors px-4 py-2.5 min-h-[44px] inline-flex items-center rounded-lg hover:bg-edge/20">Review Settings</Link>
            </div>
        </div>
    );
}
