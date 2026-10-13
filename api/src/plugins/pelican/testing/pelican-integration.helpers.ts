/**
 * Integration-spec plumbing for Pelican sync/status (ROK-1772): a fake panel
 * served through `PelicanClient`'s injected `fetchImpl`, stubbed in at
 * `PelicanClientFactory.connect`. Nothing here talks to a real panel.
 */
import * as bcrypt from 'bcrypt';
import type { TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PelicanClient } from '../pelican-client';
import { PelicanClientFactory } from '../pelican-client.factory';
import {
  fakeServer,
  jsonResponse,
  requestUrl,
  serverPageBody,
} from './pelican-fixtures';

/** Fake client key — a fixture, never a real credential. */
export const FAKE_CLIENT_KEY = 'pacc_integrationFixtureNotARealKey1772';
export const PANEL_HOST = 'panel.test';

type FetchArgs = Parameters<typeof fetch>;
export type FakeListedServer = ReturnType<typeof fakeServer>;

export interface FakeLiveState {
  state: string;
  suspended: boolean;
}

/** A mutable fake panel. Edit its fields between syncs to change what it serves. */
export interface FakePanel {
  servers: FakeListedServer[];
  pageSize: number;
  /** This listing page answers 500 (every other page is served). */
  failPage: number | null;
  /** Live state per uuid; a uuid absent here answers 500 on `/resources`. */
  live: Map<string, FakeLiveState>;
  /** When set, every request waits for it before answering. */
  gate: Promise<void> | null;
  fetchImpl: jest.Mock<Promise<Response>, FetchArgs>;
}

function listingPage(panel: FakePanel, page: number): Response {
  if (panel.failPage === page) return jsonResponse({ errors: [] }, 500);
  const totalPages = Math.max(
    1,
    Math.ceil(panel.servers.length / panel.pageSize),
  );
  const start = (page - 1) * panel.pageSize;
  const slice = panel.servers.slice(start, start + panel.pageSize);
  return jsonResponse(serverPageBody(slice, page, totalPages));
}

function resources(panel: FakePanel, uuid: string): Response {
  const live = panel.live.get(uuid);
  if (!live) return jsonResponse({ errors: [] }, 500);
  return jsonResponse({
    object: 'stats',
    attributes: {
      current_state: live.state,
      is_suspended: live.suspended,
      resources: {
        memory_bytes: 1,
        cpu_absolute: 1,
        disk_bytes: 1,
        network_rx_bytes: 1,
        network_tx_bytes: 1,
        uptime: 1,
      },
    },
  });
}

function route(panel: FakePanel, input: FetchArgs[0]): Response {
  const url = requestUrl(input);
  if (url.pathname === '/api/client') {
    return listingPage(panel, Number(url.searchParams.get('page') ?? '1'));
  }
  const match = /^\/api\/client\/servers\/([^/]+)\/resources$/.exec(
    url.pathname,
  );
  if (match?.[1]) return resources(panel, decodeURIComponent(match[1]));
  return jsonResponse({ errors: [] }, 404);
}

export function createFakePanel(servers: FakeListedServer[]): FakePanel {
  const panel: FakePanel = {
    servers,
    pageSize: 100,
    failPage: null,
    live: new Map(),
    gate: null,
    fetchImpl: jest.fn<Promise<Response>, FetchArgs>(),
  };
  panel.fetchImpl.mockImplementation(async (input) => {
    if (panel.gate) await panel.gate;
    return route(panel, input);
  });
  return panel;
}

/** Paths the panel was asked for, in call order. */
export function requestedPaths(panel: FakePanel): string[] {
  return panel.fetchImpl.mock.calls.map(
    ([input]) => requestUrl(input).pathname,
  );
}

/** How many listing pages (`GET /api/client`) were requested. */
export function listingCalls(panel: FakePanel): number {
  return requestedPaths(panel).filter((p) => p === '/api/client').length;
}

/** Uuids whose `/resources` were requested. */
export function resourceUuids(panel: FakePanel): string[] {
  return requestedPaths(panel)
    .map((p) => /^\/api\/client\/servers\/([^/]+)\/resources$/.exec(p)?.[1])
    .filter((u): u is string => u !== undefined)
    .map((u) => decodeURIComponent(u));
}

/** Route the app's Pelican client to `panel` (restore with `jest.restoreAllMocks`). */
export function stubPanel(testApp: TestApp, panel: FakePanel): void {
  jest
    .spyOn(testApp.app.get(PelicanClientFactory), 'connect')
    .mockImplementation(() =>
      Promise.resolve({
        client: new PelicanClient({
          baseUrl: `http://${PANEL_HOST}`,
          apiKey: FAKE_CLIENT_KEY,
          fetchImpl: panel.fetchImpl,
        }),
        host: PANEL_HOST,
      }),
    );
}

/** A signed-in non-admin member's bearer token. */
export async function memberToken(
  testApp: TestApp,
  username: string,
): Promise<string> {
  const email = `${username}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username, role: 'member' })
      .returning(),
    'member user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  const body = res.body as { access_token: string };
  return body.access_token;
}

/** A deferred gate: hold every panel request until `release()`. */
export function deferredGate(): { gate: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}
