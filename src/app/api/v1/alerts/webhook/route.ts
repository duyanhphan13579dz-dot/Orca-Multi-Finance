import { NextRequest } from "next/server";
import { badRequest, fail, ok } from "@/lib/envelope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  url?: string;
  provider?: "discord" | "slack" | "generic";
  title?: string;
  body?: string;
  symbol?: string;
  price?: number;
  targetPrice?: number;
  direction?: string;
  reason?: string;
  secret?: string;
  color?: number;
};

function discordPayload(b: Body) {
  const lines = [
    b.body,
    b.symbol ? `**Mã:** ${b.symbol}` : null,
    b.price != null ? `**Giá:** ${b.price}` : null,
    b.targetPrice != null ? `**Mức:** ${b.targetPrice}` : null,
    b.direction ? `**Điều kiện:** ${b.direction}` : null,
    b.reason ? `**Lý do:** ${b.reason}` : null,
  ].filter(Boolean);
  return {
    embeds: [
      {
        title: b.title || "Orca — Cảnh báo giá",
        description: lines.join("\n"),
        color: b.color ?? 0xa78bfa,
        timestamp: new Date().toISOString(),
        footer: { text: "Orca Multi-Finance" },
      },
    ],
  };
}

function slackPayload(b: Body) {
  const text = [b.title || "Orca — Cảnh báo giá", b.body, b.symbol && `Mã: ${b.symbol}`, b.price != null && `Giá: ${b.price}`]
    .filter(Boolean)
    .join("\n");
  return { text };
}

function genericPayload(b: Body) {
  return {
    event: "price_alert",
    title: b.title || "Orca — Cảnh báo giá",
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
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return badRequest("invalid url");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return badRequest("url must be http(s)");
    }

    const provider = b.provider ?? "discord";
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
      signal: AbortSignal.timeout(12_000),
    });

    const text = await upstream.text().catch(() => "");
    if (!upstream.ok) {
      return fail(
        "WEBHOOK_UPSTREAM",
        `Webhook responded ${upstream.status}: ${text.slice(0, 200)}`,
        502,
      );
    }
    return ok({ delivered: true, status: upstream.status, provider });
  } catch (e) {
    return fail("WEBHOOK_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
