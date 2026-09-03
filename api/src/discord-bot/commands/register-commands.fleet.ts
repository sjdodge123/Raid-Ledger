/**
 * Fleet-slot-bot detection + the plain-language log lines that go with it.
 *
 * WHY THIS EXISTS (A3-B P5)
 * -------------------------
 * Since ROK-1469 every rl-infra runner slot owns its OWN Discord application,
 * and `env-spin` injects that app's credentials into the env container as
 * `RL_SLOT_DISCORD_*`. All of those apps — plus the shared app the operator's
 * local dev env uses — were registering the same nine commands GLOBALLY.
 *
 * Global registration has two properties that cost the operator two failed
 * test attempts on 2026-09-03:
 *   1. Every application that registers `/bind` globally contributes its OWN
 *      entry to the guild's command picker. Four apps -> four identical-looking
 *      `/bind` rows, three of them labelled with a truncated "Raid Ledger…".
 *   2. A global registration survives the death of the env that made it. Pick
 *      the wrong row and Discord routes the interaction to an application whose
 *      container no longer exists: "The application did not respond", and
 *      nothing at all in the live env's logs.
 *
 * Guild-scoped registration fixes (1) only partially — a dead slot app's guild
 * commands also linger until something deletes them — but it makes propagation
 * instant instead of Discord's up-to-an-hour global cache, and it confines the
 * blast radius to the test guild. Deregistration on env destroy is the other
 * half of the fix and lives in `rl-infra/orchestrator/bin/env-destroy`.
 *
 * PRODUCTION SAFETY: the real bot never sets `RL_SLOT_DISCORD_CLIENT_ID`, so
 * `isFleetSlotBot()` is false there and the global-registration path is byte
 * for byte what it was. Nothing in this module runs for a real guild.
 */

/** Env var `env-spin` writes into fleet env containers that have a slot bot. */
export const FLEET_SLOT_CLIENT_ID_ENV = 'RL_SLOT_DISCORD_CLIENT_ID';
/** Optional, PUBLIC portal app name for the same slot bot. */
export const FLEET_SLOT_APP_NAME_ENV = 'RL_SLOT_DISCORD_APP_NAME';

function envValue(name: string): string | undefined {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** The application id `env-spin` says this container's bot belongs to. */
export function declaredFleetClientId(): string | undefined {
  return envValue(FLEET_SLOT_CLIENT_ID_ENV);
}

/**
 * True only inside an rl-infra fleet env whose slot has its own Discord app.
 * A fleet env with no slot identity falls back to the shared app and keeps the
 * unchanged production path — it is not ours to re-scope.
 */
export function isFleetSlotBot(): boolean {
  return declaredFleetClientId() !== undefined;
}

/** Human-readable app label for logs: id plus the portal name when known. */
export function fleetAppLabel(clientId: string): string {
  const name = envValue(FLEET_SLOT_APP_NAME_ENV);
  return name ? `application ${clientId} ("${name}")` : `application ${clientId}`;
}

/**
 * The ONE ambiguity a running env can actually detect (see the note in
 * `register-commands.ts`): the app id `env-spin` injected disagrees with the
 * app the bot token actually logged in as.
 */
export function identityMismatchMessage(
  declared: string,
  actual: string,
): string {
  return [
    `[fleet] Slot bot identity MISMATCH: ${FLEET_SLOT_CLIENT_ID_ENV}=${declared}`,
    `but the configured bot token logged in as application ${actual}.`,
    `Slash commands are being registered under ${actual}; OAuth uses ${declared}.`,
    'The slot .env entries are crossed — fix RL_SLOT_<N>_DISCORD_* in /srv/rl-infra/.env.',
  ].join(' ');
}

/** Success line: names the app, the guild, and every command registered. */
export function guildScopeMessage(
  clientId: string,
  guildId: string,
  commandNames: string[],
): string {
  return [
    `[fleet] Registered ${commandNames.length} GUILD-scoped slash command(s)`,
    `for ${fleetAppLabel(clientId)} in guild ${guildId}:`,
    `${commandNames.join(', ')}.`,
    'Discord shows one picker entry PER APPLICATION and gives no API to list',
    'other applications’ commands, so duplicates cannot be detected from here:',
    `if the picker shows more than one /${commandNames[0] ?? 'bind'}, the others`,
    `belong to a different application and this env (${clientId}) will never`,
    'see their interactions.',
  ].join(' ');
}

/** Refusal line: a slot bot with no guild must register NOTHING. */
export function noGuildMessage(clientId: string): string {
  return [
    `[fleet] Slot bot ${fleetAppLabel(clientId)} is not in a guild —`,
    'registering NO slash commands.',
    'Global registration is deliberately skipped for slot bots: it leaks',
    'entries into every guild the app has ever joined and they outlive the env.',
    'Re-invite this bot to the test guild, then restart the env.',
  ].join(' ');
}

/** Cleanup line: our OWN stale global registrations, named. */
export function staleGlobalMessage(
  clientId: string,
  commandNames: string[],
): string {
  return [
    `[fleet] Slot bot ${fleetAppLabel(clientId)} still had ${commandNames.length}`,
    `GLOBAL command(s) registered (${commandNames.join(', ')}).`,
    'Those appear in every guild the app is in and survive env destroy —',
    'deleting them now so the picker only shows this guild’s entry.',
  ].join(' ');
}
