import type { FinancialGoal, GoalStatus } from "../types";

export interface GoalEvaluationItem extends FinancialGoal {
  lagPercent: number;
  requiredMonthlySavings: number;
  monthsLeft: number;
  projectedOnTrack: boolean;
}

export interface GoalsSummaryResult {
  goals: GoalEvaluationItem[];
  totalRequiredMonthly: number;
  onTrackCount: number;
  laggingCount: number;
}

function monthsBetween(fromYm: string, toYm: string): number {
  const [fy, fm] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

export function evaluateGoals(
  goals: FinancialGoal[],
  currentPeriod: string,
  monthlySavingsCapacity = 0,
): GoalsSummaryResult {
  const items: GoalEvaluationItem[] = goals.map((g) => {
    const monthsLeft = Math.max(1, monthsBetween(currentPeriod, g.deadline) || 1);
    const remaining = Math.max(0, g.targetAmount - g.accumulatedAmount);
    const requiredMonthlySavings = remaining / monthsLeft;
    const progress = g.targetAmount > 0 ? g.accumulatedAmount / g.targetAmount : 0;
    const lagPercent =
      monthlySavingsCapacity > 0 && requiredMonthlySavings > monthlySavingsCapacity
        ? ((requiredMonthlySavings - monthlySavingsCapacity) / requiredMonthlySavings) * 100
        : progress < 0.5 && monthsLeft < 12
          ? 20
          : 0;

    let status: GoalStatus = g.status;
    if (progress >= 1) status = "completed";
    else if (lagPercent > 10) status = "lagging";
    else if (status !== "paused") status = "on_track";

    return {
      ...g,
      status,
      lagPercent: Math.round(lagPercent * 10) / 10,
      requiredMonthlySavings: Math.round(requiredMonthlySavings),
      monthsLeft,
      projectedOnTrack: lagPercent <= 10 && status !== "paused",
    };
  });

  return {
    goals: items,
    totalRequiredMonthly: items
      .filter((g) => g.status !== "completed" && g.status !== "paused")
      .reduce((s, g) => s + g.requiredMonthlySavings, 0),
    onTrackCount: items.filter((g) => g.status === "on_track").length,
    laggingCount: items.filter((g) => g.status === "lagging").length,
  };
}
