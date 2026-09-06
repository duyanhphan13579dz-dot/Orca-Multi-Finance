import type { FinancialProfile } from "../finance/financial-profile";
import type { DataConfidence } from "../confidence";
import type { FreshnessStatus } from "../types";
import type { ToolResult } from "./tool-types";

/**
 * ORCA AI AGENTS — kiểu dùng chung.
 * Mỗi agent trả `AgentRun`: sections có nhãn minh bạch (FACT / DATA-DRIVEN /
 * MODEL-INFERENCE / SCENARIO / OPINION), narrative tiếng Việt phong cách analyst,
 * và `unavailable` liệt kê dữ liệu thiếu (để orchestrator/UI hiển thị trung thực).
 */

export type AgentId = "stock-analyst" | "personal-finance" | "wealth-manager";

export type EvidenceLabel = "FACT" | "DATA-DRIVEN" | "MODEL-INFERENCE" | "SCENARIO" | "OPINION";

export interface AgentSection {
  id: string;
  title: string;
  label: EvidenceLabel;
  body: string; // tiếng Việt, analyst style
  data: unknown; // structured data (tool output)
  sources: string[];
  unavailable?: boolean;
}

export interface AgentRun {
  agent: AgentId;
  sections: AgentSection[];
  narrative: string; // tổng hợp analyst style (thesis → evidence → analysis → risk → scenario → conclusion)
  symbols: string[];
  sources: string[];
  freshness: FreshnessStatus;
  confidence: DataConfidence | null;
  unavailable: string[]; // dữ liệu thiếu/không khả dụng
  trace: string[];
  profileUsed?: boolean;
}

export interface AgentContext {
  profile?: FinancialProfile | null;
  userId?: string | null;
  prefs?: { depth?: "concise" | "standard" | "deep"; riskDisclosure?: "standard" | "detailed" | "off" };
  /** LLM có thể tắt (deterministic mode) */
  llm?: boolean;
}

export const numVn = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString("vi-VN"));
export const pctVn = (n: number | null | undefined, digits = 2): string => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`);

export function toolMsg(r: ToolResult): string {
  return r.ok ? "" : (r.message ?? "Không khả dụng");
}
