/**
 * ROK-1801 — `SERVER_PRESENCE_READER` is bound by a global module with
 * `useExisting: PelicanPresenceSupervisor` (the supervisor lives in
 * `PelicanModule`). Boots the real module graph to prove the alias resolves
 * to the ONE supervisor instance — a second instance would read no sessions.
 */
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { PelicanPresenceSupervisor } from './pelican-presence.supervisor';
import {
  SERVER_PRESENCE_READER,
  type ServerPresenceReader,
} from './server-presence.reader';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

it('resolves SERVER_PRESENCE_READER to the presence supervisor singleton', () => {
  const reader = testApp.app.get<ServerPresenceReader>(SERVER_PRESENCE_READER, {
    strict: false,
  });
  const supervisor = testApp.app.get(PelicanPresenceSupervisor, {
    strict: false,
  });
  expect(reader).toBeInstanceOf(PelicanPresenceSupervisor);
  expect(reader).toBe(supervisor);
  expect(reader.playersOnGames()).toEqual([]);
});
