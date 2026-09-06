import { buildFinancialProfile, type FinancialProfile, type FinancialGoal } from "../finance/financial-profile";
import { projectGoal, requiredMonthlySaving, runPortfolioScenario, type Holding } from "../finance/financial-math";
import { errResult, okResult, type ToolHandler, type ToolResult } from "./tool-types";

/**
 * PERSONAL FINANCE / WEALTH / SCENARIO TOOLS — deterministic, dựa trên FinancialProfile.
 * Profile thiếu → DATA_UNAVAILABLE (không đoán). Mọi số đều do math engine tính.
 */

type Profile = FinancialProfile;

const requireProfile = (ctx: { profile?: unknown }): { profile: Profile } | { error: ToolResult } => {
  const p = ctx.profile;
  if (!p) return { error: errResult("DATA_UNAVAILABLE", "Chưa có hồ sơ tài chính — người dùng cần tạo Financial Profile trước (xác nhận lưu trí nhớ tài chính).") };
  return { profile: p as Profile };
};

const fmtToolResult = <T>(data: T, note?: string): ToolResult<T> =>
  okResult(data, { trace: ["finance-math-engine"], note });

/* ------------------------------ personal finance --------------------------- */

export const personalFinanceTools: ToolHandler[] = [
  {
    spec: {
      name: "cash_flow",
      domain: "personal-finance",
      category: "data",
      description: "Dòng tiền hàng tháng: thu nhập, chi tiêu, dòng tiền tự do (free cash flow).",
      params: [],
      outputType: "{ income, expenses, freeCashFlow } (VNĐ, null khi thiếu)",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const d = r.profile.derive;
      return fmtToolResult({ income: d.cashFlow.income, expenses: d.cashFlow.expenses, freeCashFlow: d.cashFlow.freeCashFlow });
    },
  },
  {
    spec: {
      name: "net_worth",
      domain: "personal-finance",
      category: "data",
      description: "Tổng tài sản, tổng nợ, giá trị ròng (net worth).",
      params: [],
      outputType: "{ totalAssets, totalLiabilities, netWorth } (VNĐ)",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const p = r.profile.inputs;
      return fmtToolResult({ totalAssets: p.totalAssets, totalLiabilities: p.totalLiabilities, netWorth: r.profile.derive.netWorth.value });
    },
  },
  {
    spec: {
      name: "savings_rate",
      domain: "personal-finance",
      category: "analysis",
      description: "Tỷ lệ tiết kiệm = free cash flow / thu nhập gộp (%).",
      params: [],
      outputType: "{ pct, status, note }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const m = r.profile.derive.savingsRate;
      return fmtToolResult({
        pct: m.value != null ? m.value * 100 : null,
        status: m.value == null ? "UNAVAILABLE" : m.value >= 0.3 ? "GOOD" : m.value >= 0.1 ? "WATCH" : "POOR",
        note: m.value != null ? `Tiết kiệm ${(m.value * 100).toFixed(0)}% thu nhập gộp` : "Chưa đủ dữ liệu",
      });
    },
  },
  {
    spec: {
      name: "debt_to_income",
      domain: "personal-finance",
      category: "analysis",
      description: "Tỷ lệ nợ trên thu nhập (DTI) = trả nợ hàng tháng / thu nhập gộp (%).",
      params: [],
      outputType: "{ pct, status, note }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const m = r.profile.derive.debtToIncome;
      return fmtToolResult({
        pct: m.value != null ? m.value * 100 : null,
        status: m.value == null ? "UNAVAILABLE" : m.value <= 0.2 ? "GOOD" : m.value <= 0.36 ? "WATCH" : "POOR",
        note: m.value != null ? `Trả nợ ${(m.value * 100).toFixed(0)}% thu nhập gộp` : "Chưa đủ dữ liệu",
      });
    },
  },
  {
    spec: {
      name: "emergency_fund",
      domain: "personal-finance",
      category: "analysis",
      description: "Độ phủ quỹ khẩn cấp = tài sản thanh khoản / chi tiêu hàng tháng (tháng).",
      params: [],
      outputType: "{ months, targetMonths, status, note }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const p = r.profile;
      const m = p.derive.emergencyFund;
      const target = p.inputs.emergencyTargetMonths ?? 6;
      return fmtToolResult({
        months: m.value,
        targetMonths: target,
        status: m.value == null ? "UNAVAILABLE" : m.value >= target ? "GOOD" : m.value >= target / 2 ? "WATCH" : "POOR",
        note: m.value != null ? `Quỹ khẩn cấp ${m.value.toFixed(1)}/${target} tháng chi tiêu` : "Chưa đủ dữ liệu",
      });
    },
  },
  {
    spec: {
      name: "financial_health",
      domain: "personal-finance",
      category: "analysis",
      description: "Tổng điểm sức khỏe tài chính 0–100 (5 metric: savings rate, DTI, quỹ khẩn cấp, thanh khoản, đòn bẩy).",
      params: [],
      outputType: "{ overall, level, metrics }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const h = r.profile.derive.health;
      const metrics = Object.fromEntries(
        Object.entries(h.metrics).map(([k, m]) => [k, { value: m.value, score: m.score, status: m.status, note: m.note }]),
      );
      return fmtToolResult({ overall: h.overall, level: h.level, metrics });
    },
  },
  {
    spec: {
      name: "goal_progress",
      domain: "personal-finance",
      category: "data",
      description: "Tiến độ các mục tiêu tài chính (đã góp / mục tiêu, %).",
      params: [{ name: "goalId", type: "string", required: false, description: "Lọc theo id mục tiêu" }],
      outputType: "{ goals: [{ id, name, targetAmount, currentAmount, progressPct, onTrack }] }",
      requiresProfile: true,
    },
    async execute(args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const goals = r.profile.derive.goals.filter((g) => !args.goalId || g.goal.id === args.goalId);
      return fmtToolResult({
        goals: goals.map((g) => ({
          id: g.goal.id,
          name: g.goal.name,
          targetAmount: g.goal.targetAmount,
          currentAmount: g.achievedValue,
          progressPct: g.progressPct.value != null ? g.progressPct.value * 100 : null,
          onTrack: g.onTrack.value,
        })),
      });
    },
  },
  {
    spec: {
      name: "required_monthly_saving",
      domain: "personal-finance",
      category: "analysis",
      description: "Số tiền cần góp mỗi tháng để đạt mục tiêu đúng hạn (đầu tư kép).",
      params: [
        { name: "goalId", type: "string", required: true, description: "Id mục tiêu trong profile" },
        { name: "annualReturnPct", type: "number", required: false, min: 0, max: 30, description: "Thay thế lợi suất kỳ vọng của goal" },
      ],
      outputType: "{ goalId, monthly, totalContribution, yearsLeft, note }",
      requiresProfile: true,
    },
    async execute(args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const goalId = String(args.goalId ?? "");
      const goal: FinancialGoal | undefined = r.profile.inputs.goals.find((g) => g.id === goalId);
      if (!goal) return errResult("INVALID_INPUT", `Không tìm thấy goal "${goalId}" trong profile`);
      const yearsLeft = goal.targetYear != null ? Math.max(0, goal.targetYear - new Date().getFullYear()) : null;
      const rr = requiredMonthlySaving(
        goal.targetAmount,
        goal.currentAmount,
        args.annualReturnPct != null ? Number(args.annualReturnPct) : goal.annualReturnPct,
        yearsLeft,
      );
      if (!rr) return errResult("DATA_UNAVAILABLE", "Thiếu dữ liệu (năm mục tiêu, lợi suất) để tính góp hàng tháng");
      return fmtToolResult({
        goalId,
        monthly: rr.monthly,
        totalContribution: rr.totalContribution,
        yearsLeft: yearsLeft ?? null,
        annualReturnPct: args.annualReturnPct != null ? Number(args.annualReturnPct) : goal.annualReturnPct,
        note: rr.monthly === 0 ? "Đã đủ tiền cho mục tiêu — không cần góp thêm" : "Kết quả giả định lãi kép hàng tháng — model inference, không phải bảo đảm",
      });
    },
  },
];

/* --------------------------------- wealth ---------------------------------- */

export const wealthTools: ToolHandler[] = [
  {
    spec: {
      name: "get_portfolio",
      domain: "portfolio",
      category: "data",
      description: "Danh mục đầu tư: holdings theo lớp tài sản, giá trị, trọng số, sector, tiền tệ.",
      params: [],
      outputType: "{ total, holdings, allocation }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const p = r.profile;
      if (!p.inputs.holdings.length) return errResult("DATA_UNAVAILABLE", "Profile chưa có holdings nào");
      return fmtToolResult({
        total: p.derive.allocation?.total ?? null,
        holdings: p.inputs.holdings.map((h) => ({ id: h.id, label: h.label, assetClass: h.assetClass, value: h.value, sector: h.sector, currency: h.currency })),
        allocation: p.derive.allocation?.rows ?? null,
      });
    },
  },
  {
    spec: {
      name: "portfolio_return",
      domain: "portfolio",
      category: "analysis",
      description: "Lợi suất danh mục có trọng số (cần returnPct của từng holding trong profile).",
      params: [],
      outputType: "{ weightedReturnPct, provided, missing, note }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const prof = r.profile as Profile & { inputReturns?: Record<string, number | null> };
      const returns = (prof as unknown as { inputReturns?: Record<string, number | null> }).inputReturns ?? {};
      const holdings = r.profile.inputs.holdings.map((h) => ({ value: h.value, returnPct: h.id in returns ? returns[h.id] : null }));
      const total = holdings.reduce((a, h) => a + h.value, 0);
      let weighted = 0;
      let provided = 0;
      for (const h of holdings) {
        if (h.returnPct == null) continue;
        weighted += (h.value / total) * h.returnPct;
        provided += 1;
      }
      return fmtToolResult({
        weightedReturnPct: provided ? weighted : null,
        provided,
        missing: holdings.length - provided,
        note: "Cần returnPct từng holding; thiếu → không tính (không đoán)",
      });
    },
  },
  {
    spec: {
      name: "portfolio_risk",
      domain: "portfolio",
      category: "analysis",
      description: "Rủi ro danh mục: cận trên volatility (giả định tương quan 1) — model inference.",
      params: [],
      outputType: "{ worstCaseVolPct, note }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const prof = r.profile as unknown as { inputVols?: Record<string, number | null> };
      const vols = prof.inputVols ?? {};
      const holdings = r.profile.inputs.holdings.map((h) => ({ value: h.value, volatilityPct: h.id in vols ? vols[h.id] : null }));
      const total = holdings.reduce((a, h) => a + h.value, 0);
      if (total <= 0) return errResult("DATA_UNAVAILABLE", "Danh mục rỗng");
      let weighted = 0;
      let missing = 0;
      for (const h of holdings) {
        if (h.volatilityPct == null) {
          missing += 1;
          continue;
        }
        weighted += (h.value / total) * Math.abs(h.volatilityPct);
      }
      return fmtToolResult({
        worstCaseVolPct: missing === holdings.length ? null : weighted,
        note: missing ? `${missing} holding thiếu volatility — kết quả là cận trên một phần` : "Cận trên rủi ro (tương quan 1) — model inference",
      });
    },
  },
  {
    spec: {
      name: "max_drawdown",
      domain: "portfolio",
      category: "analysis",
      description: "Max drawdown (%) của một chuỗi giá (portfolio value hoặc tài sản đơn lẻ).",
      params: [{ name: "values", type: "array", required: true, description: "Chuỗi giá trị (VNĐ hoặc index)" }],
      outputType: "{ maxDrawdownPct }",
      requiresProfile: false,
    },
    async execute(args) {
      const values = Array.isArray(args.values) ? (args.values as unknown[]).map(Number) : [];
      if (values.length < 2 || values.some((v) => !Number.isFinite(v))) return errResult("INVALID_INPUT", "Cần ít nhất 2 giá trị số");
      let peak = values[0];
      let maxDd = 0;
      for (const p of values) {
        if (p > peak) peak = p;
        const dd = (peak - p) / peak;
        if (dd > maxDd) maxDd = dd;
      }
      return okResult({ maxDrawdownPct: maxDd * 100 }, { trace: ["finance-math-engine"] });
    },
  },
  {
    spec: {
      name: "concentration",
      domain: "portfolio",
      category: "analysis",
      description: "Rủi ro tập trung danh mục: HHI, top1/top3, mức độ (DIVERSIFIED/MODERATE/CONCENTRATED).",
      params: [],
      outputType: "{ hhi, top1Pct, top3Pct, largest, holdingsCount, level }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const c = r.profile.derive.concentration;
      if (c.level === "UNAVAILABLE") return errResult("DATA_UNAVAILABLE", "Profile chưa có holdings");
      return fmtToolResult(c);
    },
  },
  {
    spec: {
      name: "sector_exposure",
      domain: "portfolio",
      category: "data",
      description: "Phơi nhiễm ngành của danh mục (theo holdings có sector).",
      params: [],
      outputType: "{ rows: [{ sector, value, weightPct }], total }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const s = r.profile.derive.sectorExposure;
      if (!s) return errResult("DATA_UNAVAILABLE", "Không có holdings nào khai sector");
      return fmtToolResult(s);
    },
  },
  {
    spec: {
      name: "asset_allocation",
      domain: "portfolio",
      category: "data",
      description: "Phân bổ tài sản theo lớp (cash/stocks/bonds/gold/realEstate/crypto/other) — giá trị + trọng số.",
      params: [],
      outputType: "{ rows: [{ key, label, value, weightPct }], total }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const a = r.profile.derive.allocation;
      if (!a) return errResult("DATA_UNAVAILABLE", "Profile chưa có holdings");
      return fmtToolResult(a);
    },
  },
  {
    spec: {
      name: "currency_exposure",
      domain: "portfolio",
      category: "data",
      description: "Phơi nhiễm tiền tệ của danh mục (theo holdings có currency).",
      params: [],
      outputType: "{ rows: [{ currency, value, weightPct }], total }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const c = r.profile.derive.currencyExposure;
      if (!c) return errResult("DATA_UNAVAILABLE", "Không có holdings nào khai currency");
      return fmtToolResult(c);
    },
  },
  {
    spec: {
      name: "rebalancing_plan",
      domain: "portfolio",
      category: "analysis",
      description: "Kế hoạch tái cân bằng: allocation hiện tại vs target (theo risk profile + tuổi), gợi ý giá trị điều chỉnh. Model inference có disclosure.",
      params: [],
      outputType: "{ current, target, suggested, total, disclaimer }",
      requiresProfile: true,
    },
    async execute(_args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const p = r.profile;
      const alloc = p.derive.allocation;
      if (!alloc) return errResult("DATA_UNAVAILABLE", "Profile chưa có holdings");
      const target = targetAllocation(p);
      const rows = alloc.rows.map((row) => {
        const t = target[row.key] ?? 0;
        const targetValue = (alloc.total * t) / 100;
        const delta = targetValue - row.value;
        return {
          key: row.key,
          label: row.label,
          currentPct: row.weightPct,
          currentValue: row.value,
          targetPct: t,
          targetValue,
          deltaValue: delta,
          suggestedAction: Math.abs(delta) < alloc.total * 0.01 ? "GIỮ" : delta > 0 ? "TĂNG" : "GIẢM",
        };
      });
      return fmtToolResult({
        current: alloc.rows,
        target,
        suggested: rows,
        total: alloc.total,
        disclaimer: "Target allocation là model inference dựa trên risk profile + tuổi (quy tắc X-100), KHÔNG phải khuyến nghị đầu tư; tham số có thể thay đổi theo profile.",
      });
    },
  },
];

/** Target allocation (%) theo risk profile + tuổi — model inference có disclosure. */
function targetAllocation(p: Profile): Record<string, number> {
  const age = p.derive.age.value;
  const risk = p.inputs.riskProfile ?? "balanced";
  let equity: number;
  if (age != null) {
    // quy tắc 100−tuổi, clamp 20–70, điều chỉnh theo khẩu vị rủi ro
    equity = Math.min(70, Math.max(20, 100 - age));
    if (risk === "conservative") equity *= 0.7;
    if (risk === "growth") equity = Math.min(80, equity * 1.2);
  } else {
    equity = risk === "conservative" ? 30 : risk === "growth" ? 60 : 45;
  }
  equity = Math.round(equity);
  const gold = Math.round((100 - equity) * 0.25);
  const bonds = Math.round((100 - equity - gold) * 0.6);
  const cash = 100 - equity - gold - bonds;
  return { stocks: equity, gold, bonds, cash };
}

/* --------------------------------- scenarios ------------------------------- */

export const scenarioTools: ToolHandler[] = [
  {
    spec: {
      name: "financial_scenario",
      domain: "scenario",
      category: "scenario",
      description: "Kịch bản tài chính cá nhân (VD: mất việc N tháng) — số tháng trụ được bằng tài sản thanh khoản.",
      params: [{ name: "months", type: "number", required: true, min: 1, max: 60, description: "Số tháng giả định" }],
      outputType: "{ months, liquidAssets, monthlyExpenses, coverageMonths, survival, note }",
      requiresProfile: true,
    },
    async execute(args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const months = Number(args.months);
      if (!Number.isFinite(months) || months < 1 || months > 60) return errResult("INVALID_INPUT", "months phải từ 1–60");
      const p = r.profile;
      const liquid = p.inputs.liquidAssets;
      const expenses = p.inputs.monthlyExpenses;
      if (liquid == null || expenses == null || expenses <= 0) return errResult("DATA_UNAVAILABLE", "Thiếu tài sản thanh khoản hoặc chi tiêu để mô phỏng");
      const coverage = p.derive.emergencyFund.value;
      return fmtToolResult({
        months,
        liquidAssets: liquid,
        monthlyExpenses: expenses,
        coverageMonths: coverage,
        survival: coverage != null && coverage >= months,
        note: "Giả định không có thu nhập trong kịch bản — model inference (scenario), không phải dự báo",
      });
    },
  },
  {
    spec: {
      name: "portfolio_scenario",
      domain: "scenario",
      category: "scenario",
      description: "Kịch bản sốc danh mục: cho shock % theo lớp tài sản → giá trị sau shock.",
      params: [
        { name: "shocks", type: "array", required: true, description: "Mảng { assetClass, shockPct } — VD [{assetClass:'stocks', shockPct:-10}]" },
      ],
      outputType: "{ before, after, changePct, perClass }",
      requiresProfile: true,
    },
    async execute(args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const raw = args.shocks;
      if (!Array.isArray(raw)) return errResult("INVALID_INPUT", "shocks phải là mảng { assetClass, shockPct }");
      const shocks = raw.map((s) => {
        const o = s as Record<string, unknown>;
        return { assetClass: String(o.assetClass ?? ""), shockPct: Number(o.shockPct) };
      }).filter((s) => s.assetClass && Number.isFinite(s.shockPct));
      if (!shocks.length) return errResult("INVALID_INPUT", "shocks rỗng hoặc không hợp lệ");
      const holdings: Holding[] = r.profile.inputs.holdings;
      const result = runPortfolioScenario(holdings, shocks);
      if (!result) return errResult("DATA_UNAVAILABLE", "Danh mục rỗng — không mô phỏng được");
      return fmtToolResult({ ...result, note: "Model inference (scenario) — giả định shock đồng thời, không phải dự báo" });
    },
  },
  {
    spec: {
      name: "goal_projection",
      domain: "scenario",
      category: "scenario",
      description: "Chiếu giá trị mục tiêu theo thời gian + lãi kép (FV của số hiện có + góp hàng tháng).",
      params: [
        { name: "goalId", type: "string", required: true, description: "Id mục tiêu trong profile" },
        { name: "years", type: "number", required: false, min: 1, max: 60, description: "Số năm (mặc định theo targetYear)" },
        { name: "monthlyContribution", type: "number", required: false, description: "Góp hàng tháng thay thế" },
        { name: "annualReturnPct", type: "number", required: false, min: 0, max: 30, description: "Lợi suất kỳ vọng thay thế" },
      ],
      outputType: "{ goalId, years, futureValue, contributed, growth, note }",
      requiresProfile: true,
    },
    async execute(args, ctx) {
      const r = requireProfile(ctx);
      if ("error" in r) return r.error;
      const goal = r.profile.inputs.goals.find((g) => g.id === String(args.goalId ?? ""));
      if (!goal) return errResult("INVALID_INPUT", `Không tìm thấy goal "${String(args.goalId)}" trong profile`);
      const years = args.years != null ? Number(args.years) : goal.targetYear != null ? Math.max(0, goal.targetYear - new Date().getFullYear()) : null;
      if (years == null || !Number.isFinite(years) || years < 1 || years > 60) return errResult("INVALID_INPUT", "Cần years (1–60) hoặc targetYear trong goal");
      const proj = projectGoal(
        goal.currentAmount,
        args.monthlyContribution != null ? Number(args.monthlyContribution) : goal.monthlyContribution,
        args.annualReturnPct != null ? Number(args.annualReturnPct) : goal.annualReturnPct,
        years,
      );
      if (!proj) return errResult("DATA_UNAVAILABLE", "Thiếu dữ liệu để chiếu (cần số hiện có hoặc góp hàng tháng + lãi suất + số năm)");
      const target = goal.targetAmount;
      return fmtToolResult({
        goalId: goal.id,
        name: goal.name,
        years,
        futureValue: proj.futureValue,
        contributed: proj.contributed,
        growth: proj.growth,
        reached: proj.futureValue >= target,
        shortfall: Math.max(0, target - proj.futureValue),
        note: "Chiếu theo lãi kép hàng tháng — model inference (scenario), không phải bảo đảm kết quả",
      });
    },
  },
];

/** Build profile từ input thô (dùng cho tool `profile_upsert` và agent). */
export function profileFromInput(input: Record<string, unknown>): { profile: Profile; errors: string[] } {
  const p = buildFinancialProfile(input as never);
  return { profile: p, errors: Object.entries(p.errors).flatMap(([k, msgs]) => (msgs ?? []).map((m) => `${k}: ${m}`)) };
}
