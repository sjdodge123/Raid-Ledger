/**
 * ROK-1067 — public-shareable lineup link smoke test.
 *
 * Validates the un-authed public path:
 *   1. Creating a public lineup with `publicShareEnabled: true` returns a
 *      `publicSlug` and the slug resolves un-authed via the public route.
 *   2. PATCH /lineups/:id/public-share { enabled: false } makes the same
 *      slug return 404 from the un-authed path. Re-enabling restores 200.
 *   3. The public response body never carries voters/votes/nominees/invitees.
 *
 * The fetch calls go straight to the API URL without an Authorization
 * header — that's the contract being tested. Cleanup archives the lineup
 * to avoid leaking state between runs.
 */
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

interface PublicLineupBody {
  title: string;
  description: string | null;
  status: string;
  decision: { gameName: string; coverUrl: string | null } | null;
  communityName: string;
}

interface CreatedLineup {
  id: number;
  publicSlug: string;
  publicShareEnabled: boolean;
}

const FORBIDDEN_KEYS = [
  'voters',
  'votes',
  'nominees',
  'invitees',
  'voterIds',
  'createdBy',
  'id',
];

async function fetchPublic(
  apiUrl: string,
  slug: string,
): Promise<{ status: number; body: PublicLineupBody | null }> {
  const res = await fetch(`${apiUrl}/lineups/public/${slug}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const text = await res.text().catch(() => '');
  let body: PublicLineupBody | null = null;
  try {
    body = text ? (JSON.parse(text) as PublicLineupBody) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function archiveAllLineups(api: ApiClient): Promise<void> {
  try {
    const res = await api.get<{ id: number }[] | { id: number } | null>(
      '/lineups/active',
    );
    const list = Array.isArray(res) ? res : res ? [res] : [];
    for (const row of list) {
      if (!row?.id) continue;
      await api
        .patch(`/lineups/${row.id}/status`, { status: 'archived' })
        .catch(() => null);
    }
  } catch {
    /* no active lineups */
  }
}

const publicShareLinkResolvesUnauthed: SmokeTest = {
  name: 'Public lineup slug resolves un-authed and toggling off returns 404 (ROK-1067)',
  category: 'flow',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Public Share ${Date.now()}`;
    const lineup = await ctx.api.post<CreatedLineup>('/lineups', {
      title,
      description: 'Smoke test public lineup',
      visibility: 'public',
      publicShareEnabled: true,
    });

    try {
      if (!lineup.publicSlug) {
        throw new Error(
          `Create response is missing publicSlug: ${JSON.stringify(lineup)}`,
        );
      }
      if (lineup.publicShareEnabled !== true) {
        throw new Error(
          `Expected publicShareEnabled=true on create, got ${String(
            lineup.publicShareEnabled,
          )}`,
        );
      }

      // Slug resolves un-authed.
      const enabledRes = await fetchPublic(
        ctx.config.apiUrl,
        lineup.publicSlug,
      );
      if (enabledRes.status !== 200) {
        throw new Error(
          `Expected 200 from /lineups/public/${lineup.publicSlug}, got ${enabledRes.status}`,
        );
      }
      if (!enabledRes.body || enabledRes.body.title !== title) {
        throw new Error(
          `Expected body.title === "${title}", got ${JSON.stringify(enabledRes.body)}`,
        );
      }
      // Field-leak guard.
      const bodyKeys = Object.keys(enabledRes.body as object);
      const leaks = FORBIDDEN_KEYS.filter((k) => bodyKeys.includes(k));
      if (leaks.length > 0) {
        throw new Error(
          `Public response leaked fields: ${leaks.join(', ')}`,
        );
      }

      // Toggle off.
      await ctx.api.patch(`/lineups/${lineup.id}/public-share`, {
        enabled: false,
      });

      const disabledRes = await fetchPublic(
        ctx.config.apiUrl,
        lineup.publicSlug,
      );
      if (disabledRes.status !== 404) {
        throw new Error(
          `Expected 404 after toggle-off, got ${disabledRes.status}`,
        );
      }

      // Re-enable.
      await ctx.api.patch(`/lineups/${lineup.id}/public-share`, {
        enabled: true,
      });
      const reEnabledRes = await fetchPublic(
        ctx.config.apiUrl,
        lineup.publicSlug,
      );
      if (reEnabledRes.status !== 200) {
        throw new Error(
          `Expected 200 after re-enabling toggle, got ${reEnabledRes.status}`,
        );
      }
    } finally {
      await ctx.api
        .patch(`/lineups/${lineup.id}/status`, { status: 'archived' })
        .catch(() => null);
    }
  },
};

export const publicShareLinkTests: SmokeTest[] = [publicShareLinkResolvesUnauthed];
