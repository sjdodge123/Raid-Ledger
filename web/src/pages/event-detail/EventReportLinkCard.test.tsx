/**
 * ROK-1725 W1–W8 — the event detail "Logs" card. The card is rendered from the
 * detail-bundle query cache (`['events', id, 'detail']`), exactly as the page
 * reads it, so the save/remove cases also prove the PATCH response is written
 * back into that cache.
 */
import type { JSX } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useQuery } from '@tanstack/react-query';
import type { EventResponseDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../test/render-helpers';
import { createMockEvent } from '../../test/factories';
import { EventReportLinkCard } from './EventReportLinkCard';

vi.mock('../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const EVENT_ID = 1;
const REPORT_LINK_URL = `http://localhost:3000/events/${EVENT_ID}/report-link`;
const DETAIL_KEY = ['events', EVENT_ID, 'detail'];
const WCL = 'https://www.warcraftlogs.com/reports/AbC123#fight=4';

type Bundle = { event: EventResponseDto };

function CardFromCache({ canManage, isCancelled }: { canManage: boolean; isCancelled: boolean }): JSX.Element | null {
    const { data } = useQuery<Bundle>({ queryKey: DETAIL_KEY, queryFn: () => new Promise<Bundle>(() => undefined), staleTime: Infinity });
    if (!data) return null;
    return <EventReportLinkCard event={data.event} canManage={canManage} isCancelled={isCancelled} />;
}

function renderCard(reportUrl: string | null, opts: { canManage?: boolean; isCancelled?: boolean } = {}) {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData<Bundle>(DETAIL_KEY, { event: createMockEvent({ id: EVENT_ID, reportUrl }) });
    return renderWithProviders(
        <CardFromCache canManage={opts.canManage ?? false} isCancelled={opts.isCancelled ?? false} />,
        { queryClient },
    );
}

/** Records every PATCH body and answers with the full event carrying the sent URL. */
function capturePatches(): unknown[] {
    const bodies: unknown[] = [];
    server.use(http.patch(REPORT_LINK_URL, async ({ request }) => {
        const body = (await request.json()) as { reportUrl: string | null };
        bodies.push(body);
        return HttpResponse.json({ ...createMockEvent({ id: EVENT_ID }), reportUrl: body.reportUrl });
    }));
    return bodies;
}

async function openEditorAndType(text: string) {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add report link' }));
    await user.type(screen.getByLabelText('Report link'), text);
    await user.click(screen.getByRole('button', { name: 'Save' }));
}

function expectNoManageButtons() {
    for (const name of ['Edit', 'Remove', 'Add report link']) {
        expect(screen.queryByRole('button', { name }), `"${name}" button should not render`).toBeNull();
    }
}

describe('EventReportLinkCard', () => {
    it('W1: shows the link read-only to a non-manager — site name, new tab, noopener + noreferrer', () => {
        renderCard(WCL);
        const link = screen.getByRole('link', { name: 'View report on Warcraft Logs' });
        expect(link).toHaveAttribute('href', WCL);
        expect(link).toHaveAttribute('target', '_blank');
        const rel = (link.getAttribute('rel') ?? '').split(/\s+/);
        expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
        expect(screen.getByText('www.warcraftlogs.com/reports/AbC123')).toBeInTheDocument();
        expectNoManageButtons();
    });

    it('W1b: falls back to the URL host when the site is not a known log site', () => {
        renderCard('https://logs.example.com/r/9');
        expect(screen.getByRole('link', { name: 'View report on logs.example.com' })).toBeInTheDocument();
    });

    it('W2: renders nothing for a non-manager when no link is set', () => {
        renderCard(null);
        expect(screen.queryByTestId('event-report-link-card')).toBeNull();
    });

    it('W3: shows a manager the empty state with "Add report link"', () => {
        renderCard(null, { canManage: true });
        expect(screen.getByRole('heading', { name: 'Logs' })).toBeInTheDocument();
        expect(screen.getByText(/No logs linked yet/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add report link' })).toBeInTheDocument();
    });

    it('W4: rejects a non-allow-listed URL inline, without sending a request', async () => {
        const bodies = capturePatches();
        renderCard(null, { canManage: true });
        await openEditorAndType('https://evil.com/x');
        expect(await screen.findByRole('alert')).toHaveTextContent('Only Warcraft Logs and foreverlogs.gg report links are accepted');
        expect(bodies).toEqual([]);
    });

    it('W5: saves a valid URL as its normalised form and shows the link from the patched cache', async () => {
        const bodies = capturePatches();
        const { queryClient } = renderCard(null, { canManage: true });
        await openEditorAndType('  https://WWW.WarcraftLogs.com/reports/AbC123#fight=4  ');
        const link = await screen.findByRole('link', { name: 'View report on Warcraft Logs' });
        expect(bodies).toEqual([{ reportUrl: WCL }]);
        expect(link).toHaveAttribute('href', WCL);
        expect(queryClient.getQueryData<Bundle>(DETAIL_KEY)?.event.reportUrl).toBe(WCL);
        expect(screen.queryByLabelText('Report link')).toBeNull();
    });

    it('W5b: Edit pre-fills the current link and Cancel returns to the read view', async () => {
        const user = userEvent.setup();
        renderCard(WCL, { canManage: true });
        await user.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.getByLabelText('Report link')).toHaveValue(WCL);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByRole('link', { name: 'View report on Warcraft Logs' })).toBeInTheDocument();
    });

    it('W6: Remove sends null and the empty state returns', async () => {
        const bodies = capturePatches();
        renderCard(WCL, { canManage: true });
        await userEvent.setup().click(screen.getByRole('button', { name: 'Remove' }));
        expect(await screen.findByText(/No logs linked yet/)).toBeInTheDocument();
        expect(bodies).toEqual([{ reportUrl: null }]);
        expect(screen.queryByRole('link')).toBeNull();
    });

    it("W7: shows the server's 400 validator message in the field error", async () => {
        server.use(http.patch(REPORT_LINK_URL, () => HttpResponse.json(
            { message: 'Validation failed', errors: ['reportUrl: Report link must not include a port'] },
            { status: 400 },
        )));
        renderCard(null, { canManage: true });
        await openEditorAndType(WCL);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Report link must not include a port');
        expect(alert).not.toHaveTextContent('reportUrl:');
        expect(alert).not.toHaveTextContent('Validation failed');
        expect(screen.getByLabelText('Report link')).toHaveValue(WCL);
    });

    it('W8: a cancelled event shows the link read-only even to a manager', () => {
        renderCard(WCL, { canManage: true, isCancelled: true });
        expect(screen.getByRole('link', { name: 'View report on Warcraft Logs' })).toBeInTheDocument();
        expectNoManageButtons();
    });

    it('W8b: a cancelled event with no link renders nothing, even for a manager', () => {
        renderCard(null, { canManage: true, isCancelled: true });
        expect(screen.queryByTestId('event-report-link-card')).toBeNull();
    });
});
