/** Client-side webhook config for price alerts (localStorage). */

export type WebhookProvider = "discord" | "slack" | "generic";

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  provider: WebhookProvider;
  /** Optional secret header value (X-Orca-Secret) — also sent to our proxy */
  secret: string;
}

const KEY = "orca.alert-webhook.v1";

const DEFAULT: WebhookConfig = {
  enabled: false,
  url: "",
  provider: "discord",
  secret: "",
};

export function loadWebhookConfig(): WebhookConfig {
  if (typeof window === "undefined") return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      url: typeof parsed.url === "string" ? parsed.url.trim() : "",
      provider:
        parsed.provider === "slack" || parsed.provider === "generic" || parsed.provider === "discord"
          ? parsed.provider
          : "discord",
      secret: typeof parsed.secret === "string" ? parsed.secret : "",
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveWebhookConfig(cfg: WebhookConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    KEY,
    JSON.stringify({
      enabled: cfg.enabled,
      url: cfg.url.trim(),
      provider: cfg.provider,
      secret: cfg.secret,
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
