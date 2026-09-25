import "server-only";
import { postGlobalDiscord } from "./discord-notify";

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

const TYPE_LABEL: Record<string, string> = {
  morning_brief: "Morning Brief",
  intraday_brief: "Intraday Brief",
  market_summary: "Market Summary",
  strategy: "Weekly Strategy",
};

const TYPE_COLOR: Record<string, number> = {
  morning_brief: 0xf59e0b,
  intraday_brief: 0x38bdf8,
  market_summary: 0x22c55e,
  strategy: 0xa78bfa,
};

/** After a daily report is persisted — notify shared Discord + in-memory feed. */
export async function dispatchReportReadyNotify(payload: ReportNotifyPayload): Promise<void> {
  const entry: NotifyEntry = {
    ...payload,
    id: `${payload.type}-${payload.generatedAt}`,
    at: Date.now(),
  };
  const list = store();
  list.unshift(entry);
  if (list.length > 30) list.length = 30;

  const label = TYPE_LABEL[payload.type] ?? payload.type;
  await postGlobalDiscord({
    title: `ORCA · ${label} sẵn sàng`,
    description:
      `${payload.title}\n` +
      (payload.subtitle ? `_${payload.subtitle}_\n` : "") +
      `\n[Mở Bản tin](https://orca-multi-finance.vercel.app/reports)`,
    color: TYPE_COLOR[payload.type] ?? 0x6366f1,
    username: "ORCA Reports",
    fields: [
      { name: "Loại", value: label, inline: true },
      {
        name: "Thời gian",
        value: new Date(payload.generatedAt).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
        }),
        inline: true,
      },
    ],
  });
}

export function listRecentReportNotifies(limit = 10): NotifyEntry[] {
  return store().slice(0, limit);
}
