/**
 * Admin → Integrations → Calendar Sync: step-by-step Google setup guide.
 *
 * Hand-holding copy with a direct Google Cloud Console link per step (the
 * console opens each page on the last project the admin selected). Only
 * Google resolves today; Microsoft (ROK-1597) has fields but no provider yet.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const CONSOLE = 'https://console.cloud.google.com';

const GOOGLE_SETUP_LINKS = {
    createProject: `${CONSOLE}/projectcreate`,
    calendarApi: `${CONSOLE}/apis/library/calendar-json.googleapis.com`,
    authOverview: `${CONSOLE}/auth/overview`,
    branding: `${CONSOLE}/auth/branding`,
    audience: `${CONSOLE}/auth/audience`,
    verification: `${CONSOLE}/auth/verification`,
    createClient: `${CONSOLE}/auth/clients/create`,
} as const;

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            {children}
        </a>
    );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
    return (
        <li>
            <strong className="text-foreground">{title}</strong> {children}
        </li>
    );
}

/** ROK-1778: Publish app stays off until the Branding page is saved. */
function BrandingStep() {
    return (
        <Step title="Fill in the Branding page.">
            Publish stays off until this page is saved. Open{' '}
            <ExtLink href={GOOGLE_SETUP_LINKS.branding}>Branding</ExtLink>. For User support email, pick your
            email. <strong>Skip the App logo: adding one sends your branding to Google for review.</strong> Under
            App domain, paste the <strong>Google JavaScript origin</strong> shown below (your Raid Ledger
            address) into Application home page, and the <strong>Privacy policy link</strong> shown below into
            Application privacy policy link; leave the terms of service link empty. Under Authorized domains
            click <strong>Add domain</strong> and enter your site&apos;s domain without https:// (for
            raid.example.com, enter example.com). Enter your email as the developer contact and
            click <strong>Save</strong>.
        </Step>
    );
}

function GoogleProjectSteps() {
    return (
        <>
            <Step title="Create a Google Cloud project.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.createProject}>Create a project</ExtLink>, name
                it &quot;Raid Ledger&quot; and click <strong>Create</strong>. Then check the project menu at
                the top of the page shows it as selected (pick it there if not, or pick an existing project).
            </Step>
            <Step title="Turn on the Google Calendar API.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.calendarApi}>Google Calendar API</ExtLink> and
                click <strong>Enable</strong>.
            </Step>
            <Step title="Set up the Google sign-in screen.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.authOverview}>Google Auth Platform</ExtLink> and
                click <strong>Get started</strong>. Enter &quot;Raid Ledger&quot; as the app name and your
                email where it asks, choose <strong>External</strong>, agree, and click <strong>Create</strong>.
            </Step>
            <BrandingStep />
            <Step title="Let any member connect.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.audience}>Audience</ExtLink>, click{' '}
                <strong>Publish app</strong> and confirm. Members then connect their own calendars: there
                is no list of emails to keep.
            </Step>
        </>
    );
}

function GoogleClientSteps() {
    return (
        <>
            <Step title="Create the OAuth client.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.createClient}>Create OAuth client</ExtLink>. Set
                Application type to <strong>Web application</strong>. Under Authorized JavaScript origins click{' '}
                <strong>Add URI</strong> and paste the <strong>Google JavaScript origin</strong> shown below.
                Under Authorized redirect URIs click <strong>Add URI</strong> and paste the{' '}
                <strong>Google redirect URI</strong> shown below (click either to copy). Then click{' '}
                <strong>Create</strong>.
            </Step>
            <Step title="Paste the keys here.">
                Google shows a <strong>Client ID</strong> and a <strong>Client secret</strong>. Copy each
                one into the Google fields below before closing that window: Google shows the secret only once.
            </Step>
            <Step title="Turn it on.">
                Switch on <strong>Enable Calendar Sync</strong> above and click{' '}
                <strong>Save Configuration</strong>. Members then connect from{' '}
                <Link to="/profile/gaming/calendars" className="underline hover:text-foreground">
                    Profile → Gaming → Calendars
                </Link>.
            </Step>
        </>
    );
}

export function CalendarSyncInstructions() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 space-y-3" data-testid="calendar-sync-instructions">
            <div>
                <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
                <p className="text-xs text-muted mt-1">
                    About 10 minutes with any Google account. Only Google works today, so leave the
                    Microsoft fields empty.
                </p>
            </div>
            <ol className="text-sm text-secondary space-y-2 list-decimal list-inside">
                <GoogleProjectSteps />
                <GoogleClientSteps />
            </ol>
            <p className="text-xs text-muted" data-testid="calendar-sync-unverified-note">
                <strong className="text-secondary">Good to know:</strong> until Google verifies your app,
                members see a &quot;Google hasn&apos;t verified this app&quot; screen when they connect. It
                appears because the app is your own rather than one Google has reviewed: they click{' '}
                <strong>Advanced</strong>, then <strong>Go to Raid Ledger (unsafe)</strong>. An unverified app
                can be connected by up to 100 people in total. To remove the screen and the limit, submit the
                app from the <ExtLink href={GOOGLE_SETUP_LINKS.verification}>Verification Center</ExtLink>;
                Google asks for your site&apos;s domain and the privacy policy link above, and review can take a few weeks.
            </p>
        </div>
    );
}
