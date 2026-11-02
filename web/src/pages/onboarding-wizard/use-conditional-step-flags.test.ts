/**
 * ROK-2022: the wizard's Calendar step flag. Shown only when the kill switch
 * is on, a shipped provider is available and the user has no shipped
 * connection; latched for the mount; `resume=calendar` keeps it and holds
 * `settled` until the overview answers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CalendarConnection, CalendarsOverview } from '@raid-ledger/contract';
import {
    calendarConnectionFixture, calendarsOverviewFixture, calendarsOverviewVariants,
} from '../../test/mocks/calendar-sync-handlers';

const overview: { data: CalendarsOverview | undefined; isLoading: boolean } = { data: undefined, isLoading: false };

vi.mock('../../hooks/use-calendar-sync', () => ({ useCalendarsOverview: () => overview }));
vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => ({ data: { discordConfigured: false, steamConfigured: false }, isLoading: false }),
}));
vi.mock('../../hooks/use-discord-onboarding', () => ({ useGuildMembership: () => ({ data: undefined }) }));
vi.mock('../../hooks/use-steam-link', () => ({ useSteamLink: () => ({ steamStatus: { isLoading: false, data: undefined } }) }));

import { useConditionalStepFlags } from './use-conditional-step-flags';

const USER = { discordId: 'local:1' };

function withConnections(...connections: CalendarConnection[]): CalendarsOverview {
    return calendarsOverviewFixture({ connections });
}

function serve(data: CalendarsOverview | undefined, isLoading = false): void {
    overview.data = data;
    overview.isLoading = isLoading;
}

function flagsFor(resumeCalendar = false) {
    return renderHook(({ resume }) => useConditionalStepFlags(USER, { resumeCalendar: resume }), {
        initialProps: { resume: resumeCalendar },
    });
}

describe('useConditionalStepFlags — needsCalendarConnect (ROK-2022)', () => {
    beforeEach(() => serve(undefined));

    it('is false when the calendar-sync kill switch is off', () => {
        serve(calendarsOverviewVariants.disabled);
        expect(flagsFor().result.current.needsCalendarConnect, 'switch off must hide the step').toBe(false);
    });

    it('is false when the switch is on but no shipped provider is available', () => {
        serve(calendarsOverviewVariants.notConfigured);
        expect(flagsFor().result.current.needsCalendarConnect, 'no provider must hide the step').toBe(false);
    });

    it('is true when the switch is on, a provider is available and the user has no connection', () => {
        serve(calendarsOverviewVariants.available);
        expect(flagsFor().result.current.needsCalendarConnect, 'on + none must show the step').toBe(true);
    });

    it('is false for a user who already has a shipped connection', () => {
        serve(calendarsOverviewVariants.connected);
        expect(flagsFor().result.current.needsCalendarConnect, 'a connected user must never see it').toBe(false);
    });

    it('counts a Microsoft connection (shipped in ROK-1597) but ignores a disconnecting one', () => {
        serve(withConnections({ ...calendarConnectionFixture, provider: 'microsoft' }));
        expect(flagsFor().result.current.needsCalendarConnect, 'an Outlook connection is a connection').toBe(false);
        serve(withConnections({ ...calendarConnectionFixture, status: 'disconnecting' }));
        expect(flagsFor().result.current.needsCalendarConnect, 'a disconnecting row is not a connection').toBe(true);
    });

    it('is false while the overview loads, and that does not hold `settled` without a resume', () => {
        serve(undefined, true);
        const { result } = flagsFor();
        expect(result.current.needsCalendarConnect).toBe(false);
        expect(result.current.settled, 'a plain first render must not wait on the overview').toBe(true);
    });

    it('stays shown for the mount once a connection lands mid-wizard (latch)', () => {
        serve(calendarsOverviewVariants.available);
        const { result, rerender } = flagsFor();
        expect(result.current.needsCalendarConnect).toBe(true);
        serve(calendarsOverviewVariants.connected);
        rerender({ resume: false });
        expect(result.current.needsCalendarConnect, 'the step must not vanish under the user after connecting').toBe(true);
    });

    it('with resume=calendar: holds `settled` until the overview answers, then keeps the step for a connected user', () => {
        serve(undefined, true);
        const { result, rerender } = flagsFor(true);
        expect(result.current.settled, 'the resume seek needs the final step list').toBe(false);
        serve(calendarsOverviewVariants.connected);
        rerender({ resume: true });
        expect(result.current.settled).toBe(true);
        expect(result.current.needsCalendarConnect, 'an OAuth return must land on the Calendar step').toBe(true);
    });

    it('with resume=calendar but the switch off: no step', () => {
        serve(calendarsOverviewVariants.disabled);
        expect(flagsFor(true).result.current.needsCalendarConnect, 'resume must not override the kill switch').toBe(false);
    });
});
