/**
 * ROK-2030 — the ONE way a smoke spec seeds the community-hubs fixture
 * (`POST /admin/test/community-hubs/seed`). Every call carries a tag unique to
 * spec × Playwright project × worker, so the API names each hub
 * `<base> #<tag>` and its reset clears only this caller's hubs: specs that
 * land on the same configured game (CI seeds ~8; 9 specs × 3 projects) never
 * clear or collide with each other. Assert hub names from the seed's
 * `hubNames`, never a literal "Seed Crew" (another tag's hub contains it).
 * Guarded by `scripts/hub-seed-helper.spec.mjs`.
 */
import type { TestInfo } from '@playwright/test';
import { apiPost } from './api-helpers';

/** The seed's hub names (`<base> #<tag>`). */
export interface HubSeedNames {
    crew: string;
    solo: string;
    proposed: string;
    archived: string;
    server: string;
    guild: string;
}

/** `<slug>-<project>-w<NN>`: unique per spec × project × worker, ≤ 32 chars. */
export function hubSeedTag(slug: string, testInfo: Pick<TestInfo, 'project' | 'parallelIndex'>): string {
    const project = testInfo.project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const tag = `${slug}-${project}-w${String(testInfo.parallelIndex).padStart(2, '0')}`;
    if (!/^[a-z0-9-]{1,32}$/.test(tag)) throw new Error(`[hub-seed] bad tag "${tag}" (slug "${slug}")`);
    return tag;
}

/** Seed this caller's tagged community-hubs fixture on `body.gameId`. */
export async function seedCommunityHubs(
    token: string,
    testInfo: Pick<TestInfo, 'project' | 'parallelIndex'>,
    slug: string,
    body: { gameId: number; withEvent?: boolean },
): Promise<unknown> {
    return apiPost(token, '/admin/test/community-hubs/seed', { ...body, tag: hubSeedTag(slug, testInfo) });
}
