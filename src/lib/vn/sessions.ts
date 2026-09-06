/**
 * VIETNAM MARKET SESSION ENGINE — the platform understands the Vietnamese
 * exchange calendar instead of labelling LIVE purely off recent responses.
 *
 * HOSE/HNX sessions (giờ VN, utc+7):
 *   09:00–09:15  Opening auction (ATO)
 *   09:15–11:30  Continuous trading, morning
 *   11:30–13:00  Lunch break
 *   13:00–14:30  Continuous trading, afternoon
 *   14:30–14:45  Closing auction (ATC)
 *   14:45–15:00  Negotiated/post-trading
 * Weekends & published holidays → closed.
 */

export type VnSessionState =
  | "pre_open"
  | "opening_auction"
  | "morning_continuous"
  | "lunch_break"
  | "afternoon_continuous"
  | "closing_auction"
  | "post_trading"
  | "weekend_closed"
  | "holiday_closed"
  | "closed";

export interface VnSessionInfo {
  state: VnSessionState;
  labelVi: string;
  open: boolean;
  trading: boolean; // continuous matching in progress
  sessionDate: string; // YYYY-MM-DD VN
  checkedAt: string;
}

/* ~VN public holidays with market closures (natural + substituted dates).
   Refresh annually; engine remains correct for ordinary business days regardless. */
const HOLIDAYS: Set<string> = new Set([
  // 2025
  "2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31",
  "2025-04-07", "2025-04-30", "2025-05-01", "2025-09-01", "2025-09-02",
  // 2026 (projected from lunar calendar where applicable)
  "2026-01-01", "2026-01-02",
  "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
  "2026-04-07", "2026-04-30", "2026-05-01", "2026-09-02",
]);

function vnNow(): { date: Date; dateStr: string; minutes: number; dow: number } {
  const now = new Date(Date.now() + 7 * 3_600_000 + new Date().getTimezoneOffset() * 60_000);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const dateStr = now.toISOString().slice(0, 10);
  return { date: now, dateStr, minutes, dow: now.getDay() };
}

/** Pure classifier — exported for deterministic tests. */
export function classifySession(dateStr: string, minutes: number, dow: number): VnSessionState {
  const isHoliday = HOLIDAYS.has(dateStr);
  const weekend = dow === 0 || dow === 6;

  if (isHoliday) return "holiday_closed";
  if (weekend) return "weekend_closed";
  if (minutes >= 9 * 60 && minutes < 9 * 60 + 15) return "opening_auction";
  if (minutes >= 9 * 60 + 15 && minutes < 11 * 60 + 30) return "morning_continuous";
  if (minutes >= 11 * 60 + 30 && minutes < 13 * 60) return "lunch_break";
  if (minutes >= 13 * 60 && minutes < 14 * 60 + 30) return "afternoon_continuous";
  if (minutes >= 14 * 60 + 30 && minutes < 14 * 60 + 45) return "closing_auction";
  if (minutes >= 14 * 60 + 45 && minutes < 15 * 60) return "post_trading";
  if (minutes >= 8 * 60 && minutes < 9 * 60) return "pre_open";
  return "closed";
}

export function getVnSession(): VnSessionInfo {
  const { dateStr, minutes, dow } = vnNow();
  const state = classifySession(dateStr, minutes, dow);

  const labels: Record<VnSessionState, string> = {
    pre_open: "Trước giờ mở cửa",
    opening_auction: "ATO — Khớp lệnh mở cửa",
    morning_continuous: "Phiên sáng — khớp liên tục",
    lunch_break: "Nghỉ trưa",
    afternoon_continuous: "Phiên chiều — khớp liên tục",
    closing_auction: "ATC — Khớp lệnh đóng cửa",
    post_trading: "Thỏa thuận sau giờ",
    weekend_closed: "Đóng cửa (cuối tuần)",
    holiday_closed: "Đóng cửa (nghỉ lễ)",
    closed: "Đã đóng cửa",
  };
  const trading = state === "morning_continuous" || state === "afternoon_continuous" || state === "opening_auction" || state === "closing_auction";
  return {
    state,
    labelVi: labels[state],
    open: state !== "weekend_closed" && state !== "holiday_closed" && state !== "closed",
    trading,
    sessionDate: dateStr,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Allowed data-age given the session state. During continuous trading, quotes
 * older than a few minutes are DELAYED; after close, the official closing data
 * legitimately stays FRESH until next session.
 */
export function allowedDataAgeMs(): number {
  const s = getVnSession();
  if (s.trading) return 10 * 60_000;
  if (s.state === "pre_open" || s.state === "lunch_break") return 60 * 60_000;
  return 18 * 3_600_000; // overnight: closing data is the latest valid truth
}

/**
 * SLA động theo phiên (Phase 2): cùng một dữ liệu cũ nhưng độ hợp lệ khác nhau
 * tuỳ trạng thái thị trường VN. Trong phiên → cửa sổ hẹp (pace realtime);
 * nghỉ trưa/pre-open → snapshot chốt phiên trước hợp lệ trong giờ;
 * ngoài phiên → dữ liệu chốt phiên là bản mới nhất hợp lệ (đêm/ngày lễ).
 */
export function vnSlasForSession(s: VnSessionInfo = getVnSession()): { liveSlaMs: number; freshSlaMs: number; delayedSlaMs: number } {
  if (s.trading) return { liveSlaMs: 30_000, freshSlaMs: 3 * 60_000, delayedSlaMs: 10 * 60_000 };
  if (s.state === "pre_open" || s.state === "lunch_break") return { liveSlaMs: 60 * 60_000, freshSlaMs: 2 * 3_600_000, delayedSlaMs: 18 * 3_600_000 };
  return { liveSlaMs: 18 * 3_600_000, freshSlaMs: 24 * 3_600_000, delayedSlaMs: 7 * 24 * 3_600_000 };
}

export function sessionFreshnessHint(state: VnSessionState): string {
  return {
    pre_open: "Chưa vào phiên — dữ liệu snapshot đóng cửa phiên trước là mới nhất",
    opening_auction: "Đang khớp ATO — giá dao động theo lệnh dự kiến",
    morning_continuous: "Phiên sáng — hệ thống ưu tiên tốc độ cập nhật",
    lunch_break: "Nghỉ trưa — dữ liệu 11:30 làmới nhất hợp lệ",
    afternoon_continuous: "Phiên chiều — hệ thống ưu tiên tốc độ cập nhật",
    closing_auction: "Khớp ATC — chuẩn bị chốt giá ngày",
    post_trading: "Sau giờ — dữ liệu chốt ngày chính thức",
    weekend_closed: "Cuối tuần — dữ liệu phiên thứ Sáu là mới nhất",
    holiday_closed: "Nghỉ lễ — dữ liệu phiên gần nhất là mới nhất",
    closed: "Ngoài giờ — dữ liệu chốt phiên là mới nhất",
  }[state];
}
