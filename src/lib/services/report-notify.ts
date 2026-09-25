import "server-only";

export type ReportNotifyPayload = {
  type: string;
  title: string;
  subtitle?: string;
  generatedAt: string;
};

type NotifyEntry = ReportNotifyPayload & { id: string; at: number };

const g = globalThis as typeof globalThis & { __orcaReportNotifies?: NotifyEntry[] };

function store(): NotifyEntry[] {
  if (!g.__orcaReportNotifies) g.__orcaReportNotifies = [];
  return g.__orcaReportNotifies;
}

/**
 * After a daily report is persisted: keep a short in-memory feed for the UI
 * and optionally POST to REPORT_WEBHOOK_URL / DISCORD (env).
 */
export async function dispatchReportReadyNotify(payload: ReportNotifyPayload): Promise<void> {
  const entry: NotifyEntry = {
    ...payload,
    id: `${payload.type}-${payload.generatedAt}`,
    at: Date.now(),
  };
  const list = store();
  list.unshift(entry);
  if (list.length > 30) list.length = 30;

  const webhook =
    process.env.REPORT_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_REPORT_WEBHOOK?.trim() ||
    process.env.DISCORD_WEBHOOK_URL?.trim();

  if (!webhook) return;

  const typeLabel: Record<string, string> = {
    morning_brief: "Morning Brief",
    intraday_brief: "Intraday Brief",
    market_summary: "Market Summary",
    strategy: "Weekly Strategy",
  };
  const label = typeLabel[payload.type] ?? payload.type;
  const content =
    `**ORCA · ${label} sẵn sàng**\n` +
    `${payload.title}\n` +
    (payload.subtitle ? `_${payload.subtitle}_\n` : "") +
    `<https://orca-multi-finance.vercel.app/reports>`;

  try {
    const isDiscord = /discord\.com\/api\/webhooks/i.test(webhook);
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isDiscord
          ? { content: content.slice(0, 1900) }
          : { text: content, type: payload.type, title: payload.title, at: payload.generatedAt },
      ),
    });
  } catch {
    /* non-fatal */
  }
}

export function listRecentReportNotifies(limit = 10): NotifyEntry[] {
  return store().slice(0, limit);
}
