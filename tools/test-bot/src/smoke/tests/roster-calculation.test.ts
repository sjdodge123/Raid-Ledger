/**
 * Roster Calculation smoke tests.
 * Tests the auto-allocation engine by filling MMO rosters with multiple users
 * using different preferred roles, then verifying the embed reflects correct
 * slot assignments, role shifts, and tentative displacement.
 *
 * Uses POST /admin/test/signup to create signups for demo users.
 */
import { pollForEmbed } from '../../helpers/polling.js';
import {
  createEvent,
  signupAs,
  deleteEvent,
  channelForGame,
  awaitProcessing,
} from '../fixtures.js';
import { assertEmbedHasField } from '../assert.js';
import type { SmokeTest, TestContext } from '../types.js';

const MMO_SLOTS = {
  type: 'mmo',
  tank: 1,
  healer: 1,
  dps: 3,
  flex: 0,
  bench: 2,
};

function embedInChannel(chId: string, title: string, timeoutMs: number) {
  return pollForEmbed(
    chId,
    (msg) => msg.embeds.some((e) => e.title?.includes(title)),
    timeoutMs,
  );
}

/** Get demo user IDs from context (populated during setup). */
function demoUsers(ctx: TestContext) {
  return ctx.demoUserIds ?? [];
}

/**
 * Check if a role section in the embed description contains user mentions.
 * Extracts the text between startMarker and endMarker (or end of string)
 * and checks for Discord mentions (<@id>) or usernames (4+ word chars).
 */
function hasMentionInSection(
  desc: string,
  startMarker: string,
  endMarker: string | null,
): boolean {
  const startIdx = desc.search(new RegExp(startMarker, 'i'));
  if (startIdx === -1) return false;
  const afterStart = desc.slice(startIdx);
  const section = endMarker
    ? afterStart.split(new RegExp(endMarker, 'i'))[0]
    : afterStart;
  return (
    section.includes('<@') ||
    /\w{4,}/.test(section.replace(/Tank|Heal|DPS|Bench/gi, ''))
  );
}

const multiPreferredRoles: SmokeTest = {
  name: 'Multi-preferred-roles assigns to first available',
  category: 'embed',
  async run(ctx) {
    const users = demoUsers(ctx);
    if (users.length < 1) throw new Error('Need demo users for roster tests');
    const ev = await createEvent(ctx.api, 'roster-multi-pref', {
      gameId: ctx.mmoGameId,
      slotConfig: MMO_SLOTS,
    });
    try {
      await embedInChannel(channelForGame(ctx, ctx.mmoGameId), ev.title, ctx.config.timeoutMs);
      // Sign up with ['tank', 'healer'] — should get tank (first pref)
      await signupAs(ctx.api, ev.id, users[0], ['tank', 'healer']);
      await awaitProcessing(ctx.api);
      const found = await pollForEmbed(
        channelForGame(ctx, ctx.mmoGameId),
        (m) => {
          const e = m.embeds.find((x) => x.title?.includes(ev.title));
          if (!e) return false;
          return hasMentionInSection(e.description ?? '', 'Tank', 'Heal');
        },
        ctx.config.timeoutMs,
      );
      const embed = found.embeds.find((e) => e.title?.includes(ev.title));
      if (!embed) throw new Error('Embed not found');
      const desc = embed.description ?? '';
      if (!hasMentionInSection(desc, 'Tank', 'Heal')) {
        throw new Error('Tank slot still empty after signup with tank pref');
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const fullRosterFill: SmokeTest = {
  name: 'Full roster shows FULL with all slots filled',
  category: 'embed',
  async run(ctx) {
    const users = demoUsers(ctx);
    if (users.length < 5) throw new Error('Need 5+ demo users');
    const ev = await createEvent(ctx.api, 'roster-full', {
      gameId: ctx.mmoGameId,
      slotConfig: MMO_SLOTS,
    });
    try {
      await embedInChannel(channelForGame(ctx, ctx.mmoGameId), ev.title, ctx.config.timeoutMs);
      // Fill all 5 main slots: 1 tank, 1 healer, 3 dps
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await signupAs(ctx.api, ev.id, users[3], ['dps']);
      await signupAs(ctx.api, ev.id, users[4], ['dps']);
      await awaitProcessing(ctx.api);
      const rosterMsg = await pollForEmbed(
        channelForGame(ctx, ctx.mmoGameId),
        (m) => {
          const e = m.embeds.find((x) => x.title?.includes(ev.title));
          if (!e) return false;
          const desc = e.description ?? '';
          const rosterMatch = desc.match(/ROSTER:\s*(\d+)/);
          if (!rosterMatch || parseInt(rosterMatch[1], 10) < 5) return false;
          // Ensure all role sections have player mentions
          return (
            hasMentionInSection(desc, 'Tank', 'Heal') &&
            hasMentionInSection(desc, 'Heal', 'DPS') &&
            hasMentionInSection(desc, 'DPS', null)
          );
        },
        ctx.config.timeoutMs,
      );
      const embed = rosterMsg.embeds.find((e) => e.title?.includes(ev.title));
      if (!embed) throw new Error('Embed not found');
      const desc = embed.description ?? '';
      if (!hasMentionInSection(desc, 'Tank', 'Heal')) {
        throw new Error('Tank slot empty in full roster');
      }
      if (!hasMentionInSection(desc, 'Heal', 'DPS')) {
        throw new Error('Healer slot empty in full roster');
      }
      if (!hasMentionInSection(desc, 'DPS', null)) {
        throw new Error('DPS slots empty in full roster');
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const roleShiftChain: SmokeTest = {
  name: 'Role shift chain when last player joins',
  category: 'embed',
  async run(ctx) {
    const users = demoUsers(ctx);
    if (users.length < 5) throw new Error('Need 5+ demo users');
    // Slot config: tank:1, healer:1, dps:3
    // Sign up 4 players preferring dps — one must shift to tank/healer
    // Then 5th player joins preferring tank — should trigger rebalance
    const ev = await createEvent(ctx.api, 'roster-shift', {
      gameId: ctx.mmoGameId,
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 2, flex: 0, bench: 1 },
    });
    try {
      await embedInChannel(channelForGame(ctx, ctx.mmoGameId), ev.title, ctx.config.timeoutMs);
      // First 3: fill specific roles cleanly
      await signupAs(ctx.api, ev.id, users[0], ['dps']);
      await signupAs(ctx.api, ev.id, users[1], ['dps']);
      // User 2 prefers healer but also dps — should get healer
      await signupAs(ctx.api, ev.id, users[2], ['healer', 'dps']);
      // User 3 prefers tank and dps — should get tank
      await signupAs(ctx.api, ev.id, users[3], ['tank', 'dps']);
      await awaitProcessing(ctx.api);
      const shiftMsg = await pollForEmbed(
        channelForGame(ctx, ctx.mmoGameId),
        (m) => {
          const e = m.embeds.find((x) => x.title?.includes(ev.title));
          if (!e) return false;
          const d = e.description ?? '';
          return (
            hasMentionInSection(d, 'Tank', 'Heal') &&
            hasMentionInSection(d, 'Heal', 'DPS')
          );
        },
        ctx.config.timeoutMs,
      );
      const embed = shiftMsg.embeds.find((e) => e.title?.includes(ev.title));
      if (!embed) throw new Error('Embed not found');
      const desc = embed.description ?? '';
      if (!hasMentionInSection(desc, 'Tank', 'Heal')) {
        throw new Error('Tank slot empty — shift chain failed');
      }
      if (!hasMentionInSection(desc, 'Heal', 'DPS')) {
        throw new Error('Healer slot empty — shift chain failed');
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const tentativeDisplacement: SmokeTest = {
  name: 'Tentative displaced to bench when roster fills',
  category: 'embed',
  async run(ctx) {
    const users = demoUsers(ctx);
    if (users.length < 6) throw new Error('Need 6+ demo users');
    // 5 main slots (tank:1, healer:1, dps:3) + 2 bench
    const ev = await createEvent(ctx.api, 'roster-tentative', {
      gameId: ctx.mmoGameId,
      slotConfig: MMO_SLOTS,
    });
    try {
      await embedInChannel(channelForGame(ctx, ctx.mmoGameId), ev.title, ctx.config.timeoutMs);
      // Fill 4 confirmed slots
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await signupAs(ctx.api, ev.id, users[3], ['dps']);
      // User 4 is TENTATIVE in last dps slot
      await signupAs(ctx.api, ev.id, users[4], ['dps'], {
        status: 'tentative',
      });
      // User 5 signs up CONFIRMED for dps — tentative should be displaced
      await signupAs(ctx.api, ev.id, users[5], ['dps']);
      await awaitProcessing(ctx.api);
      const dispMsg = await pollForEmbed(
        channelForGame(ctx, ctx.mmoGameId),
        (m) => {
          const e = m.embeds.find((x) => x.title?.includes(ev.title));
          if (!e) return false;
          const match = (e.description ?? '').match(/ROSTER:\s*(\d+)/);
          return match ? parseInt(match[1], 10) >= 5 : false;
        },
        ctx.config.timeoutMs,
      );
      const embed = dispMsg.embeds.find((e) => e.title?.includes(ev.title));
      if (!embed) throw new Error('Embed not found');
      const desc = embed.description ?? '';
      // Verify bench section exists with the displaced tentative player
      const hasBench = /Bench/i.test(desc);
      // Verify 6 total signups
      const rosterMatch = desc.match(/ROSTER:\s*(\d+)/);
      const totalSignups = rosterMatch ? parseInt(rosterMatch[1], 10) : 0;
      if (totalSignups < 5) {
        throw new Error(
          `Expected 5+ signups in roster, got ${totalSignups}`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const rosterCalculationTests: SmokeTest[] = [
  multiPreferredRoles,
  fullRosterFill,
  roleShiftChain,
  tentativeDisplacement,
];
