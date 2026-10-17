/**
 * DemoTestRenderDmEmbedController — POST /admin/test/render-dm-embed.
 *
 * Runs the REAL DiscordNotificationEmbedService (only SettingsService is
 * mocked), so the chrome assertions below pin what the builder renders, not
 * what a mock echoes back.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DemoTestRenderDmEmbedController } from './demo-test-render-dm-embed.controller';
import { DiscordNotificationEmbedService } from '../notifications/discord-notification-embed.service';
import { SettingsService } from '../settings/settings.service';
import { colorForState } from '../discord-bot/embeds/embed-chrome.helpers';

jest.mock(
  'discord.js',
  () => jest.requireActual('../common/testing/discord-js-mock').discordJsMock,
);

const COMMUNITY = 'Render Guild';

function makeSettings(
  opts: { demoMode?: boolean; communityName?: string | null } = {},
) {
  return {
    getDemoMode: jest.fn().mockResolvedValue(opts.demoMode ?? true),
    getBranding: jest.fn().mockResolvedValue({
      communityName:
        opts.communityName === undefined ? COMMUNITY : opts.communityName,
    }),
    getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
  };
}

function makeController(settings = makeSettings()) {
  const s = settings as unknown as SettingsService;
  return new DemoTestRenderDmEmbedController(
    s,
    new DiscordNotificationEmbedService(s),
  );
}

const REMINDER_BODY = {
  type: 'event_reminder',
  title: 'Raid starts soon',
  message: 'Your event starts in 15 minutes.',
  payload: { eventId: 42, eventTitle: 'Thursday Raid' },
};

type EmbedJson = {
  author?: { name?: string };
  footer?: { text?: string };
  color?: number;
};

const originalDemoMode = process.env.DEMO_MODE;

beforeEach(() => {
  delete process.env.CLIENT_URL;
  process.env.DEMO_MODE = 'true';
});

afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalDemoMode;
});

describe('DemoTestRenderDmEmbedController — POST /admin/test/render-dm-embed', () => {
  it('refuses outside DEMO_MODE (env flag off)', async () => {
    process.env.DEMO_MODE = 'false';
    await expect(
      makeController().renderDmEmbed(REMINDER_BODY),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the demo-mode setting is off', async () => {
    const controller = makeController(makeSettings({ demoMode: false }));
    await expect(
      controller.renderDmEmbed(REMINDER_BODY),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unknown notification type with 400', async () => {
    await expect(
      makeController().renderDmEmbed({ ...REMINDER_BODY, type: 'not_a_type' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renders event_reminder DM chrome from the real builder', async () => {
    const result = await makeController().renderDmEmbed(REMINDER_BODY);
    const embed = result.embed as EmbedJson;

    expect(result.communityName).toBe(COMMUNITY);
    expect(embed.author?.name).toBe(COMMUNITY);
    expect(embed.footer?.text).toBe(`${COMMUNITY} · Event Reminder`);
    expect(embed.color).toBe(colorForState('needs_you'));
    expect(result.components.length).toBeGreaterThanOrEqual(1);
    expect(result.components[0]?.components.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to 'Raid Ledger' when no community name is configured", async () => {
    const controller = makeController(makeSettings({ communityName: null }));
    const result = await controller.renderDmEmbed(REMINDER_BODY);
    const embed = result.embed as EmbedJson;

    expect(result.communityName).toBe('Raid Ledger');
    expect(embed.author?.name).toBe('Raid Ledger');
    expect(embed.footer?.text).toBe('Raid Ledger · Event Reminder');
  });
});

describe('render-dm-embed — input bounds and row order', () => {
  it('rejects an empty message with 400 (the builder throws on it)', async () => {
    await expect(
      makeController().renderDmEmbed({ ...REMINDER_BODY, message: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a title the emoji prefix would push past 256 with 400', async () => {
    await expect(
      makeController().renderDmEmbed({
        ...REMINDER_BODY,
        title: 'x'.repeat(251),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('orders rows as sendEmbedDM does: extra rows first, primary row last', async () => {
    const result = await makeController().renderDmEmbed(REMINDER_BODY);
    const labels = result.components.map((r) =>
      r.components.map((c) => ('label' in c ? c.label : undefined)),
    );

    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual(['Roach Out', 'Running Late']);
    expect(labels[labels.length - 1]).toContain('Adjust Notifications');
  });
});
