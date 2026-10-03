/**
 * DemoTestRenderPugInviteEmbedController — POST /admin/test/render-pug-invite-embed.
 *
 * Runs the REAL `loadInviteContext` and `buildPugInviteEmbed`; only the
 * settings, the event read and the personalization lookup are mocked, so the
 * chrome assertions below pin what the builder renders, not what a mock echoes.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { DemoTestRenderPugInviteEmbedController } from './demo-test-render-pug-invite-embed.controller';
import type { SettingsService } from '../settings/settings.service';
import { colorForState } from '../discord-bot/embeds/embed-chrome.helpers';
import {
  personalizedFieldName,
  type PersonalizedField,
} from '../discord-bot/embeds/embed-personalized.helpers';
import { loadPugInviteData } from '../discord-bot/services/pug-invite-personalization.helpers';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { createMockEvent } from '../common/testing/factories';

jest.mock('../discord-bot/services/pug-invite-personalization.helpers');

const COMMUNITY = 'Test Guild';
const CLIENT_URL = 'https://rl.example';
const EVENT_ID = 77;
const SNOWFLAKE = '123456789012345678';

const THREE_FIELDS: PersonalizedField[] = [
  { kind: 'owned', name: personalizedFieldName('owned'), value: 'Owned' },
  {
    kind: 'wishlist',
    name: personalizedFieldName('wishlist'),
    value: 'Wishlisted',
  },
  { kind: 'hearted', name: personalizedFieldName('hearted'), value: 'Yes' },
];

type EmbedJson = {
  author?: { name?: string };
  footer?: { text?: string };
  color?: number;
  description?: string;
  fields?: { name: string; value: string }[];
};
type ButtonJson = { label?: string; url?: string };

function makeSettings(demoMode = true) {
  return {
    getDemoMode: jest.fn().mockResolvedValue(demoMode),
    getBranding: jest.fn().mockResolvedValue({ communityName: COMMUNITY }),
    getClientUrl: jest.fn().mockResolvedValue(CLIENT_URL),
  };
}

function futureEvent() {
  const start = new Date(Date.now() + 2 * 3_600_000);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  return createMockEvent({
    id: EVENT_ID,
    title: 'Thursday Raid',
    gameId: 9,
    maxAttendees: 5,
    duration: [start, end],
  });
}

let db: MockDb;

function makeController(settings = makeSettings()) {
  return new DemoTestRenderPugInviteEmbedController(
    settings as unknown as SettingsService,
    db as unknown as PostgresJsDatabase<typeof schema>,
  );
}

async function render(body: unknown = { eventId: EVENT_ID }) {
  const result = await makeController().renderPugInviteEmbed(body);
  return { result, embed: result.embed as EmbedJson };
}

const originalDemoMode = process.env.DEMO_MODE;

beforeEach(() => {
  delete process.env.CLIENT_URL;
  process.env.DEMO_MODE = 'true';
  db = createDrizzleMock();
  db.limit.mockResolvedValue([futureEvent()]);
  jest.mocked(loadPugInviteData).mockResolvedValue({
    fields: THREE_FIELDS,
    coverUrl: null,
    signupCount: 3,
  });
});

afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalDemoMode;
});

describe('render-pug-invite-embed — gates and input', () => {
  it('refuses outside DEMO_MODE (env flag off)', async () => {
    process.env.DEMO_MODE = 'false';
    await expect(render()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the demo-mode setting is off', async () => {
    const controller = makeController(makeSettings(false));
    await expect(
      controller.renderPugInviteEmbed({ eventId: EVENT_ID }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([[{}], [{ eventId: 'x' }], [{ eventId: EVENT_ID, role: '<t:1:F>' }]])(
    'rejects %j with 400',
    async (body) => {
      await expect(render(body)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('returns 404 for an unknown event', async () => {
    db.limit.mockResolvedValue([]);
    await expect(render()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('looks the invitee up by the snowflake it was given', async () => {
    await render({ eventId: EVENT_ID, discordUserId: SNOWFLAKE });
    expect(loadPugInviteData).toHaveBeenCalledWith(db, {
      discordUserId: SNOWFLAKE,
      gameId: 9,
      eventId: EVENT_ID,
    });
  });
});

describe('render-pug-invite-embed — chrome from the real builder', () => {
  it('renders the amber needs_you colour and the FILL NEEDED author line', async () => {
    const { result, embed } = await render();
    expect(result.communityName).toBe(COMMUNITY);
    expect(embed.color).toBe(colorForState('needs_you'));
    expect(embed.author?.name).toContain('FILL NEEDED');
  });

  it('caps three personalized fields at two and renders no voice field', async () => {
    const { embed } = await render();
    const names = (embed.fields ?? []).map((f) => f.name);
    expect(names).toEqual([
      personalizedFieldName('owned'),
      personalizedFieldName('wishlist'),
    ]);
    expect(names).not.toContain('Voice Channel');
  });

  it('ends its one row with View Event, after Accept and Decline', async () => {
    const { result } = await render();
    expect(result.components).toHaveLength(1);
    const buttons = (result.components[0]?.components ?? []) as ButtonJson[];
    expect(buttons.map((b) => b.label)).toEqual([
      'Accept',
      'Decline',
      'View Event',
    ]);
    expect(buttons[buttons.length - 1]?.url).toBe(
      `${CLIENT_URL}/events/${EVENT_ID}`,
    );
  });

  it('carries no masked link in the description', async () => {
    const { embed } = await render();
    expect(embed.description).toBeDefined();
    expect(embed.description).not.toContain('](');
  });

  it('puts the slot role in the footer', async () => {
    const { embed } = await render({ eventId: EVENT_ID, role: 'tank' });
    expect(embed.footer?.text).toBe(`${COMMUNITY} · tank`);
  });
});
