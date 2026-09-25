import "server-only";

/**
 * Single global Discord webhook for the whole ORCA deployment.
 * One channel receives: price alerts (any user) + daily report ready events.
 *
 * Env (priority):
 *   DISCORD_WEBHOOK_URL
 *   REPORT_WEBHOOK_URL
 *   DISCORD_REPORT_WEBHOOK
 */
export function getGlobalDiscordWebhook(): string | null {
  const u =
    process.env.DISCORD_WEBHOOK_URL?.trim() ||
    process.env.REPORT_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_REPORT_WEBHOOK?.trim() ||
    "";
  if (!u) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return u;
  } catch {
    return null;
  }
}

export function isDiscordWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "discord.com" || u.hostname === "discordapp.com") &&
      u.pathname.startsWith("/api/webhooks/")
    );
  } catch {
    return false;
  }
}

export type DiscordEmbedField = { name: string; value: string; inline?: boolean };

export type DiscordNotifyOpts = {
  title: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  username?: string;
  alreadyPostedUrl?: string | null;
};

/** Post an embed to the global Discord webhook (if configured). */
export async function postGlobalDiscord(opts: DiscordNotifyOpts): Promise<{
  ok: boolean;
  skipped: boolean;
  reason?: string;
}> {
  const webhook = getGlobalDiscordWebhook();
  if (!webhook) return { ok: false, skipped: true, reason: "no_DISCORD_WEBHOOK_URL" };
  if (opts.alreadyPostedUrl && opts.alreadyPostedUrl === webhook) {
    return { ok: true, skipped: true, reason: "already_posted_same_url" };
  }

  const payload = {
    username: opts.username || "ORCA Financial",
    embeds: [
      {
        title: opts.title.slice(0, 250),
        description: opts.description?.slice(0, 2000),
        color: opts.color ?? 0x6366f1,
        fields: opts.fields?.slice(0, 25),
        timestamp: new Date().toISOString(),
        footer: { text: "ORCA Multi-Finance · shared channel" },
      },
    ],
  };

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Orca-Multi-Finance/1.0",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, skipped: false, reason: `http_${res.status}:${text.slice(0, 120)}` };
    }
    return { ok: true, skipped: false };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      reason: e instanceof Error ? e.message : "fetch_failed",
    };
  }
}
