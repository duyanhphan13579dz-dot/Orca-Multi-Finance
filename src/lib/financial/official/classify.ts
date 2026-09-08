import type { FilingKind, OfficialFiling } from "./types";

/** Classify filing from title / reportType / fiscal cues — deterministic. */
export function classifyFiling(input: {
  title?: string | null;
  reportType?: string | null;
  fiscalDate?: string | null;
  typeDesc?: string | null;
}): Pick<OfficialFiling, "kind" | "periodType" | "auditStatus" | "statementScope"> {
  const blob = `${input.title ?? ""} ${input.reportType ?? ""} ${input.typeDesc ?? ""}`.toLowerCase();

  let auditStatus: OfficialFiling["auditStatus"] = "unknown";
  if (/ki[ẻe]m to[aá]n|audited/.test(blob)) auditStatus = "audited";
  else if (/so[aá]t x[eé]t|reviewed/.test(blob)) auditStatus = "reviewed";
  else if (/ch[uư]a ki[ẻe]m to[aá]n|unaudited/.test(blob)) auditStatus = "unaudited";

  let statementScope: OfficialFiling["statementScope"] = "unknown";
  if (/h[oợ]p nh[aấ]t|consolidated/.test(blob)) statementScope = "consolidated";
  else if (/ri[eê]ng|standalone|parent only/.test(blob)) statementScope = "standalone";

  let kind: FilingKind = "unknown";
  let periodType: OfficialFiling["periodType"] = "unknown";

  if (/annual|n[aă]m|year-end|bctc n[aă]m/.test(blob) || /ANNUAL/i.test(input.reportType ?? "")) {
    kind = auditStatus === "audited" ? "audited_annual" : "annual_fs";
    periodType = "year";
  } else if (/6 th[aá]ng|b[aá]n ni[eê]n|semi/.test(blob)) {
    kind = auditStatus === "reviewed" ? "reviewed_interim" : "semi_annual_fs";
    periodType = "semi";
  } else if (/qu[yý]|quarter|QUARTER/i.test(blob) || /QUARTER/i.test(input.reportType ?? "")) {
    kind = auditStatus === "reviewed" ? "reviewed_interim" : "quarterly_fs";
    periodType = "quarter";
  } else if (/th[aá]ng|monthly|s[aả]n l[uư][oợ]ng/.test(blob)) {
    kind = "operational_monthly";
    periodType = "month";
  } else if (/c[oô]ng b[oố]|disclosure|ngh[iị] quy[eế]t/.test(blob)) {
    kind = "disclosure_other";
  }

  // fiscal month heuristic when still unknown
  if (periodType === "unknown" && input.fiscalDate) {
    const m = Number(input.fiscalDate.slice(5, 7));
    if (m === 12) {
      periodType = "year";
      if (kind === "unknown") kind = "annual_fs";
    } else if ([3, 6, 9].includes(m)) {
      periodType = "quarter";
      if (kind === "unknown") kind = "quarterly_fs";
    }
  }

  return { kind, periodType, auditStatus, statementScope };
}

export function periodLabelFromFiscal(
  fiscalDate: string | null,
  periodType: OfficialFiling["periodType"],
): string | null {
  if (!fiscalDate || fiscalDate.length < 7) return null;
  const y = fiscalDate.slice(0, 4);
  const m = Number(fiscalDate.slice(5, 7));
  if (periodType === "year") return y;
  if (periodType === "semi") return m <= 6 ? `${y}-H1` : `${y}-H2`;
  if (periodType === "quarter") {
    const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
    return `${y}-Q${q}`;
  }
  if (periodType === "month") return `${y}-${String(m).padStart(2, "0")}`;
  return fiscalDate.slice(0, 10);
}
