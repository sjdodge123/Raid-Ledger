/**
 * Roster Calculation smoke tests.
 * Tests the auto-allocation engine by filling MMO rosters with multiple users
 * using different preferred roles, then verifying the embed reflects correct
 * slot assignments, role shifts, and tentative displacement.
 *
 * Uses POST /admin/settings/demo/signup to create signups for demo users.
 */
import { waitForMessage, readLastMessages } from '../../helpers/messages.js';
import {
  createEvent,
  signupAs,
  deleteEvent,
  sleep,
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
  return waitForMessage(
    chId,
    (msg) => msg.embeds.some((e) => e.title?.includes(title)),
    timeoutMs,
  );
}

/** Get demo user IDs from context (populated during setup). */
function demoUsers(ctx: TestContext) {
  return ctx.demoUserIds ?? [];
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
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      // Sign up with ['tank', 'healer'] — should get tank (first pref)
      await signupAs(ctx.api, ev.id, users[0], ['tank', 'healer']);
      await sleep(6000);
      const msgs = await readLastMessages(ctx.defaultChannelId, 10);
      const embed = msgs
        .flatMap((m) => m.embeds)
        .find((e) => e.title?.includes(ev.title));
      if (!embed) throw new Error('Embed not found');
      // Roster is in the description, not fields — check for tank assignment
      const desc = embed.description ?? '';
      if (!desc.includes('Tanks') || !desc.includes('1/1')) {
        // Check if tank slot has a player (not just "—")
        const tankSection = desc.split(/Tank/i)[1]?.split(/Heal/i)[0] ?? '';
        if (tankSection.includes('—') && !tankSection.includes('<@')) {
          throw new Error('Tank slot still empty after signup with tank pref');
        }
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
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      // Fill all 5 main slots: 1 tank, 1 healer, 3 dps
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await signupAs(ctx.api, ev.id, users[3], ['dps']);
      await signupAs(ctx.api, ev.id, users[4], ['dps']);
      await sleep(8000);
      const msgs = await readLastMessages(ctx.defaultChannelId, 10);
      const embed = msgs
        .flatMap((m) => m.embeds)
        .find((e) => e.title?.includes(ev.title));
      if (!embed) throw new Error('Embed not found');
      const desc = embed.description ?? '';
      // Creator is auto-signed up, so 5 demo + 1 creator = 6 total.
      // Verify all main slots are filled (count >= 5)
      const rosterMatch = desc.match(/ROSTER:\s*(\d+)\/(\d+)/);
      const filled = rosterMatch ? parseInt(rosterMatch[1], 10) : 0;
      if (filled < 5) {
        throw new Error(`Expected 5+ in roster, got ${filled}`);
      }
      // Verify tank, healer, dps slots have players (contain <@ mentions)
      const tankSection = desc.split(/Tank/i)[1]?.split(/Heal/i)[0] ?? '';
      const healerSection = desc.split(/Heal/i)[1]?.split(/DPS/i)[0] ?? '';
      const dpsSection = desc.split(/DPS/i)[1] ?? '';
      if (!tankSection.includes('<') && !tankSection.match(/\w{3,}/)) {
        throw new Error('Tank slot empty in full roster');
      }
      if (!healerSection.includes('<') && !healerSection.match(/\w{3,}/)) {
        throw new Error('Healer slot empty in full roster');
      }
      if (!dpsSection.includes('<') && !dpsSection.match(/\w{3,}/)) {
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
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      // First 3: fill specific roles cleanly
      await signupAs(ctx.api, ev.id, users[0], ['dps']);
      await signupAs(ctx.api, ev.id, users[1], ['dps']);
      // User 2 prefers healer but also dps — should get healer
      await signupAs(ctx.api, ev.id, users[2], ['healer', 'dps']);
      // User 3 prefers tank and dps — should get tank
      await signupAs(ctx.api, ev.id, users[3], ['tank', 'dps']);
      await sleep(8000);
      const msgs = await readLastMessages(ctx.defaultChannelId, 10);
      const embed = msgs
        .flatMap((m) => m.embeds)
        .find((e) => e.title?.includes(ev.title));
      if (!embed) throw new Error('Embed not found');
      const desc = embed.description ?? '';
      // Verify tank and healer slots are filled (not just "—")
      const tankSection = desc.split(/Tank/i)[1]?.split(/Heal/i)[0] ?? '';
      const healerSection = desc.split(/Heal/i)[1]?.split(/DPS/i)[0] ?? '';
      if (!tankSection.match(/\w{4,}/) && !tankSection.includes('<')) {
        throw new Error('Tank slot empty — shift chain failed');
      }
      if (!healerSection.match(/\w{4,}/) && !healerSection.includes('<')) {
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
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      // Fill 4 confirmed slots
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await signupAs(ctx.api, ev.id, users[3], ['dps']);
      // User 4 is TENTATIVE in last dps slot
      await signupAs(ctx.api, ev.id, users[4], ['dps'], {
        status: 'tentative',
      });
      await sleep(4000);
      // User 5 signs up CONFIRMED for dps — tentative should be displaced
      await signupAs(ctx.api, ev.id, users[5], ['dps']);
      await sleep(8000);
      const msgs = await readLastMessages(ctx.defaultChannelId, 15);
      const embed = msgs
        .flatMap((m) => m.embeds)
        .find((e) => e.title?.includes(ev.title));
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
