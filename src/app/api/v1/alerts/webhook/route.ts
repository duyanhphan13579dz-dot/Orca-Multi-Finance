import { NextRequest } from "next/server";
import { badRequest, fail, ok } from "@/lib/envelope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  url?: string;
  provider?: "discord" | "slack" | "telegram" | "generic";
  title?: string;
  body?: string;
  symbol?: string;
  price?: number;
  targetPrice?: number;
  direction?: string;
  reason?: string;
  secret?: string;
  color?: number;
  chatId?: string;
};

function isDiscordUrl(url: string): boolean {
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

function looksLikeTelegramToken(s: string): boolean {
  return /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(s.trim());
}

function discordPayload(b: Body) {
  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (b.symbol) fields.push({ name: "Ma", value: "`" + b.symbol + "`", inline: true });
  if (b.price != null) fields.push({ name: "Gia", value: String(b.price), inline: true });
  if (b.targetPrice != null) fields.push({ name: "Muc", value: String(b.targetPrice), inline: true });
  if (b.direction) fields.push({ name: "Dieu kien", value: String(b.direction), inline: true });
  if (b.reason) fields.push({ name: "Ly do", value: b.reason.slice(0, 200), inline: false });
  return {
    username: "Orca Alerts",
    embeds: [
      {
        title: b.title || "Orca — Canh bao gia",
        description: b.body || undefined,
        color: b.color ?? 0xa78bfa,
        fields: fields.length ? fields : undefined,
        timestamp: new Date().toISOString(),
        footer: { text: "Orca Multi-Finance" },
      },
    ],
  };
}

function slackPayload(b: Body) {
  const text = [b.title || "Orca — Canh bao gia", b.body, b.symbol && "Ma: " + b.symbol, b.price != null && "Gia: " + b.price]
    .filter(Boolean)
    .join("\n");
  return { text };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function telegramText(b: Body): string {
  const lines = [
    "<b>" + escapeHtml(b.title || "Orca — Canh bao gia") + "</b>",
    b.body ? escapeHtml(b.body) : null,
    b.symbol ? "<b>Ma:</b> " + escapeHtml(b.symbol) : null,
    b.price != null ? "<b>Gia:</b> " + b.price : null,
    b.targetPrice != null ? "<b>Muc:</b> " + b.targetPrice : null,
    b.direction ? "<b>Dieu kien:</b> " + escapeHtml(String(b.direction)) : null,
    b.reason ? "<b>Ly do:</b> " + escapeHtml(b.reason.slice(0, 200)) : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function genericPayload(b: Body) {
  return {
    event: "price_alert",
    title: b.title || "Orca — Canh bao gia",
    body: b.body ?? null,
    symbol: b.symbol ?? null,
    price: b.price ?? null,
    targetPrice: b.targetPrice ?? null,
    direction: b.direction ?? null,
    reason: b.reason ?? null,
    at: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Body;
    const url = typeof b.url === "string" ? b.url.trim() : "";
    if (!url) return badRequest("url is required");

    let provider = b.provider ?? "discord";
    if (isDiscordUrl(url)) provider = "discord";
    if (looksLikeTelegramToken(url) || provider === "telegram") provider = "telegram";

    if (provider === "telegram") {
      if (!looksLikeTelegramToken(url)) {
        return badRequest("telegram bot token invalid (format: 123456:AAH...)");
      }
      const chatId = (b.chatId || b.secret || "").trim();
      if (!/^-?\d{5,}$/.test(chatId)) {
        return badRequest("telegram chat_id required (secret field)");
      }
      const apiUrl = "https://api.telegram.org/bot" + url + "/sendMessage";
      const upstream = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Orca-Multi-Finance/1.0",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: telegramText(b),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await upstream.text().catch(() => "");
      if (!upstream.ok) {
        return fail(
          "WEBHOOK_UPSTREAM",
          "Telegram " + upstream.status + ": " + text.slice(0, 200),
          502,
        );
      }
      return ok({ delivered: true, status: upstream.status, provider: "telegram" });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return badRequest("invalid url");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return badRequest("url must be http(s)");
    }

    const payload =
      provider === "slack"
        ? slackPayload(b)
        : provider === "generic"
          ? genericPayload(b)
          : discordPayload(b);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Orca-Multi-Finance/1.0",
    };
    if (b.secret) headers["X-Orca-Secret"] = b.secret;

    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    const text = await upstream.text().catch(() => "");
    if (!upstream.ok) {
      return fail(
        "WEBHOOK_UPSTREAM",
        "Webhook responded " + upstream.status + ": " + text.slice(0, 200),
        502,
      );
    }
    return ok({ delivered: true, status: upstream.status, provider });
  } catch (e) {
    return fail("WEBHOOK_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
