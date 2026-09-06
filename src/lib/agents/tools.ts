import "server-only";
import { allMarketTools } from "./market-tools";
import { personalFinanceTools, wealthTools, scenarioTools } from "./finance-tools";
import { errResult, type ToolContext, type ToolHandler, type ToolResult, type ToolSpec } from "./tool-types";

/**
 * ORCA FINANCIAL TOOL LAYER — registry thống nhất.
 * Agents gọi tool qua `executeTool(name, args, ctx)`; mọi output là structured data.
 * Đây là tầng duy nhất chạm data engine (VNDirect, Binance, Swissquote, VCB, ECB, Yahoo…).
 */

const registry: Map<string, ToolHandler> = new Map();

for (const t of [...allMarketTools, ...personalFinanceTools, ...wealthTools, ...scenarioTools]) {
  registry.set(t.spec.name, t);
}

export function listTools(): ToolSpec[] {
  return [...registry.values()].map((t) => t.spec).sort((a, b) => a.name.localeCompare(b.name));
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext = {}): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) return errResult("INVALID_INPUT", `Tool không tồn tại: ${name}`);
  // validate params cơ bản (required + enum + min/max)
  for (const p of tool.spec.params) {
    const v = args[p.name];
    if (p.required && (v == null || v === "")) return errResult("INVALID_INPUT", `Thiếu tham số "${p.name}"`);
    if (v != null && p.type === "enum" && p.enum && !p.enum.includes(String(v))) {
      return errResult("INVALID_INPUT", `Tham số "${p.name}" phải là ${p.enum.join(" | ")}`);
    }
    if (p.type === "array" && v != null && !Array.isArray(v)) {
      return errResult("INVALID_INPUT", `Tham số "${p.name}" phải là mảng`);
    }
    if (v != null && p.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) return errResult("INVALID_INPUT", `Tham số "${p.name}" phải là số`);
      if (p.min != null && n < p.min) return errResult("INVALID_INPUT", `Tham số "${p.name}" phải ≥ ${p.min}`);
      if (p.max != null && n > p.max) return errResult("INVALID_INPUT", `Tham số "${p.name}" phải ≤ ${p.max}`);
    }
  }
  if (tool.spec.requiresProfile && !ctx.profile) {
    return errResult("CONSENT_REQUIRED", `Tool "${name}" cần Financial Profile — hãy tạo/đồng ý lưu hồ sơ tài chính trước.`);
  }
  try {
    return await tool.execute(args, ctx);
  } catch (e) {
    // Tool Layer là ranh giới data engine: provider lỗi → DATA_UNAVAILABLE,
    // không bao giờ để agent crash hay bịa dữ liệu.
    const msg = e instanceof Error ? e.message : String(e);
    return errResult("DATA_UNAVAILABLE", `Nguồn dữ liệu tạm lỗi: ${msg}`, { trace: [`tool:${name}`] });
  }
}

export function toolNamesIn(domains: string[]): string[] {
  return [...registry.values()].filter((t) => domains.includes(t.spec.domain)).map((t) => t.spec.name);
}
