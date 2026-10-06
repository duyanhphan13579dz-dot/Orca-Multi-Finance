/**
 * Server sync for personal finance (W4).
 * Local-first: always write localStorage; debounced PUT when authenticated.
 */

import type { AssumptionSet, FinanceProfile, FinancialGoal, MonthlySnapshot } from "./types";
import {
  loadAssumptionsFromStorage,
  loadGoalsFromStorage,
  loadProfileFromStorage,
  loadSnapshotsFromStorage,
  saveAssumptionsToStorage,
  saveGoalsToStorage,
  saveProfileToStorage,
  saveSnapshotsToStorage,
} from "./storage";

export type PfBundle = {
  profile: FinanceProfile;
  snapshots: MonthlySnapshot[];
  assumptions: AssumptionSet;
  goals: FinancialGoal[];
  updatedAt: number;
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let loggedIn = false;

export function setPfLoggedIn(v: boolean) {
  loggedIn = v;
}

export function collectPfBundle(): PfBundle {
  return {
    profile: loadProfileFromStorage(),
    snapshots: loadSnapshotsFromStorage(),
    assumptions: loadAssumptionsFromStorage(),
    goals: loadGoalsFromStorage(),
    updatedAt: Date.now(),
  };
}

export function applyPfBundle(bundle: PfBundle) {
  if (bundle.profile) saveProfileToStorage(bundle.profile);
  if (Array.isArray(bundle.snapshots)) saveSnapshotsToStorage(bundle.snapshots);
  if (bundle.assumptions) saveAssumptionsToStorage(bundle.assumptions);
  if (Array.isArray(bundle.goals)) saveGoalsToStorage(bundle.goals);
}

export async function pullPfFromServer(): Promise<{
  ok: boolean;
  applied: boolean;
  updatedAt: number;
  error?: string;
}> {
  try {
    const res = await fetch("/api/v1/pf");
    const json = await res.json();
    if (res.status === 401) {
      loggedIn = false;
      return { ok: false, applied: false, updatedAt: 0, error: "unauthenticated" };
    }
    if (!json?.ok) {
      return {
        ok: false,
        applied: false,
        updatedAt: 0,
        error: json?.error?.message ?? "pull failed",
      };
    }
    loggedIn = true;
    const pf = json.data?.personalFinance as PfBundle | null;
    if (!pf) return { ok: true, applied: false, updatedAt: 0 };

    const localUpdated = readLocalUpdatedAt();
    const serverUpdated = pf.updatedAt ?? json.data?.updatedAt ?? 0;
    if (serverUpdated >= localUpdated) {
      applyPfBundle(pf);
      writeLocalUpdatedAt(serverUpdated);
      return { ok: true, applied: true, updatedAt: serverUpdated };
    }
    return { ok: true, applied: false, updatedAt: localUpdated };
  } catch (e) {
    return {
      ok: false,
      applied: false,
      updatedAt: 0,
      error: e instanceof Error ? e.message : "network",
    };
  }
}

export function schedulePfServerSync(delayMs = 800) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void pushPfToServer();
  }, delayMs);
}

export async function pushPfToServer(): Promise<{ ok: boolean; error?: string }> {
  try {
    const bundle = collectPfBundle();
    writeLocalUpdatedAt(bundle.updatedAt);
    const res = await fetch("/api/v1/pf", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personalFinance: bundle }),
    });
    const json = await res.json().catch(() => null);
    if (res.status === 401) {
      loggedIn = false;
      return { ok: false, error: "unauthenticated" };
    }
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error?.message ?? `http_${res.status}` };
    }
    loggedIn = true;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

const LOCAL_UPDATED_KEY = "orca_fin_updated_at_v1";

function readLocalUpdatedAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(localStorage.getItem(LOCAL_UPDATED_KEY) || 0);
  } catch {
    return 0;
  }
}

function writeLocalUpdatedAt(ts: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_UPDATED_KEY, String(ts));
  } catch {
    /* ignore */
  }
}
