import { env } from "../env";
import { decisionReport } from "./simplize/capabilities";

/**
 * VN DATA PROVIDER CHAIN (Phase 10 — SAFE FALLBACK).
 *
 * VNDirect = primary (verified keyless public REST, đang production).
 * Simplize = candidate; CHỈ active khi SIMPLIZE_DATA_ACCESS=approved-api
 * (yêu cầu giấy phép văn bản từ Simplize). Mặc định role = embed-only
 * candidate: mọi data getter trả UNAVAILABLE, không ảnh hưởng pipeline.
 *
 * Không bao giờ xóa VNDirect trước khi coverage Simplize được xác minh —
 * 100% dữ liệu realtime VN hiện vẫn qua VNDirect.
 */

export interface VnProviderEntry {
  id: "vndirect" | "simplize";
  role: "primary" | "candidate-embed-only" | "disabled";
  reason: string;
}

export function resolveVnProviderChain(): {
  order: string[];
  entries: VnProviderEntry[];
  dataAccess: string;
  verdict: string;
} {
  const dataAccess = env.simplizeDataAccess ?? "none";
  const order = (env.vnProviderOrder ?? "vndirect,simplize")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s === "vndirect" || s === "simplize");

  const entries: VnProviderEntry[] = [];
  for (const id of order) {
    if (id === "vndirect") {
      entries.push({ id, role: "primary", reason: "Verified keyless public REST — production data source cho toàn bộ VN stock engine." });
    } else {
      const eligible = dataAccess === "approved-api";
      entries.push({
        id,
        role: eligible ? "primary" : "candidate-embed-only",
        reason: eligible
          ? "SIMPLIZE_DATA_ACCESS=approved-api — chỉ bật sau khi có giấy phép văn bản; vẫn giữ VNDirect fallback."
          : `Chưa có quyền API (${dataAccess}) — data getter trả UNAVAILABLE; chỉ dùng widget embed cho visualization.`,
      });
    }
  }
  return { order, entries, dataAccess, verdict: decisionReport().verdict };
}
