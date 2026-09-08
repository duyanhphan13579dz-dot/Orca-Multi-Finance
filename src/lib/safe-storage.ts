/**
 * Safe storage helper — never throws to crash the app.
 * Handles private mode, quota, corrupted JSON gracefully.
 */
export function safeGet(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // quota exceeded or blocked — app still works memory-only
    return false;
  }
}

export function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

export function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as unknown;
    // basic sanity: must be object/array
    if (v === null || typeof v !== "object") return fallback;
    return v as T;
  } catch {
    return fallback;
  }
}

export function safeJsonStringify(v: unknown): string | null {
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}
