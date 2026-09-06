import type { FreshnessStatus } from "../types";

/**
 * ORCA FINANCIAL TOOL LAYER — kiểu dùng chung.
 * Mọi tool trả STRUCTURED DATA (không HTML/text lộn xộn).
 * Quy tắc: tool KHÔNG bịa — thiếu dữ liệu → `code: "DATA_UNAVAILABLE"`.
 */

export type ToolErrorCode = "DATA_UNAVAILABLE" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INTERNAL" | "NOT_AUTHENTICATED" | "CONSENT_REQUIRED";

export type ToolDomain = "stock" | "market" | "commodity" | "macro" | "portfolio" | "personal-finance" | "scenario";
export type ToolCategory = "data" | "analysis" | "scenario";

export interface ToolParamSpec {
  name: string;
  type: "string" | "number" | "enum" | "array";
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  description: string;
}

export interface ToolSpec {
  name: string;
  domain: ToolDomain;
  category: ToolCategory;
  description: string;
  params: ToolParamSpec[];
  /** output shape (tài liệu cho agent/UI) */
  outputType: string;
  requiresProfile?: boolean;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  code?: ToolErrorCode;
  data?: T;
  message?: string;
  meta?: {
    source?: string;
    provider?: string[];
    freshness?: FreshnessStatus;
    fetchedAt?: string;
    note?: string;
    trace?: string[];
  };
}

export const okResult = <T>(data: T, meta?: ToolResult["meta"]): ToolResult<T> => ({ ok: true, data, meta });
export const errResult = (code: ToolErrorCode, message: string, meta?: ToolResult["meta"]): ToolResult => ({ ok: false, code, message, meta });

/** Tool context: profile (nếu user đã tạo), user identity. */
export interface ToolContext {
  profile?: unknown;
  userId?: string | null;
  consent?: boolean;
  prefs?: { depth?: string; riskDisclosure?: string };
}

export interface ToolHandler {
  spec: ToolSpec;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
