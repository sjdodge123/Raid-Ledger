import { getGuild } from "../client.js";
import { findEphemeralVoiceSince, formatEphemeralLeakReport } from "./ephemeral-leak.js";

/**
 * Warn — loudly, with a count — about ephemeral voice channels created during
 * this run that are still standing (INV-DEV-GUILD-FLOOD-2026-10-15). A warning,
 * not a failure: a concurrent run sharing the guild can own a live one.
 */
export async function reportEphemeralLeaks(runStartMs: number): Promise<void> {
  try {
    const channels = await getGuild().channels.fetch();
    const typed = [...channels.values()].flatMap((c) =>
      c ? [{ id: c.id, name: c.name, type: c.type }] : [],
    );
    const leaks = findEphemeralVoiceSince(typed, runStartMs);
    const githubActions = process.env.GITHUB_ACTIONS === "true";
    for (const line of formatEphemeralLeakReport(leaks, runStartMs, githubActions)) {
      console.log(line);
    }
  } catch (err) {
    console.warn(`  Ephemeral voice census skipped: ${String(err)}`);
  }
}
