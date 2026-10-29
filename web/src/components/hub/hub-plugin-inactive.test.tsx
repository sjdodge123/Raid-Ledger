/**
 * ROK-2044 — a hub whose plugin is off 403s with `code: HUB_PLUGIN_INACTIVE`.
 * The page must say the hub is unavailable (admins also get a Plugins link),
 * never "You're not a member"; a membership 403 keeps today's copy.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { createTestQueryClient, renderWithProviders } from '../../test/render-helpers';
import { createMockUser } from '../../test/factories';
import { withErrorBody, withHttpStatus } from '../../lib/api/api-error';
import { ErrorState } from './hub-page';
import { HUB_PLUGIN_INACTIVE, isHubPluginInactive } from './hub-plugin-inactive.helpers';

const PLUGIN_OFF_COPY = 'This hub is unavailable — its plugin is turned off.';
const WOW_NOT_MEMBER = "You're not a member of this guild. Link a character in the guild to see its page.";

function forbidden(body: Record<string, unknown>): Error {
    return withErrorBody(withHttpStatus(new Error(String(body['message'])), 403), body);
}

const pluginOff = (): Error => forbidden({
    statusCode: 403, code: HUB_PLUGIN_INACTIVE, message: 'Plugin "pelican" is not active', pluginSlug: 'pelican',
});

function renderAs(role: 'admin' | 'member', error: Error) {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['auth', 'me'], createMockUser({ role }));
    return renderWithProviders(<ErrorState error={error} onRetry={() => undefined} />, { queryClient });
}

describe('isHubPluginInactive (ROK-2044)', () => {
    it('is true only for a 403 carrying HUB_PLUGIN_INACTIVE', () => {
        expect(isHubPluginInactive(pluginOff())).toBe(true);
        expect(isHubPluginInactive(forbidden({ message: 'Not a member' }))).toBe(false);
        expect(isHubPluginInactive(forbidden({ code: 'USER_DEACTIVATED', message: 'Account deactivated' }))).toBe(false);
        const notForbidden = withErrorBody(withHttpStatus(new Error('x'), 404), { code: HUB_PLUGIN_INACTIVE });
        expect(isHubPluginInactive(notForbidden)).toBe(false);
    });
});

describe('ErrorState — plugin-off 403 (ROK-2044)', () => {
    it('shows the neutral plugin-off copy and a Plugins link to an admin', () => {
        renderAs('admin', pluginOff());
        expect(screen.getByTestId('guild-plugin-inactive')).toHaveTextContent(PLUGIN_OFF_COPY);
        expect(screen.queryByTestId('guild-not-member'), 'a plugin-off 403 must not read as not-a-member').toBeNull();
        expect(screen.getByTestId('guild-plugin-inactive-plugins-link')).toHaveAttribute('href', '/admin/settings/plugins');
    });

    it('shows the same copy to a member, without the Plugins link', () => {
        renderAs('member', pluginOff());
        expect(screen.getByTestId('guild-plugin-inactive')).toHaveTextContent(PLUGIN_OFF_COPY);
        expect(screen.queryByTestId('guild-not-member')).toBeNull();
        expect(screen.queryByTestId('guild-plugin-inactive-plugins-link'), 'only an admin can turn a plugin on').toBeNull();
    });

    it('keeps the not-a-member copy for a membership 403', () => {
        renderAs('admin', forbidden({ statusCode: 403, message: 'Not a member' }));
        expect(screen.getByTestId('guild-not-member')).toHaveTextContent(WOW_NOT_MEMBER);
        expect(screen.queryByTestId('guild-plugin-inactive')).toBeNull();
    });
});
