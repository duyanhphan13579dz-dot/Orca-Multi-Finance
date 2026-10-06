/**
 * P5 — Derivatives alert rules (pure).
 */

export type DerivAlertSeverity = "info" | "warning" | "critical";

export interface DerivAlert {
  id: string;
  severity: DerivAlertSeverity;
  title: string;
  titleVi: string;
  detail: string;
  symbol?: string;
}

export interface DerivAlertInput {
  symbol: string;
  last: number | null;
  basis: number | null;
  openInterest: number | null;
  regimeKind: string | null;
  curveShape: string | null;
  basisWarnAbs?: number;
  basisCritAbs?: number;
}

export function evaluateDerivAlerts(inputs: DerivAlertInput[]): DerivAlert[] {
  const out: DerivAlert[] = [];
  const warn = inputs[0]?.basisWarnAbs ?? 10;
  const crit = inputs[0]?.basisCritAbs ?? 20;

  for (const i of inputs) {
    if (i.basis != null && Number.isFinite(i.basis)) {
      const abs = Math.abs(i.basis);
      if (abs >= crit) {
        out.push({
          id: `basis_crit_${i.symbol}`,
          severity: "critical",
          title: "Extreme basis",
          titleVi: "Basis cực đoan",
          detail: `${i.symbol} basis ${i.basis.toFixed(1)} pts (|b|≥${crit})`,
          symbol: i.symbol,
        });
      } else if (abs >= warn) {
        out.push({
          id: `basis_warn_${i.symbol}`,
          severity: "warning",
          title: "Wide basis",
          titleVi: "Basis mở rộng",
          detail: `${i.symbol} basis ${i.basis.toFixed(1)} pts (|b|≥${warn})`,
          symbol: i.symbol,
        });
      }
    }
    if (i.regimeKind === "curve_stress") {
      out.push({
        id: `regime_stress_${i.symbol}`,
        severity: "warning",
        title: "Curve stress regime",
        titleVi: "Regime curve stress",
        detail: `${i.symbol}: regime curve_stress`,
        symbol: i.symbol,
      });
    }
    if (i.regimeKind === "liquidation" || i.regimeKind === "risk_off_short") {
      out.push({
        id: `regime_risk_${i.symbol}`,
        severity: "info",
        title: "Risk-off flow",
        titleVi: "Dòng tiền risk-off",
        detail: `${i.symbol}: ${i.regimeKind}`,
        symbol: i.symbol,
      });
    }
  }

  const seen = new Set<string>();
  return out.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}
