import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Rate limit theo IP cho các route tốn tiền (LLM) hoặc dễ bị dò (đăng nhập).
 *
 * Trên Cloudflare Workers: dùng binding Rate Limiting khai báo trong wrangler.jsonc
 * (`ratelimits`). Binding giới hạn THEO TỪNG DATACENTER và nhất quán dần (eventually
 * consistent) — đủ để chặn lạm dụng, không phải bộ đếm chính xác tuyệt đối.
 *
 * Nơi khác (next dev, Node, hoặc thiếu binding): dùng bộ đếm trong bộ nhớ, mỗi isolate/
 * process một bản — chỉ là lớp dự phòng, không thay thế được binding.
 */

export type LimiterBinding = "RL_AI" | "RL_AUTH";

interface RateLimitBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitOptions {
  /** Tên nhóm, tách bộ đếm giữa các route (vd. "agent", "login"). */
  name: string;
  /** Binding Cloudflare dùng khi có (ngưỡng nằm trong wrangler.jsonc). */
  binding: LimiterBinding;
  /** Ngưỡng dự phòng trong bộ nhớ: tối đa `limit` lần mỗi `windowSec` giây. */
  limit: number;
  windowSec: number;
}

const mem = new Map<string, { count: number; resetAt: number }>();
const MEM_MAX_KEYS = 5_000;

export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || "unknown";
}

function memoryAllow(key: string, limit: number, windowSec: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  if (mem.size > MEM_MAX_KEYS) {
    for (const [k, v] of mem) if (v.resetAt <= now) mem.delete(k);
    if (mem.size > MEM_MAX_KEYS) mem.clear();
  }
  const cur = mem.get(key);
  if (!cur || cur.resetAt <= now) {
    mem.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, retryAfter: 0 };
  }
  cur.count += 1;
  if (cur.count > limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  return { ok: true, retryAfter: 0 };
}

function getBinding(name: LimiterBinding): RateLimitBinding | null {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const b = env?.[name] as RateLimitBinding | undefined;
    return b && typeof b.limit === "function" ? b : null;
  } catch {
    return null;
  }
}

/**
 * Trả về `null` nếu được phép, hoặc `Response` 429 để route trả thẳng.
 * Không bao giờ ném lỗi: nếu bộ đếm gặp sự cố thì cho qua (fail-open) để không chặn nhầm người dùng.
 */
export async function rateLimit(req: Request, opts: RateLimitOptions): Promise<Response | null> {
  const key = `${opts.name}:${clientIp(req)}`;
  let allowed = true;
  let retryAfter = opts.windowSec;

  try {
    const binding = getBinding(opts.binding);
    if (binding) {
      allowed = (await binding.limit({ key })).success;
    } else {
      const r = memoryAllow(key, opts.limit, opts.windowSec);
      allowed = r.ok;
      retryAfter = r.retryAfter || opts.windowSec;
    }
  } catch {
    allowed = true;
  }

  if (allowed) return null;
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: "RATE_LIMITED", message: "Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút." },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfter),
      },
    },
  );
}
