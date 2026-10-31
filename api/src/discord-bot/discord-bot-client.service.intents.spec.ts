/**
 * ROK-1703 AC-6: the connect-time 4014 path (`doLogin`'s catch) names the
 * intents that are off, and `connect()` still rejects if that lookup throws.
 */
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventEmitter } from 'events';
import { DiscordBotClientService } from './discord-bot-client.service';
import { fetchMissingPrivilegedIntents } from './discord-intents.helpers';

jest.mock('./discord-intents.helpers', () => ({
  ...jest.requireActual<object>('./discord-intents.helpers'),
  fetchMissingPrivilegedIntents: jest.fn(),
}));

class FakeClient extends EventEmitter {
  user = null;
  guilds = { cache: new Map() };
  login = jest.fn();
  destroy = jest.fn().mockResolvedValue(undefined);
  isReady = jest.fn().mockReturnValue(false);
}

let fake: FakeClient;
jest.mock('./discord-bot-client.helpers', () => ({
  ...jest.requireActual<object>('./discord-bot-client.helpers'),
  createDiscordClient: () => fake,
}));

const fetchMissing = jest.mocked(fetchMissingPrivilegedIntents);

function intentsError(): Error {
  return Object.assign(new Error('Used disallowed intents'), { code: 4014 });
}

/** Settle the promise chain without timers; returns the rejection text (or undefined while pending). */
async function rejectionText(p: Promise<void>): Promise<string | undefined> {
  let text: string | undefined;
  p.catch((e: unknown) => {
    text = e instanceof Error ? e.message : String(e);
  });
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
  return text;
}

let service: DiscordBotClientService;

beforeEach(async () => {
  fake = new FakeClient();
  fake.login.mockRejectedValue(intentsError());
  const module = await Test.createTestingModule({
    providers: [
      DiscordBotClientService,
      {
        provide: EventEmitter2,
        useValue: {
          emit: jest.fn(),
          emitAsync: jest.fn().mockResolvedValue([]),
        },
      },
    ],
  }).compile();
  service = module.get(DiscordBotClientService);
  fetchMissing.mockReset();
});

afterEach(async () => {
  await service.disconnect();
});

describe('DiscordBotClientService — connect: 4014 disallowed intents (ROK-1703)', () => {
  it('names the intent Discord reports as off and asks with the same token', async () => {
    fetchMissing.mockResolvedValue(['presence']);
    const text = await rejectionText(service.connect('intents-token'));
    expect(fetchMissing).toHaveBeenCalledWith('intents-token');
    expect(text).toBe(
      'Missing required privileged intent: Presence Intent. Turn it on in the Discord Developer Portal under Bot > Privileged Gateway Intents.',
    );
    expect(service.isConnecting()).toBe(false);
  });

  it('still rejects (naming all three) when the intents lookup throws', async () => {
    fetchMissing.mockRejectedValue(new Error('lookup blew up'));
    const text = await rejectionText(service.connect('intents-token'));
    expect(text).toMatch(
      /^Missing required privileged intents: .*Presence Intent.*Server Members Intent.*Message Content Intent/,
    );
  });
});
