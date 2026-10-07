/** Client-side webhook config for price alerts (localStorage). */

export type WebhookProvider = "discord" | "slack" | "telegram" | "generic";

export interface WebhookConfig {
  enabled: boolean;
  /**
   * Discord/Slack/generic: full webhook URL.
   * Telegram: Bot token from @BotFather (e.g. 123456:ABC-DEF...).
   */
  url: string;
  provider: WebhookProvider;
  /**
   * Discord/Slack: optional shared secret header.
   * Telegram: chat_id (user or group, e.g. 123456789 or -100...).
   */
  secret: string;
  /** Poll interval for price monitor (ms). Default 5000. */
  pollMs: number;
}

const KEY = "orca.alert-webhook.v1";

const DEFAULT: WebhookConfig = {
  enabled: false,
  url: "",
  provider: "discord",
  secret: "",
  pollMs: 5_000,
};

export function isDiscordWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:") return false;
    return (
      (u.hostname === "discord.com" || u.hostname === "discordapp.com") &&
      u.pathname.startsWith("/api/webhooks/")
    );
  } catch {
    return false;
  }
}

/** Telegram bot tokens look like 123456789:AAH... (no spaces). */
export function looksLikeTelegramToken(s: string): boolean {
  return /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(s.trim());
}

export function detectProvider(url: string, current?: WebhookProvider): WebhookProvider {
  if (isDiscordWebhookUrl(url)) return "discord";
  if (url.toLowerCase().includes("hooks.slack.com")) return "slack";
  if (looksLikeTelegramToken(url)) return "telegram";
  return current ?? "generic";
}

export function loadWebhookConfig(): WebhookConfig {
  if (typeof window === "undefined") return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
    const url = typeof parsed.url === "string" ? parsed.url.trim() : "";
    let provider: WebhookProvider =
      parsed.provider === "slack" ||
      parsed.provider === "generic" ||
      parsed.provider === "discord" ||
      parsed.provider === "telegram"
        ? parsed.provider
        : "discord";
    provider = detectProvider(url, provider);
    const pollMs =
      typeof parsed.pollMs === "number" && parsed.pollMs >= 3_000 && parsed.pollMs <= 60_000
        ? parsed.pollMs
        : DEFAULT.pollMs;
    return {
      enabled: Boolean(parsed.enabled),
      url,
      provider,
      secret: typeof parsed.secret === "string" ? parsed.secret.trim() : "",
      pollMs,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveWebhookConfig(cfg: WebhookConfig): void {
  if (typeof window === "undefined") return;
  const url = cfg.url.trim();
  const provider = detectProvider(url, cfg.provider);
  const pollMs =
    typeof cfg.pollMs === "number" && cfg.pollMs >= 3_000 && cfg.pollMs <= 60_000
      ? cfg.pollMs
      : DEFAULT.pollMs;
  localStorage.setItem(
    KEY,
    JSON.stringify({
      enabled: cfg.enabled,
      url,
      provider,
      secret: cfg.secret.trim(),
      pollMs,
    }),
  );
  window.dispatchEvent(new CustomEvent("orca-webhook-changed"));
}

export function isValidWebhookUrl(url: string, provider?: WebhookProvider): boolean {
  if (provider === "telegram" || looksLikeTelegramToken(url)) {
    return looksLikeTelegramToken(url);
  }
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function isValidTelegramConfig(token: string, chatId: string): boolean {
  return looksLikeTelegramToken(token) && /^-?\d{5,}$/.test(chatId.trim());
}
