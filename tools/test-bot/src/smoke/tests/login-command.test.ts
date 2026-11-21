/**
 * ROK-2283 — `/login` hands the caller a private one-time sign-in link.
 *
 * Runs the real LoginCommand through POST /admin/test/slash-command as the
 * test bot (a guild member). Asserts the reply is ephemeral and carries ONE
 * link button to `<site>/signin-link#token=…`. The token is a credential: it
 * is never asserted on, printed or put in an error message.
 *
 * The per-member limit is 3 links per 10 minutes, so the test first clears
 * the bot's counter (DEMO_MODE `DELETE /admin/test/login-rate-limit/:id`);
 * re-runs against the same env never trip it.
 */
import type { SmokeTest, TestContext } from "../types.js";

interface LoginButton {
  type?: number;
  style?: number;
  label?: string;
  url?: string;
}

interface LoginResponse {
  content?: string;
  components?: { type?: number; components?: LoginButton[] }[];
  ephemeral?: boolean;
}

/** Discord's Link button style. */
const LINK_STYLE = 5;

async function invokeLogin(ctx: TestContext): Promise<LoginResponse> {
  return ctx.api.post<LoginResponse>("/admin/test/slash-command", {
    commandName: "login",
    options: {},
    discordUserId: ctx.testBotDiscordId,
    guildId: ctx.config.guildId,
    channelId: ctx.defaultChannelId,
  });
}

/** A failure summary that never includes the link (it carries the token). */
function describeReply(res: LoginResponse): string {
  const buttons = res.components?.flatMap((r) => r.components ?? []) ?? [];
  return JSON.stringify({
    content: res.content,
    ephemeral: res.ephemeral,
    buttons: buttons.map((b) => ({ style: b.style, label: b.label, hasUrl: !!b.url })),
  });
}

/** True when the URL is `<origin>/signin-link#token=<non-empty>`. */
function isSigninLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.pathname === "/signin-link" &&
    url.search === "" &&
    /^#token=.+/.test(url.hash)
  );
}

const loginReturnsPrivateSigninLink: SmokeTest = {
  name: "/login replies privately with a one-time /signin-link button",
  category: "command",
  async run(ctx) {
    await ctx.api.delete(`/admin/test/login-rate-limit/${ctx.testBotDiscordId}`);
    const res = await invokeLogin(ctx);
    if (res.ephemeral !== true) {
      throw new Error(`/login: reply must be ephemeral, got ${describeReply(res)}`);
    }
    if (!res.content?.includes("expires in 15 minutes")) {
      throw new Error(`/login: expected the link copy, got ${describeReply(res)}`);
    }
    const buttons = res.components?.flatMap((r) => r.components ?? []) ?? [];
    if (buttons.length !== 1) {
      throw new Error(`/login: expected exactly one button, got ${describeReply(res)}`);
    }
    const [button] = buttons;
    if (button?.style !== LINK_STYLE || !button.url || !isSigninLink(button.url)) {
      throw new Error(
        `/login: expected a Link button to /signin-link#token=…, got ${describeReply(res)}`,
      );
    }
  },
};

export const loginCommandTests: SmokeTest[] = [loginReturnsPrivateSigninLink];
