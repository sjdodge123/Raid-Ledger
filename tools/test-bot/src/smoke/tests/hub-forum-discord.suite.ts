/**
 * Every hub ↔ Discord forum smoke test (ROK-2208, ROK-2260, ROK-2271, ROK-2272), in
 * run order — one import for `run.ts`, which sits at the max-lines limit.
 */
import type { SmokeTest } from "../types.js";
import { hubForumDiscordBindingTests } from "./hub-forum-discord-binding.test.js";
import { hubForumDiscordInboundTests } from "./hub-forum-discord-inbound.test.js";
import { hubForumDiscordOutboundTests } from "./hub-forum-discord-outbound.test.js";
import { hubForumDiscordSignupLineTests } from "./hub-forum-discord-signup-lines.test.js";
import { eventPlanningNonHubEventTests } from "./event-planning-nonhub-event.test.js";
import { hubPollForumTests } from "./hub-poll-forum.test.js";
import { eventPlanningNonHubPollTests } from "./event-planning-nonhub-poll.test.js";

export const hubForumDiscordTests: SmokeTest[] = [
  ...hubForumDiscordBindingTests,
  ...hubForumDiscordOutboundTests,
  ...hubForumDiscordSignupLineTests,
  ...eventPlanningNonHubEventTests,
  ...hubPollForumTests,
  ...eventPlanningNonHubPollTests,
  ...hubForumDiscordInboundTests,
];
