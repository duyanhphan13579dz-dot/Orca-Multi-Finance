/** Client-side webhook config for price alerts (localStorage). */

export type WebhookProvider = "discord" | "slack" | "generic";

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  provider: WebhookProvider;
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

export function loadWebhookConfig(): WebhookConfig {
  if (typeof window === "undefined") return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
    const url = typeof parsed.url === "string" ? parsed.url.trim() : "";
    let provider: WebhookProvider =
      parsed.provider === "slack" || parsed.provider === "generic" || parsed.provider === "discord"
        ? parsed.provider
        : "discord";
    if (url && isDiscordWebhookUrl(url)) provider = "discord";
    const pollMs =
      typeof parsed.pollMs === "number" && parsed.pollMs >= 3_000 && parsed.pollMs <= 60_000
        ? parsed.pollMs
        : DEFAULT.pollMs;
    return {
      enabled: Boolean(parsed.enabled),
      url,
      provider,
      secret: typeof parsed.secret === "string" ? parsed.secret : "",
      pollMs,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveWebhookConfig(cfg: WebhookConfig): void {
  if (typeof window === "undefined") return;
  const url = cfg.url.trim();
  const provider = isDiscordWebhookUrl(url) ? "discord" : cfg.provider;
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
      secret: cfg.secret,
      pollMs,
    }),
  );
  window.dispatchEvent(new CustomEvent("orca-webhook-changed"));
}

export function isValidWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
